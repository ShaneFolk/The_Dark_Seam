// Soldiers and squads.
//
// Each squad has one order at a time, picked by its "brain" a few times a second
// in this priority order:
//
//   retreat   morale broke: fall back to Security until it recovers
//   resupply  low on ammo: restock at the Armory
//   rescue    a Taker is carrying someone: chase it and shoot it
//   respond   Myrr in sight, or screams / gunfire / digging heard: go there and fight
//   cut       a cocoon in sight: cut the person free
//   patrol    otherwise walk the squad's route
//
// The leader walks to the squad's goal; the others keep close to the leader.
// Every soldier shoots the nearest Myrr in reach on their own. Medics also wake
// paralysed people and stabilize infected ones when it's safe.

import { CONFIG } from '../config.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { canWalk, findPath } from '../world/pathfinding.ts'
import { findRooms, randomTileIn, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canHear, canSee } from './perception.ts'
import { isFree, setMode } from './civilian.ts'
import { nearestVisible, refill, roundsLeft, tryAttack, type CombatContext } from './combat.ts'

export interface SoldierData {
  squadId: number
  role: 'soldier' | 'medic'
  /** Next tick this soldier re-plans its route. */
  repathTick: number
  /** Myrr this soldier is shooting at, or -1. */
  targetId: number
  /** Medics only: stabilizers left, current patient (-1 = none) and ticks left on the job. */
  stabilizers: number
  patientId: number
  workTicks: number
}

export type Order = 'patrol' | 'respond' | 'rescue' | 'cut' | 'resupply' | 'retreat'

export interface Squad {
  id: number
  members: number[]
  order: Order
  /** Where the squad is heading. */
  goal: PathNode | null
  /** Agent the order is about (carrier to chase, cocoon to cut), or -1. */
  targetId: number
  /** 0 to 1. Low morale makes the squad retreat. */
  morale: number
  lastContactTick: number
  patrol: RoomRef[]
  patrolIndex: number
  /** Ticks left on timed work (resupplying, cutting, pausing on patrol). */
  ticksLeft: number
}

const TPS = CONFIG.sim.ticksPerSecond
const S = CONFIG.soldiers
const SIGHT = CONFIG.perception.sightRange

// ---------------------------------------------------------------- squad brain

/** Decide each squad's order. Runs every perception interval. */
export function updateSquads(squads: Squad[], ctx: CombatContext): void {
  if (ctx.tick % CONFIG.perception.intervalTicks !== 0) return
  const seconds = CONFIG.perception.intervalTicks / TPS
  for (const squad of squads) {
    const alive = members(squad, ctx)
    if (!alive.length) continue
    const leader = alive[0]

    // What does the squad see and hear?
    let myrrSeen: Agent | null = null
    let myrrCount = 0
    let carrier: Agent | null = null
    let cocoon: Agent | null = null
    for (const s of alive) {
      const m = nearestVisible(s, ctx, SIGHT, (a) => a.side === 'myrr')
      if (m && (!myrrSeen || dist(s, m) < dist(s, myrrSeen))) myrrSeen = m
      for (const a of ctx.agents) {
        if (a.dead || a.levelIndex !== s.levelIndex) continue
        if (a.side === 'myrr' && canSee(s, a, ctx.world.levels[s.levelIndex], SIGHT)) {
          myrrCount++
          if (a.myrr?.task === 'carry') carrier = a
        } else if (a.civ?.mode === 'cocooned' && canSee(s, a, ctx.world.levels[s.levelIndex], SIGHT)) {
          cocoon = a
        }
      }
    }
    const heard = ctx.noises.find((n) => (n.kind === 'scream' || n.kind === 'gunshot' || n.kind === 'dig') && n.sourceId >= 0 &&
      !squad.members.includes(n.sourceId) && alive.some((s) => canHear(s, n, ctx.world.levels[s.levelIndex])))

    // Morale drifts: down while outnumbered, back up when it's quiet.
    if (myrrCount > alive.length) squad.morale -= S.morale.outnumberedPerSecond * seconds
    else if (!myrrSeen) squad.morale += S.morale.recoverPerSecond * seconds
    squad.morale = Math.max(0, Math.min(1, squad.morale))
    if (myrrSeen) squad.lastContactTick = ctx.tick

    const ammo = alive.reduce((sum, s) => sum + (s.weapon ? roundsLeft(s.weapon) : 0), 0)
    const lowAmmo = ammo < alive.length * CONFIG.combat.weapons.rifle.magazine * 0.5

    // Pick the order (see the list at the top of this file).
    if (squad.order === 'retreat' ? squad.morale < S.morale.regroupAt : squad.morale < S.morale.breakAt) {
      setOrder(squad, 'retreat', roomGoal(ctx, ['security'], leader))
    } else if (squad.order === 'resupply' || lowAmmo) {
      if (squad.order !== 'resupply') setOrder(squad, 'resupply', roomGoal(ctx, ['armory'], leader))
    } else if (carrier) {
      setOrder(squad, 'rescue', tileOf(carrier))
      squad.targetId = carrier.id
    } else if (myrrSeen) {
      setOrder(squad, 'respond', tileOf(myrrSeen))
    } else if (cocoon && squad.order !== 'cut') {
      setOrder(squad, 'cut', tileOf(cocoon))
      squad.targetId = cocoon.id
    } else if (heard && squad.order === 'patrol') {
      setOrder(squad, 'respond', { levelIndex: heard.levelIndex, x: Math.floor(heard.x), y: Math.floor(heard.y) })
      squad.lastContactTick = ctx.tick
    } else if (squad.order === 'respond' && ctx.tick - squad.lastContactTick > S.respondGiveUpSeconds * TPS) {
      setOrder(squad, 'patrol', null)
    } else if (squad.order === 'rescue' || (squad.order === 'cut' && !isCocooned(ctx, squad.targetId))) {
      setOrder(squad, 'patrol', null)
    }
  }
}

