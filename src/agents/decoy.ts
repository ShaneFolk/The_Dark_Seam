// The decoy: the hive's diversion.
//
// Once the humans have shown they fight back, the hive sometimes sends one Taker
// to a motion sensor in the Upper Mine. It paces around it, setting it off again
// and again, and smashes things to be heard. The nearest squad runs down to check.
// Shortly after the noise starts, a swarm raids the surface room with the most
// people and no soldiers nearby. If humans get close, the decoy runs for home.

import { CONFIG } from '../config.ts'
import { canWalk, findPath, type PathNode } from '../world/pathfinding.ts'
import { randomTileIn, roomAt, type RoomRef } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree } from './civilian.ts'
import { followPath, isMoving } from './movement.ts'
import { nearestVisible, type CombatContext } from './combat.ts'
import { makeNoise } from '../systems/noise.ts'
import { logEvent } from '../core/events.ts'
import { callSwarmAt, CAN_ANSWER } from './swarm.ts'

export interface Decoy {
  takerId: number
  /** The sensor it paces around. */
  at: PathNode
  startTick: number
  /** Tick the noise started (it reached the sensor), or null. */
  noisyFrom: number | null
  raided: boolean
}

const TPS = CONFIG.sim.ticksPerSecond
const D = CONFIG.decoy

/** Every few seconds: start a decoy when the time is right, and launch the raid once the noise is going. */
export function planDecoy(ctx: CombatContext): void {
  if (ctx.tick % (5 * TPS) !== 0) return
  const hive = ctx.hive
  const d = hive.decoy
  if (d) {
    if (!d.raided && d.noisyFrom !== null && ctx.tick >= d.noisyFrom + D.raidAfterSeconds * TPS) raid(d, ctx)
    if (ctx.tick - d.startTick > D.maxSeconds * TPS) hive.decoy = null
    return
  }
  if (ctx.tick < hive.nextDecoyTick || hive.swarm || hive.collapsing || !ctx.sensors?.length) return
  if (hive.losses.taker + hive.losses.spineback < D.afterLosses) return
  const free = ctx.agents.filter((a) => !a.dead && (a.myrr?.role === 'taker' || a.myrr?.role === 'spineback') && CAN_ANSWER.has(a.myrr.task))
  if (free.length < D.minFree || !raidTarget(ctx) || !ctx.rng.chance(D.chance)) return

  const sensor = ctx.rng.pick(ctx.sensors)
  const at = { levelIndex: sensor.levelIndex, x: Math.floor(sensor.x), y: Math.floor(sensor.y) }
  const takers = free.filter((a) => a.myrr!.role === 'taker')
    .sort((a, b) => dist(a, at) - dist(b, at))
  for (const t of takers) {
    if (!walk(t, at, ctx)) continue
    t.myrr!.task = 'decoy'
    t.myrr!.targetId = -1
    hive.decoy = { takerId: t.id, at, startTick: ctx.tick, noisyFrom: null, raided: false }
    hive.nextDecoyTick = ctx.tick + Math.round(D.cooldownSeconds * TPS)
    logEvent(ctx, 'hive', `A Taker slips off toward a motion sensor on Level ${at.levelIndex + 1}: a decoy`)
    return
  }
}

/**
 * The decoy Taker: get to the sensor, then pace around it and make noise until
 * its time is up. Returns true when it's done (it then goes home).
 */
export function updateDecoy(agent: Agent, ctx: CombatContext): boolean {
  const d = ctx.hive.decoy
  if (!d || d.takerId !== agent.id) return true
  // Humans close: run for it (no raid if the noise never started).
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0 &&
      nearestVisible(agent, ctx, D.fleeRange, (a) => a.side === 'human' && isFree(a))) {
    return end(d, ctx)
  }
  if (d.noisyFrom !== null) {
    if (ctx.tick - d.noisyFrom > D.holdSeconds * TPS) return end(d, ctx)
    if ((ctx.tick - d.noisyFrom) % Math.round(D.noiseEverySeconds * TPS) === 0) {
      makeNoise(ctx.noises, 'smash', agent.levelIndex, agent.x, agent.y, ctx.tick, agent.id)
    }
  }
  if (isMoving(agent)) {
    followPath(agent, ctx.world)
    return false
  }
  const near = agent.levelIndex === d.at.levelIndex && Math.hypot(agent.x - d.at.x, agent.y - d.at.y) <= D.paceRadius + 1.5
  if (!near) return walk(agent, d.at, ctx) ? false : end(d, ctx)
  if (d.noisyFrom === null) {
    d.noisyFrom = ctx.tick
    logEvent(ctx, 'hive', 'The decoy is making a racket around the motion sensor')
  }
  // Keep moving around the sensor so it keeps going off.
  const level = ctx.world.levels[d.at.levelIndex]
  for (let tries = 0; tries < 10; tries++) {
    const x = d.at.x + ctx.rng.int(-D.paceRadius, D.paceRadius), y = d.at.y + ctx.rng.int(-D.paceRadius, D.paceRadius)
    if (canWalk(level, x, y, 'myrr') && walk(agent, { levelIndex: d.at.levelIndex, x, y }, ctx)) break
  }
  return false
}

/** The decoy's part is over. Without any noise made, the raid is called off too. */
function end(d: Decoy, ctx: CombatContext): boolean {
  if (d.noisyFrom === null) ctx.hive.decoy = null
  else d.takerId = -1
  return true
}

/** The swarm hits the surface room with the most people and no soldiers near. */
function raid(d: Decoy, ctx: CombatContext): void {
  d.raided = true
  const target = raidTarget(ctx)
  if (!target) return
  const n = callSwarmAt(randomTileIn(ctx.world, target, ctx.rng), D.raid, ctx)
  if (n) logEvent(ctx, 'hive', `While the soldiers chase the noise, ${n} Myrr move on the ${target.room.name}`)
}

/** A Level 1 room with at least minPrey free people in it and no free soldier within soldierClear tiles. */
function raidTarget(ctx: CombatContext): RoomRef | null {
  const counts = new Map<number, { room: RoomRef; n: number }>()
  for (const a of ctx.agents) {
    if (a.dead || a.levelIndex !== 0 || !isFree(a) || a.soldier || a.kind === 'turret') continue
    const r = roomAt(ctx.world, tileOf(a))
    if (!r) continue
    const entry = counts.get(r.room.index) ?? { room: r, n: 0 }
    entry.n++
    counts.set(r.room.index, entry)
  }
  const soldiers = ctx.agents.filter((a) => !a.dead && a.soldier && isFree(a) && a.levelIndex === 0)
  let best: { room: RoomRef; n: number } | null = null
  for (const e of counts.values()) {
    if (e.n < D.minPrey) continue
    if (soldiers.some((s) => Math.hypot(s.x - e.room.room.centerX, s.y - e.room.room.centerY) <= D.soldierClear)) continue
    if (!best || e.n > best.n) best = e
  }
  return best?.room ?? null
}

function walk(agent: Agent, to: PathNode, ctx: CombatContext): boolean {
  const path = findPath(ctx.world, tileOf(agent), to, 'myrr')
  if (!path?.length) return false
  agent.path = path
  agent.state = { name: 'moving' }
  return true
}

function dist(a: Agent, p: PathNode): number {
  return Math.abs(a.levelIndex - p.levelIndex) * 200 + Math.hypot(a.x - p.x, a.y - p.y)
}
