// Soldiers and squads.
//
// Each squad has one order at a time, picked by its "brain" a few times a second
// in this priority order:
//
//   retreat   morale broke: fall back to Security, weld it shut, wait until it recovers
//   resupply  low on ammo: restock at the Armory
//   chase     on an assault, the Brood Mother is fleeing: run her down
//   rescue    a Taker is carrying someone: chase it and shoot it
//   respond   Myrr in sight, or screams, gunfire, digging, smashing or chewing heard
//   cut       a cocoon in sight: cut the person free
//   blast     heavy fighting in an Upper Mine tunnel: collapse it with a mining charge
//   reload    a turret is low: feed it spare rifle magazines
//   fetchTurret / deployTurret   carry a packed turret from the armory to a defence point
//   assault / escort   the Commander's missions: storm the Hive Core / guard the evacuation
//   guard     the command squad stays with the Commander (and only fights near them)
//   patrol    otherwise walk the squad's route
//
// After an ambush the Commander has squads burn resin ahead of them (grenades, or
// the flamethrower) before walking into it, unless someone is about to be lost.
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
import { burnArea, nearestVisible, roundsLeft, tryAttack } from './combat.ts'
import { roomsWith, stockIn, take } from '../systems/supplies.ts'
import { Barrier, putBarrier, roomOpenings } from '../systems/barriers.ts'
import { humanSight } from '../systems/power.ts'
import { createTurret, deploySite, needsReload, padSite } from './turret.ts'
import { strongest } from '../systems/pheromones.ts'
import { chokePoint, collapseTunnel } from '../systems/digging.ts'
import { countResin } from '../systems/resin.ts'
import { makeNoise } from '../systems/noise.ts'
import { kill } from './combat.ts'
import { logEvent } from '../core/events.ts'
import { hatchingSoon, landingPad } from '../systems/commander.ts'
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