function setOrder(squad: Squad, order: Order, goal: PathNode | null): void {
  if (squad.order !== order) squad.ticksLeft = 0
  squad.order = order
  if (goal) squad.goal = goal
  if (order === 'patrol') { squad.goal = null; squad.targetId = -1 }
}

// ---------------------------------------------------------------- each soldier

export function updateSoldier(agent: Agent, squads: Squad[], ctx: CombatContext): void {
  const squad = squads[agent.soldier!.squadId]
  shoot(agent, ctx)

  if (agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }
  const alive = members(squad, ctx)
  const leader = alive[0]
  if (agent.soldier!.role === 'medic' && treatPatients(agent, ctx)) return
  if (agent === leader) leadSquad(agent, squad, alive, ctx)
  else follow(agent, leader, alive.indexOf(agent), ctx)
}

/** Shoot the nearest Myrr in reach (re-checked a few times a second). */
function shoot(agent: Agent, ctx: CombatContext): void {
  const s = agent.soldier!
  let target = s.targetId >= 0 ? ctx.agents[s.targetId] : null
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0 || !target || target.dead) {
    const range = agent.weapon ? CONFIG.combat.weapons[agent.weapon.kind].range : 0
    target = nearestVisible(agent, ctx, range, (a) => a.side === 'myrr')
    s.targetId = target ? target.id : -1
  }
  if (target) tryAttack(agent, target, ctx)
}

function leadSquad(agent: Agent, squad: Squad, alive: Agent[], ctx: CombatContext): void {
  const s = agent.soldier!

  // Timed work at the goal: restocking, cutting a cocoon, pausing on patrol.
  if (squad.ticksLeft > 0) {
    if (--squad.ticksLeft === 0) finishWork(squad, alive, ctx)
    return
  }

  // Chasing a moving target: keep the goal on it.
  if (squad.order === 'rescue' && squad.targetId >= 0) {
    const carrier = ctx.agents[squad.targetId]
    if (carrier && !carrier.dead) squad.goal = tileOf(carrier)
  }
  if (squad.order === 'patrol' && !squad.goal) {
    squad.patrolIndex = (squad.patrolIndex + 1) % squad.patrol.length
    squad.goal = randomTileIn(ctx.world, squad.patrol[squad.patrolIndex], ctx.rng)
  }
  const goal = squad.goal
  if (!goal) return

  const here = tileOf(agent)
  const arrived = here.levelIndex === goal.levelIndex && Math.hypot(here.x - goal.x, here.y - goal.y) <= 1.5
  if (arrived) {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    if (squad.order === 'patrol') { squad.ticksLeft = 5 * TPS; squad.goal = null }
    if (squad.order === 'resupply') squad.ticksLeft = Math.round(S.resupplySeconds * TPS)
    if (squad.order === 'cut') squad.ticksLeft = Math.round(S.cutSeconds * TPS)
    if (squad.order === 'respond') squad.goal = null
    return
  }
  if (ctx.tick >= s.repathTick || agent.state.name !== 'moving') {
    s.repathTick = ctx.tick + TPS
    walkTo(agent, goal, ctx)
  }
  followPath(agent, ctx.world)
}

function finishWork(squad: Squad, alive: Agent[], ctx: CombatContext): void {
  if (squad.order === 'resupply') {
    for (const s of alive) {
      if (s.weapon) refill(s.weapon)
      if (s.soldier!.role === 'medic') s.soldier!.stabilizers = S.stabilizers
    }
    setOrder(squad, 'patrol', null)
  } else if (squad.order === 'cut') {
    const person = ctx.agents[squad.targetId]
    if (person?.civ && person.civ.mode === 'cocooned') {
      // Cut free, but still infected: they need a medic or the med bay.
      person.civ.rescued = true
      person.civ.fear = CONFIG.fear.flee
      setMode(person, person.civ, 'hide')
    }
    setOrder(squad, 'patrol', null)
  }
}

/** Spots around the leader, one per follower, so the squad spreads out instead of stacking. */
const FORMATION: readonly [number, number][] = [[-1, 1], [1, 1], [-1, -1], [1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]]

