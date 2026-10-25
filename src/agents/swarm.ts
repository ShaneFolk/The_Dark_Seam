// Swarms: the hive's group attack.
//
// A Taker or raiding Spineback that finds people too many (or too well armed) to
// take alone doesn't back off any more. It holds still and screeches. Nearby
// Takers and Spinebacks answer and gather at the caller. Once enough have come
// (or they've waited long enough), they all rush the group at once, each going
// for a different person. Humans can hear the screech too, a few seconds' warning.
//
// The ship swarm: when the evacuation ship is heard coming down, every Myrr not
// guarding heads for the Landing Pad. They gather a little way short of it along
// their route, then rush everyone on the pad.

import { CONFIG } from '../config.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { findPath } from '../world/pathfinding.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree } from './civilian.ts'
import { canSee } from './perception.ts'
import { makeNoise } from '../systems/noise.ts'
import { logEvent } from '../core/events.ts'
import type { HiveContext } from './myrr.ts'

export interface Swarm {
  /** Where the swarm gathers (the caller's spot). */
  rally: PathNode
  callerId: number
  members: number[]
  startTick: number
  /** Rush once gathered after this long (with at least two); give up after maxWaitSeconds; rush people this close to the rally. */
  waitSeconds: number
  maxWaitSeconds: number
  preyRange: number
  /** Called by a sound, not a sighting: they rush people they can't see yet. */
  heard: boolean
}

const TPS = CONFIG.sim.ticksPerSecond
const W = CONFIG.swarm

/** Tasks a Myrr can drop to answer a swarm call. */
export const CAN_ANSWER = new Set(['rest', 'scout', 'return', 'spread'])

/** Try to start a swarm on the people `caller` has found. Returns true if it did. */
export function callSwarm(caller: Agent, ctx: HiveContext): boolean {
  const hive = ctx.hive
  if (hive.swarm || ctx.tick < hive.nextSwarmTick) return false
  const rally = tileOf(caller)
  const swarm: Swarm = { rally, callerId: caller.id, members: [caller.id], startTick: ctx.tick, waitSeconds: W.waitSeconds, maxWaitSeconds: W.maxWaitSeconds, preyRange: W.preyRange, heard: false }
  hive.swarm = swarm
  joinSwarm(caller)
  caller.path = []
  caller.state = { name: 'idle', ticksLeft: 0 }
  makeNoise(ctx.noises, 'screech', caller.levelIndex, caller.x, caller.y, ctx.tick, caller.id)

  // Everyone close enough and not busy answers the call.
  const guards = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && a.myrr.task === 'guard').length
  let spareGuards = Math.max(0, guards - CONFIG.spinebacks.homeGuards)
  for (const a of ctx.agents) {
    if (a.dead || a === caller || !a.myrr) continue
    const role = a.myrr.role
    const free = (role === 'taker' || role === 'spineback') && CAN_ANSWER.has(a.myrr.task)
    const spareGuard = role === 'spineback' && a.myrr.task === 'guard' && spareGuards > 0
    if (!free && !spareGuard) continue
    const far = Math.abs(a.levelIndex - rally.levelIndex) * W.levelDistance + Math.hypot(a.x - rally.x, a.y - rally.y)
    if (far > W.callRange) continue
    const path = findPath(ctx.world, tileOf(a), rally, 'myrr', { avoid: ctx.pheromones.danger, avoidCost: CONFIG.pheromones.dangerCost })
    if (!path) continue
    if (spareGuard && !free) spareGuards--
    joinSwarm(a)
    a.path = path
    a.state = { name: 'moving' }
    swarm.members.push(a.id)
  }
  logEvent(ctx, 'hive', `A ${caller.kind === 'spineback' ? 'Spineback' : 'Taker'} screeched on Level ${rally.levelIndex + 1}, calling a swarm (${swarm.members.length - 1} answered)`)
  return true
}

/**
 * The ship swarm: every Myrr not guarding (and spare guards) heads for `pad`,
 * gathering a little short of it on the way. Replaces any swarm already gathering.
 * Returns how many answered.
 */
export function callShipSwarm(pad: PathNode, ctx: HiveContext): number {
  return callSwarmAt(pad, W.ship, ctx)
}

/**
 * Send every free Myrr (and spare guards) at a target they know about without
 * seeing it (the ship swarm, the decoy raid). They gather approachTiles short of it
 * along the route from the hive, then rush. Returns how many answered.
 */