export type Order = 'guard' | 'patrol' | 'respond' | 'rescue' | 'cut' | 'resupply' | 'retreat' | 'reload' | 'blast' | 'fetchTurret' | 'deployTurret' | 'assault' | 'escort'

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
  /** The Commander's orders for this squad: assault the hive, or guard the evacuation. */
  mission: 'assault' | 'escort' | null
  missionGoal: PathNode | null
  /** Has reached the mission goal (assault: the Hive Core). */
  missionReached: boolean
  /** Incendiary grenades for burning resin. */
  incendiaries: number
  /** Where the squad is about to burn resin (while it stops to throw), or null. */
  burnAt: PathNode | null
  /** The Commander told it to skip burning to save someone (logged once per decision). */
  riskTaken: boolean
  /** Command squad: the agent it guards (the Commander), or -1. */
  guardId: number
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
    if (myrrSeen) { squad.lastContactTick = ctx.tick; ctx.commander.lastSightingTick = ctx.tick }
    if (cocoon) squad.lastContactTick = ctx.tick

    // Assault done: at the hive, nothing left to fight or cut for a while.
    if (squad.mission === 'assault' && squad.missionReached && !ctx.hive.escapeTo && ctx.tick - squad.lastContactTick > CONFIG.commander.assault.quietSeconds * TPS) {
      squad.mission = null
      squad.missionReached = false
      logEvent(ctx, 'command', `Squad ${squad.id + 1} finished its assault on the hive`)
    }
    // A broken or thinned-out squad abandons its assault.
    if (squad.mission === 'assault' && (squad.morale < S.morale.breakAt || alive.length < CONFIG.commander.assault.minMembers)) {
      squad.mission = null
      logEvent(ctx, 'command', `Squad ${squad.id + 1} broke off its assault on the hive`)
    }

    const ammo = alive.reduce((sum, s) => sum + (s.weapon ? roundsLeft(s.weapon) : 0), 0)
    // Low on ammo, and somewhere still has some to restock from.
    const restockAt = roomsWith(ctx.supplies, 'rifleMags', leader)[0] ?? null
    const lowAmmo = !!restockAt && ammo < alive.length * CONFIG.combat.weapons.rifle.magazine * 0.5

    // Pick the order (see the list at the top of this file).
    if (squad.order === 'retreat' ? squad.morale < S.morale.regroupAt : squad.morale < S.morale.breakAt) {
      setOrder(squad, 'retreat', roomGoal(ctx, ['security'], leader))
    } else if (squad.order === 'resupply' || lowAmmo) {
      if (squad.order !== 'resupply') setOrder(squad, 'resupply', restockAt ? randomTileIn(ctx.world, restockAt, ctx.rng) : roomGoal(ctx, ['armory'], leader))
    } else if (squad.guardId >= 0) {
      guardCommander(squad, leader, myrrSeen, ctx)
    } else if (squad.mission === 'assault' && ctx.hive.escapeTo && ctx.agents[ctx.hive.motherId] && !ctx.agents[ctx.hive.motherId].dead) {
      // The Brood Mother is getting away: catching her comes first (they still shoot on the move).
      setOrder(squad, 'assault', tileOf(ctx.agents[ctx.hive.motherId]))
      squad.missionGoal = squad.goal
    } else if (carrier) {
      setOrder(squad, 'rescue', tileOf(carrier))
      squad.targetId = carrier.id
    } else if (myrrSeen) {
      setOrder(squad, 'respond', tileOf(myrrSeen))
    } else if (cocoon && squad.order !== 'cut') {
      setOrder(squad, 'cut', tileOf(cocoon))
      squad.targetId = cocoon.id
    } else if (squad.mission === 'escort' && ctx.commander.evacuation === 'fortify' && (squad.order === 'patrol' || squad.order === 'escort') && fortifyPad(squad, squads, ctx)) {
      // Setting up turrets around the Landing Pad (fortifyPad gave the order).
    } else if (squad.mission && (squad.order === 'patrol' || squad.order === squad.mission)) {
      // Assaults hunt the Brood Mother wherever she is (and chase her if she flees).
      const mother = ctx.agents[ctx.hive.motherId]
      if (squad.mission === 'assault' && mother && !mother.dead) squad.missionGoal = tileOf(mother)
      if (!squad.missionGoal) squad.missionGoal = missionGoal(squad, ctx)
      if (squad.missionGoal) setOrder(squad, squad.mission, squad.missionGoal)
    } else if (squad.order === 'patrol' && squad.charges > 0 && blastSite(ctx)) {
      setOrder(squad, 'blast', blastSite(ctx))
    } else if (heard && squad.order === 'patrol') {
      setOrder(squad, 'respond', { levelIndex: heard.levelIndex, x: Math.floor(heard.x), y: Math.floor(heard.y) })
      squad.lastContactTick = ctx.tick
    } else if (squad.order === 'patrol' && squad.carryingTurret) {
      const site = deploySite(ctx, reservedSites(squads))
      if (site) setOrder(squad, 'deployTurret', site)
    } else if (squad.order === 'patrol' && !squad.carryingTurret && armoryWithTurret(ctx, CONFIG.commander.evacuation.padTurrets) && deploySite(ctx, reservedSites(squads))) {
      setOrder(squad, 'fetchTurret', randomTileIn(ctx.world, armoryWithTurret(ctx, CONFIG.commander.evacuation.padTurrets)!, ctx.rng))
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

/**
 * The command squad: stay with the Commander, fight Myrr that come near them,
 * and chase down anything carrying them off. Once the Commander is lost for good
 * the squad becomes an ordinary one.
 */
function guardCommander(squad: Squad, leader: Agent, myrrSeen: Agent | null, ctx: CombatContext): void {
  const boss = ctx.agents[squad.guardId]
  const carrier = ctx.agents.find((a) => !a.dead && a.myrr?.task === 'carry' && a.myrr.targetId === boss.id)
  if (carrier) {
    setOrder(squad, 'rescue', tileOf(carrier))
    squad.targetId = carrier.id
    return
  }
  if (boss.dead || ['captive', 'cocooned', 'dead', 'evacuated'].includes(boss.civ?.mode ?? 'dead')) {
    squad.guardId = -1
    setOrder(squad, 'patrol', null)
    return
  }
  const range = CONFIG.commander.guardRange
  if (myrrSeen && myrrSeen.levelIndex === boss.levelIndex && dist(myrrSeen, boss) <= range) {
    setOrder(squad, 'respond', tileOf(myrrSeen))
    return
  }
  if (squad.order !== 'guard' || leader.levelIndex !== boss.levelIndex || dist(leader, boss) > 3) setOrder(squad, 'guard', tileOf(boss))
}

/**
 * Fortifying the Landing Pad before the ship is called: carry a turret there and
 * set it up on the pad's edge. Returns true if it gave the squad an order.
 */
function fortifyPad(squad: Squad, squads: Squad[], ctx: CombatContext): boolean {
  const reserved = reservedSites(squads)
  const site = padSite(ctx, reserved)
  if (!site) return false
  if (squad.carryingTurret) { setOrder(squad, 'deployTurret', site); return true }
  // Squads already fetching count toward the turrets wanted.
  const coming = squads.filter((s) => s.carryingTurret || s.order === 'fetchTurret' || s.order === 'deployTurret').length
  const standing = ctx.agents.filter((a) => a.kind === 'turret' && !a.dead && a.levelIndex === 0 &&
    ctx.world.levels[0].rooms[ctx.world.levels[0].roomOf[Math.floor(a.y) * ctx.world.levels[0].width + Math.floor(a.x)]]?.name === 'Landing Pad').length
  const armory = armoryWithTurret(ctx)
  if (!armory || standing + coming >= CONFIG.commander.evacuation.padTurrets) return false
  setOrder(squad, 'fetchTurret', randomTileIn(ctx.world, armory, ctx.rng))
  return true
}

/** Where a mission sends the squad: the Hive Core, or the Landing Pad. */
function missionGoal(squad: Squad, ctx: CombatContext): PathNode | null {
  if (squad.mission === 'assault') {
    const hive = findRooms(ctx.world, ['hive'])[0]
    return hive ? randomTileIn(ctx.world, hive, ctx.rng) : null
  }
  const pad = landingPad(ctx)
  return pad ? randomTileIn(ctx.world, pad, ctx.rng) : null
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
    if (--squad.ticksLeft === 0) {
      if (squad.burnAt) throwIncendiary(squad, alive, ctx)
      else finishWork(squad, alive, ctx)
    }
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
    if (squad.order === 'assault' || squad.order === 'escort') squad.missionReached = true
    if (squad.order === 'assault') squad.goal = null // keep closing in on the target
    return
  }
  if (ctx.tick >= s.repathTick || agent.state.name !== 'moving') {
    s.repathTick = ctx.tick + TPS
    walkTo(agent, goal, ctx)
  }
  // Burn the resin ahead before walking into it (after an ambush), unless lives are at stake.
  if (wantsToBurn(squad, ctx)) {
    const spot = resinAhead(agent, ctx)
    if (spot && canBurn(squad, alive)) {
      squad.burnAt = spot
      squad.ticksLeft = Math.round(CONFIG.incendiaries.throwSeconds * TPS)
      agent.state = { name: 'idle', ticksLeft: 0 }
      return
    }
  }
  followPath(agent, ctx.world)
}

