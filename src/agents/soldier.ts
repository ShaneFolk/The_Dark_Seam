// Soldiers and squads.
//
// Each squad has one order at a time, picked by its "brain" a few times a second
// in this priority order:
//
//   retreat   morale broke: fall back to Security, weld it shut, wait until it recovers
//   resupply  low on ammo: restock at the Armory
//   rescue    a Taker is carrying someone: chase it and shoot it
//   respond   Myrr in sight, or screams, gunfire, digging, smashing or chewing heard
//   cut       a cocoon in sight: cut the person free
//   blast     heavy fighting in an Upper Mine tunnel: collapse it with a mining charge
//   reload    a turret is low: feed it spare rifle magazines
//   fetchTurret / deployTurret   carry a packed turret from the armory to a defence point
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
import { nearestVisible, roundsLeft, tryAttack } from './combat.ts'
import { roomsWith, stockIn, take } from '../systems/supplies.ts'
import { Barrier, putBarrier, roomOpenings } from '../systems/barriers.ts'
import { humanSight } from '../systems/power.ts'
import { createTurret, deploySite, needsReload } from './turret.ts'
import { strongest } from '../systems/pheromones.ts'
import { chokePoint, collapseTunnel } from '../systems/digging.ts'
import { countResin } from '../systems/resin.ts'
import { makeNoise } from '../systems/noise.ts'
import { kill } from './combat.ts'
import { logEvent } from '../core/events.ts'
import { who } from './describe.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'

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

export type Order = 'patrol' | 'respond' | 'rescue' | 'cut' | 'resupply' | 'retreat' | 'reload' | 'blast' | 'fetchTurret' | 'deployTurret'

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
  /** Ticks left on timed work (resupplying, cutting, welding, pausing on patrol). */
  ticksLeft: number
  /** Welded themselves in during the current retreat. */
  welded: boolean
  /** Mining charges the squad carries. */
  charges: number
  /** The leader is carrying a packed turret. */
  carryingTurret: boolean
}

const TPS = CONFIG.sim.ticksPerSecond
const S = CONFIG.soldiers

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
      const SIGHT = humanSight(ctx.power, s.levelIndex)
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
    // Sensor alerts go to the nearest squad; other noises only if a member hears them.
    const alert = ctx.noises.find((n) => n.kind === 'sensor' && n.tick === ctx.tick && nearestSquad(squads, n, ctx) === squad)
    const heard = alert ?? ctx.noises.find((n) => n.kind !== 'skitter' && n.kind !== 'sensor' && n.sourceId >= 0 &&
      !squad.members.includes(n.sourceId) && alive.some((s) => canHear(s, n, ctx.world.levels[s.levelIndex])))

    // Morale drifts: down while outnumbered, back up when it's quiet.
    if (myrrCount > alive.length) squad.morale -= S.morale.outnumberedPerSecond * seconds
    else if (!myrrSeen) squad.morale += S.morale.recoverPerSecond * seconds
    squad.morale = Math.max(0, Math.min(1, squad.morale))
    if (myrrSeen) squad.lastContactTick = ctx.tick

    const ammo = alive.reduce((sum, s) => sum + (s.weapon ? roundsLeft(s.weapon) : 0), 0)
    // Low on ammo, and somewhere still has some to restock from.
    const restockAt = roomsWith(ctx.supplies, 'rifleMags', leader)[0] ?? null
    const lowAmmo = !!restockAt && ammo < alive.length * CONFIG.combat.weapons.rifle.magazine * 0.5

    // Pick the order (see the list at the top of this file).
    if (squad.order === 'retreat' ? squad.morale < S.morale.regroupAt : squad.morale < S.morale.breakAt) {
      setOrder(squad, 'retreat', roomGoal(ctx, ['security'], leader))
    } else if (squad.order === 'resupply' || lowAmmo) {
      if (squad.order !== 'resupply') setOrder(squad, 'resupply', restockAt ? randomTileIn(ctx.world, restockAt, ctx.rng) : roomGoal(ctx, ['armory'], leader))
    } else if (carrier) {
      setOrder(squad, 'rescue', tileOf(carrier))
      squad.targetId = carrier.id
    } else if (myrrSeen) {
      setOrder(squad, 'respond', tileOf(myrrSeen))
    } else if (cocoon && squad.order !== 'cut') {
      setOrder(squad, 'cut', tileOf(cocoon))
      squad.targetId = cocoon.id
    } else if (squad.order === 'patrol' && squad.charges > 0 && blastSite(ctx)) {
      setOrder(squad, 'blast', blastSite(ctx))
    } else if (heard && squad.order === 'patrol') {
      setOrder(squad, 'respond', { levelIndex: heard.levelIndex, x: Math.floor(heard.x), y: Math.floor(heard.y) })
      squad.lastContactTick = ctx.tick
    } else if (squad.order === 'patrol' && squad.carryingTurret) {
      const site = deploySite(ctx, reservedSites(squads))
      if (site) setOrder(squad, 'deployTurret', site)
    } else if (squad.order === 'patrol' && !squad.carryingTurret && armoryWithTurret(ctx) && deploySite(ctx, reservedSites(squads))) {
      setOrder(squad, 'fetchTurret', randomTileIn(ctx.world, armoryWithTurret(ctx)!, ctx.rng))
    } else if (squad.order === 'patrol' && turretToReload(ctx, leader)) {
      const t = turretToReload(ctx, leader)!
      setOrder(squad, 'reload', tileOf(t))
      squad.targetId = t.id
    } else if (squad.order === 'respond' && ctx.tick - squad.lastContactTick > S.respondGiveUpSeconds * TPS) {
      setOrder(squad, 'patrol', null)
    } else if (squad.order === 'rescue' || (squad.order === 'cut' && !isCocooned(ctx, squad.targetId))) {
      setOrder(squad, 'patrol', null)
    }
  }
}