export function callSwarmAt(target: PathNode, S: { approachTiles: number; waitSeconds: number; maxWaitSeconds: number; preyRange: number }, ctx: HiveContext): number {
  const hive = ctx.hive
  // The rally point: approachTiles short of the target along the route from the hive.
  const mother = ctx.agents[hive.motherId]
  const from = mother && !mother.dead ? tileOf(mother) : null
  const route = from ? findPath(ctx.world, from, target, 'myrr') : null
  const rally = route && route.length > S.approachTiles ? route[route.length - 1 - S.approachTiles] : target
  const swarm: Swarm = { rally, callerId: -1, members: [], startTick: ctx.tick, waitSeconds: S.waitSeconds, maxWaitSeconds: S.maxWaitSeconds, preyRange: S.preyRange, heard: true }
  hive.swarm = swarm
  const guards = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && a.myrr.task === 'guard').length
  let spareGuards = Math.max(0, guards - CONFIG.spinebacks.homeGuards)
  for (const a of ctx.agents) {
    if (a.dead || !a.myrr) continue
    const role = a.myrr.role
    const free = (role === 'taker' || role === 'spineback') && (CAN_ANSWER.has(a.myrr.task) || a.myrr.task === 'swarm')
    const spareGuard = role === 'spineback' && a.myrr.task === 'guard' && spareGuards > 0
    if (!free && !spareGuard) continue
    const path = findPath(ctx.world, tileOf(a), rally, 'myrr')
    if (!path) continue
    if (spareGuard && !free) spareGuards--
    joinSwarm(a)
    a.path = path
    a.state = { name: 'moving' }
    swarm.members.push(a.id)
  }
  if (!swarm.members.length) hive.swarm = null
  return swarm.members.length
}

function joinSwarm(a: Agent): void {
  const m = a.myrr!
  m.task = 'swarm'
  m.targetId = -1
  m.swarmHunt = false
}

/** Run the swarm: wait for members to gather, then rush, or give up. Once per perception interval. */
export function updateSwarm(ctx: HiveContext): void {
  const swarm = ctx.hive.swarm
  if (!swarm || ctx.tick % CONFIG.perception.intervalTicks !== 0) return
  const members = swarm.members.map((id) => ctx.agents[id]).filter((a) => a && !a.dead && a.myrr?.task === 'swarm')
  const age = (ctx.tick - swarm.startTick) / TPS
  const r = swarm.rally
  const gathered = members.filter((a) => a.levelIndex === r.levelIndex && Math.hypot(a.x - r.x, a.y - r.y) <= W.gatherRadius)

  // The ship swarm waits for most of its members; a screech swarm for a handful.
  const enough = swarm.heard ? Math.max(W.size, Math.ceil(members.length * 0.75)) : W.size
  if (gathered.length >= enough || (age >= swarm.waitSeconds && gathered.length >= 2)) return rush(swarm, gathered, ctx)
  if (age >= swarm.maxWaitSeconds || !members.length) return disband(members, ctx)
}

/** Everyone gathered goes for the people near the rally point, spread across them. */
function rush(swarm: Swarm, gathered: Agent[], ctx: HiveContext): void {
  const r = swarm.rally
  const level = ctx.world.levels[r.levelIndex]
  const prey = ctx.agents
    .filter((h) => !h.dead && h.side === 'human' && h.kind !== 'turret' && isFree(h) && h.levelIndex === r.levelIndex &&
      Math.hypot(h.x - r.x, h.y - r.y) <= swarm.preyRange && (swarm.heard || gathered.some((m) => canSee(m, h, level, CONFIG.hive.sightRange + 4))))
    .sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y))
  if (!prey.length) return disband(gathered, ctx)
  gathered.forEach((a, i) => {
    const m = a.myrr!
    const target = prey[i % prey.length]
    m.task = 'hunt'
    m.targetId = target.id
    m.swarmHunt = true
    m.lastSeenTick = ctx.tick
    m.repathTick = ctx.tick
    m.huntStartTick = ctx.tick
  })
  ctx.hive.swarm = null
  ctx.hive.nextSwarmTick = ctx.tick + Math.round(W.cooldownSeconds * TPS)
  logEvent(ctx, 'hive', `A swarm of ${gathered.length} Myrr rushed ${prey.length} ${prey.length === 1 ? 'person' : 'people'} on Level ${r.levelIndex + 1}`)
}

/** Not enough came, or nobody to rush: everyone goes back to what they were doing. */
function disband(members: Agent[], ctx: HiveContext): void {
  for (const a of members) {
    const m = a.myrr!
    m.task = 'rest'
    m.ticksLeft = TPS
    a.path = []
    a.state = { name: 'idle', ticksLeft: 0 }
  }
  ctx.hive.swarm = null
  ctx.hive.nextSwarmTick = ctx.tick + Math.round(W.cooldownSeconds * TPS)
}