/** Should this squad burn resin ahead of it? The Commander skips it when someone is about to be lost. */
function wantsToBurn(squad: Squad, ctx: CombatContext): boolean {
  if (!ctx.commander.burnResin || squad.order === 'retreat' || squad.order === 'resupply') return false
  const urgent = squad.order === 'rescue' || ((squad.order === 'cut' || squad.mission === 'assault') && hatchingSoon(ctx) > 0)
  if (urgent && !squad.riskTaken) {
    logEvent(ctx, 'command', `The Commander takes the risk: Squad ${squad.id + 1} goes in without burning the resin to save lives`)
  }
  squad.riskTaken = urgent
  return !urgent
}

/** Grenades left, or a flamethrower with fuel to spare. */
function canBurn(squad: Squad, alive: Agent[]): boolean {
  return squad.incendiaries > 0 || alive.some((s) => s.weapon?.kind === 'flamethrower' && s.weapon.inMag >= CONFIG.incendiaries.flamerFuel)
}

/** The first resin tile on the leader's route within throwing range, if any. */
function resinAhead(agent: Agent, ctx: CombatContext): PathNode | null {
  const range = CONFIG.incendiaries.throwRange
  for (const step of agent.path) {
    if (step.levelIndex !== agent.levelIndex) return null
    if (Math.hypot(step.x + 0.5 - agent.x, step.y + 0.5 - agent.y) > range) return null
    const level = ctx.world.levels[step.levelIndex]
    if (level.resin[step.y * level.width + step.x]) return step
  }
  return null
}

/** Throw a grenade (or use the flamethrower) at the resin ahead. */
function throwIncendiary(squad: Squad, alive: Agent[], ctx: CombatContext): void {
  const at = squad.burnAt!
  squad.burnAt = null
  if (squad.incendiaries > 0) squad.incendiaries--
  else {
    const flamer = alive.find((s) => s.weapon?.kind === 'flamethrower' && s.weapon.inMag >= CONFIG.incendiaries.flamerFuel)
    if (!flamer) return
    flamer.weapon!.inMag -= CONFIG.incendiaries.flamerFuel
  }
  burnArea(at, CONFIG.incendiaries.radius, CONFIG.incendiaries.damage, alive[0], ctx)
  makeNoise(ctx.noises, 'smash', at.levelIndex, at.x, at.y, ctx.tick, alive[0].id)
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
    if (stock) squad.incendiaries += take(stock, 'incendiaries', CONFIG.incendiaries.perSquad - squad.incendiaries)
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

/** A room that still has a packed turret (more than `keep`, which are held back for the Landing Pad). */
function armoryWithTurret(ctx: CombatContext, keep = 0): RoomRef | null {
  return [...ctx.supplies.values()].find((s) => s.stock.turrets > keep)?.room ?? null
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