function follow(agent: Agent, leader: Agent, slot: number, ctx: CombatContext): void {
  const s = agent.soldier!
  const far = agent.levelIndex !== leader.levelIndex || dist(agent, leader) > S.followDistance
  // Re-plan about once a second, staggered by id so followers don't move in lockstep.
  if (far && (ctx.tick >= s.repathTick || agent.state.name !== 'moving')) {
    s.repathTick = ctx.tick + TPS + (agent.id % 7)
    walkTo(agent, formationSpot(leader, slot, ctx), ctx)
  }
  if (agent.state.name === 'moving') followPath(agent, ctx.world)
}

/** This follower's spot next to the leader (the next free one if that tile is blocked). */
function formationSpot(leader: Agent, slot: number, ctx: CombatContext): PathNode {
  const at = tileOf(leader)
  const level = ctx.world.levels[at.levelIndex]
  for (let k = 0; k < FORMATION.length; k++) {
    const [dx, dy] = FORMATION[(slot - 1 + k) % FORMATION.length]
    if (canWalk(level, at.x + dx, at.y + dy, 'human')) return { levelIndex: at.levelIndex, x: at.x + dx, y: at.y + dy }
  }
  return at
}

// ---------------------------------------------------------------- medics

/**
 * Medic work: wake paralysed people and stabilize infected ones nearby, unless a
 * Myrr is too close. Returns true while busy (the medic doesn't follow the squad).
 */
function treatPatients(agent: Agent, ctx: CombatContext): boolean {
  const s = agent.soldier!
  if (s.patientId < 0) {
    if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks !== 0) return false
    if (nearestVisible(agent, ctx, S.unsafeRange, (a) => a.side === 'myrr')) return false
    const patient = nearestVisible(agent, ctx, S.patientRange, (a) => !!needsCare(a, s, ctx))
    if (!patient) return false
    s.patientId = patient.id
    s.workTicks = Math.round((needsCare(patient, s, ctx) === 'wake' ? S.wakeSeconds : S.stabilizeSeconds) * TPS)
  }

  const patient = ctx.agents[s.patientId]
  const care = patient && needsCare(patient, s, ctx)
  if (!care || nearestVisible(agent, ctx, S.unsafeRange, (a) => a.side === 'myrr')) {
    s.patientId = -1
    return false
  }

  if (patient.levelIndex === agent.levelIndex && dist(agent, patient) <= 1.5) {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    if (--s.workTicks > 0) return true
    const civ = patient.civ!
    if (care === 'wake') {
      civ.paralyzedUntilTick = ctx.tick // wakes up on its own next tick
    } else if (civ.infection) {
      // Pause the larva: push the hatch time back by the pause.
      const pause = Math.round(S.stabilizerPauseSeconds * TPS)
      civ.infection.stabilizedUntilTick = ctx.tick + pause
      civ.infection.hatchTick += pause
      s.stabilizers--
    }
    s.patientId = -1
    return false
  }

  if (ctx.tick >= s.repathTick || agent.state.name !== 'moving') {
    s.repathTick = ctx.tick + TPS
    walkTo(agent, tileOf(patient), ctx)
  }
  followPath(agent, ctx.world)
  return true
}

/** What a person needs from a medic, if anything. */
function needsCare(a: Agent, medic: SoldierData, ctx: CombatContext): 'wake' | 'stabilize' | null {
  const civ = a.civ
  if (!civ || a.dead || a.side !== 'human') return null
  if (civ.mode === 'paralyzed') return 'wake'
  if (civ.infection && ctx.tick >= civ.infection.stabilizedUntilTick && medic.stabilizers > 0 &&
      civ.mode !== 'cocooned' && civ.mode !== 'captured' && civ.mode !== 'captive') return 'stabilize'
  return null
}

// ---------------------------------------------------------------- helpers

export function members(squad: Squad, ctx: CombatContext): Agent[] {
  return squad.members.map((id) => ctx.agents[id]).filter((a) => a && !a.dead && isFree(a))
}

/** Squad morale drops when one of its soldiers is hurt or killed. */
export function soldierHurt(squads: Squad[], soldier: Agent, killed: boolean): void {
  const squad = squads[soldier.soldier!.squadId]
  squad.morale = Math.max(0, squad.morale - (killed ? S.morale.squadmateDown : S.morale.hitTaken))
}

function roomGoal(ctx: CombatContext, types: ('security' | 'armory')[], from: Agent): PathNode | null {
  const rooms = findRooms(ctx.world, types)
  if (!rooms.length) return null
  const here = roomAt(ctx.world, tileOf(from))
  if (rooms.some((r) => sameRoom(r, here))) return tileOf(from)
  return randomTileIn(ctx.world, rooms[0], ctx.rng)
}

function isCocooned(ctx: CombatContext, id: number): boolean {
  return id >= 0 && ctx.agents[id]?.civ?.mode === 'cocooned'
}

function walkTo(agent: Agent, to: PathNode, ctx: CombatContext): void {
  const path = findPath(ctx.world, tileOf(agent), to, 'human')
  if (path?.length) {
    agent.path = path
    agent.state = { name: 'moving' }
  }
}

function dist(a: Agent, b: Agent): number {
  return a.levelIndex === b.levelIndex ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity
}