function setOrder(squad: Squad, order: Order, goal: PathNode | null): void {
  if (squad.order !== order) { squad.ticksLeft = 0; squad.welded = false }
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
  // Carrying a packed turret slows the leader (and so the squad).
  agent.speed = agent.baseSpeed * (squad.carryingTurret ? CONFIG.turrets.carrySpeedMultiplier : 1)

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
    if (squad.order === 'retreat' && !squad.welded) squad.ticksLeft = Math.round(CONFIG.barriers.weldSeconds * TPS)
    if (squad.order === 'reload') squad.ticksLeft = Math.round(CONFIG.turrets.reloadSeconds * TPS)
    if (squad.order === 'fetchTurret') squad.ticksLeft = Math.round(CONFIG.turrets.pickupSeconds * TPS)
    if (squad.order === 'deployTurret') squad.ticksLeft = Math.round(CONFIG.turrets.setupSeconds * TPS)
    if (squad.order === 'blast') squad.ticksLeft = Math.round(CONFIG.charges.setSeconds * TPS)
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
  if (squad.order === 'fetchTurret') {
    const stock = stockIn(ctx.supplies, roomAt(ctx.world, tileOf(alive[0])))
    if (stock && take(stock, 'turrets', 1)) squad.carryingTurret = true
    setOrder(squad, 'patrol', null) // the brain sends a carrying squad to deploy next
    return
  }
  if (squad.order === 'deployTurret') {
    if (squad.carryingTurret) {
      ctx.agents.push(createTurret(ctx.agents.length, squad.goal!))
      logEvent(ctx, 'gear', `Squad ${squad.id + 1} set up a sentry turret on Level ${squad.goal!.levelIndex + 1}`)
      squad.carryingTurret = false
    }
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'reload') {
    // Feed spare rifle magazines into the turret.
    const turret = ctx.agents[squad.targetId]
    const giver = alive.find((s) => s.weapon?.kind === 'rifle' && s.weapon.spare > 0)
    if (turret?.weapon && giver?.weapon) {
      const mags = Math.min(CONFIG.turrets.reloadMags, giver.weapon.spare)
      giver.weapon.spare -= mags
      turret.weapon.inMag = Math.min(CONFIG.combat.weapons.turret.magazine, turret.weapon.inMag + mags * CONFIG.combat.weapons.rifle.magazine * 2)
    }
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'blast') {
    // Back off and set it off: the tunnel collapses into rock for good.
    const at = squad.goal!
    const level = ctx.world.levels[at.levelIndex]
    const collapsed = new Set(collapseTunnel(ctx.world, at, CONFIG.charges.radius))
    for (const a of ctx.agents) {
      if (!a.dead && a.levelIndex === at.levelIndex && collapsed.has(Math.floor(a.y) * level.width + Math.floor(a.x))) kill(a, ctx)
    }
    makeNoise(ctx.noises, 'blast', at.levelIndex, at.x, at.y, ctx.tick, alive[0].id)
    squad.charges--
    logEvent(ctx, 'gear', `Squad ${squad.id + 1} collapsed a tunnel on Level ${at.levelIndex + 1} with a mining charge`)
    ctx.hive.resinTiles = countResin(ctx.world)
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'retreat') {
    // Fallen back: weld the doors and board the windows of the room they're in.
    const room = roomAt(ctx.world, tileOf(alive[0]))
    const level = ctx.world.levels[alive[0].levelIndex]
    if (room) for (const o of roomOpenings(ctx.world, room)) {
      if (level.barrier[o.tile] <= 0) putBarrier(level, o.tile, o.kind === Barrier.Boards ? Barrier.Boards : Barrier.Weld)
    }
    squad.welded = true
    logEvent(ctx, 'command', `Squad ${squad.id + 1} fell back and welded itself in`)
    return
  }
  if (squad.order === 'resupply') {
    // Restock from what this room actually has.
    const stock = stockIn(ctx.supplies, roomAt(ctx.world, tileOf(alive[0])))
    for (const s of alive) {
      const w = s.weapon
      if (w && stock && w.kind !== 'flamethrower') { // flamethrower fuel isn't stocked
        const item = w.kind === 'rifle' ? 'rifleMags' : 'pistolMags'
        w.spare += take(stock, item, Math.max(0, CONFIG.combat.spareMagazines - w.spare))
        if (w.inMag === 0 && w.spare > 0 && w.reloading === 0) { w.inMag = CONFIG.combat.weapons[w.kind].magazine; w.spare-- }
      }
      if (s.soldier!.role === 'medic' && stock) s.soldier!.stabilizers += take(stock, 'stabilizers', S.stabilizers - s.soldier!.stabilizers)
    }
    setOrder(squad, 'patrol', null)
  } else if (squad.order === 'cut') {
    const person = ctx.agents[squad.targetId]
    if (person?.civ && person.civ.mode === 'cocooned') {
      // Cut free, but still infected: they need a medic or the med bay.
      person.civ.rescued = true
      ctx.stats.cutFree++
      logEvent(ctx, 'rescue', `Soldiers cut ${who(person).toLowerCase()} free from a cocoon`)
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

/** The squad whose leader is closest to a spot (another level counts as far away). */
function nearestSquad(squads: Squad[], at: { levelIndex: number; x: number; y: number }, ctx: CombatContext): Squad | null {
  let best: Squad | null = null, bestD = Infinity
  for (const sq of squads) {
    const leader = members(sq, ctx)[0]
    if (!leader) continue
    const d = Math.abs(leader.levelIndex - at.levelIndex) * 200 + Math.hypot(leader.x - at.x, leader.y - at.y)
    if (d < bestD) { best = sq; bestD = d }
  }
  return best
}

// ---------------------------------------------------------------- turrets and charges

/** Spots squads are already carrying turrets to. */
function reservedSites(squads: Squad[]): PathNode[] {
  return squads.filter((s) => s.order === 'deployTurret' && s.goal).map((s) => s.goal!)
}

/** A room that still has a packed turret. */
function armoryWithTurret(ctx: CombatContext): RoomRef | null {
  return [...ctx.supplies.values()].find((s) => s.stock.turrets > 0)?.room ?? null
}

/** A turret on the leader's level that needs ammo, if the squad has spare rifle magazines. */
function turretToReload(ctx: CombatContext, leader: Agent): Agent | null {
  if (!leader.weapon || leader.weapon.kind !== 'rifle' || leader.weapon.spare < 1) return null
  return ctx.agents.find((a) => a.kind === 'turret' && a.levelIndex === leader.levelIndex && needsReload(a)) ?? null
}

/** Where to blast: a narrow tunnel near heavy fighting on Level 2 (strong danger scent). */
function blastSite(ctx: CombatContext): PathNode | null {
  const hot = strongest(ctx.pheromones, 'danger', ctx.world, 3, CONFIG.charges.trigger).find((s) => s.at.levelIndex === 1)
  if (!hot) return null
  // Stand next to the choke point, on the colony side, and blast it.
  return chokePoint(ctx.world, hot.at, 10)
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
