// The nest: where the hive keeps its cocoons, and how it adapts.
//
// Cocoons start along the walls of the Hive Core. Once soldiers have been in
// among them, the hive moves them: when the soldiers have gone, it picks another
// room on Level 3 (the "nursery"), and Takers carry the cocoons there one each,
// coating the new spot with resin. New cocoons go to the nursery too. So a second
// assault can't just repeat the first one; the soldiers have to find them again.
//
// A Taker hauling a cocoon is slowed, and soldiers who see one will chase it
// (like a Taker carrying a person). Kill it and the cocoon is left where it fell.

import { CONFIG } from '../config.ts'
import { findPath, type PathNode } from '../world/pathfinding.ts'
import { cornerTiles, findRooms, randomTileIn, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree } from './civilian.ts'
import { followPath } from './movement.ts'
import { coatResin } from '../systems/resin.ts'
import { logEvent } from '../core/events.ts'
import type { HiveContext } from './myrr.ts'

const TPS = CONFIG.sim.ticksPerSecond
const N = CONFIG.nest

/** The room the cocoons are kept in: the nursery once the hive has moved them, else the Hive Core. */
export function nurseryRoom(ctx: HiveContext): RoomRef {
  return ctx.hive.nursery ?? findRooms(ctx.world, ['hive'])[0]
}

/** Every few seconds: notice soldiers among the cocoons; once they've gone, move the nest. */
export function planNest(ctx: HiveContext): void {
  if (ctx.tick % (5 * TPS) !== 0) return
  const hive = ctx.hive
  if (hive.collapsing) return
  const room = nurseryRoom(ctx)
  const inRoom = (a: Agent) => sameRoom(roomAt(ctx.world, tileOf(a)), room)
  const cocoons = ctx.agents.filter((a) => !a.dead && a.civ?.mode === 'cocooned')
  if (ctx.agents.some((a) => a.soldier && isFree(a) && inRoom(a)) && cocoons.some(inRoom)) {
    hive.raided = true
    return
  }
  if (!hive.raided || hive.nestMoves >= N.maxMoves || ctx.tick < hive.nextNestTick || !cocoons.length) return
  hive.raided = false

  // Another Level 3 room the Myrr can reach (not the Brood Mother's Deep Chamber).
  const from = tileOf(cocoons[0])
  const options = findRooms(ctx.world, ['other', 'hive'], room.levelIndex)
    .filter((r) => !sameRoom(r, room) && r.room.name !== 'Deep Chamber' && !r.room.outdoor)
    .filter((r) => !!findPath(ctx.world, from, randomTileIn(ctx.world, r, ctx.rng), 'myrr'))
  if (!options.length) return
  hive.nursery = ctx.rng.pick(options)
  hive.nestMoves++
  hive.nextNestTick = ctx.tick + Math.round(N.cooldownSeconds * TPS)
  logEvent(ctx, 'hive', `The hive is moving its cocoons to the ${hive.nursery.room.name}`)

  // One free Taker per cocoon, nearest first.
  const free = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'taker' && ['rest', 'scout', 'return', 'spread'].includes(a.myrr.task))
  for (const cocoon of cocoons) {
    if (!free.length) break
    free.sort((a, b) => distance(a, cocoon) - distance(b, cocoon))
    const taker = free.shift()!
    if (!walk(taker, tileOf(cocoon), ctx)) continue
    taker.myrr!.task = 'haul'
    taker.myrr!.targetId = cocoon.id
  }
}

/**
 * A Taker's haul: walk to the cocoon ('haul'), then carry it to the nursery
 * ('haulCarry'). Returns true when the job is over (done, or the cocoon is gone).
 */
export function updateHaul(agent: Agent, ctx: HiveContext): boolean {
  const m = agent.myrr!
  const cocoon = ctx.agents[m.targetId]
  if (!cocoon || cocoon.dead || cocoon.civ?.mode !== 'cocooned') return finish(agent)

  if (m.task === 'haul') {
    if (cocoon.levelIndex === agent.levelIndex && Math.hypot(cocoon.x - agent.x, cocoon.y - agent.y) <= 1.5) {
      // Picked up: off to the nursery, slowed by the load.
      if (!walk(agent, nurserySpot(ctx), ctx)) return finish(agent)
      m.task = 'haulCarry'
      agent.speed = agent.baseSpeed * N.haulSpeedMultiplier
      return false
    }
    if (agent.state.name !== 'moving' && !walk(agent, tileOf(cocoon), ctx)) return finish(agent)
    followPath(agent, ctx.world)
    return false
  }

  const arrived = followPath(agent, ctx.world)
  carryCocoon(agent, ctx)
  if (!arrived) return false
  // Set it down and coat the spot, so it sits on resin like the others.
  ctx.hive.resinTiles += coatResin(ctx.world, tileOf(agent), CONFIG.resin.maxTiles - ctx.hive.resinTiles)
  return finish(agent)
}

/** Keep the hauled cocoon with the Taker (also while crossing between levels). */
export function carryCocoon(agent: Agent, ctx: HiveContext): void {
  const cocoon = ctx.agents[agent.myrr!.targetId]
  if (!cocoon || cocoon.dead) return
  cocoon.levelIndex = agent.levelIndex
  cocoon.x = agent.x
  cocoon.y = agent.y
}

/** A free corner of the nursery (cocoons line its walls). */
export function nurserySpot(ctx: HiveContext): PathNode {
  const room = nurseryRoom(ctx)
  const taken = new Set(ctx.agents.filter((a) => a.civ?.mode === 'cocooned').map((a) => `${Math.floor(a.x)},${Math.floor(a.y)}`))
  // In the Hive Core, cocoons stay outside the Brood Mother's inner chamber.
  const home = ctx.hive.motherHome
  const core = !ctx.hive.nursery
  const free = cornerTiles(ctx.world, room).filter((t) => !taken.has(`${t.x},${t.y}`) &&
    (!core || !home || Math.hypot(t.x - home.x, t.y - home.y) > CONFIG.lifecycle.chamberRadius))
  return free.length ? ctx.rng.pick(free) : randomTileIn(ctx.world, room, ctx.rng)
}

function finish(agent: Agent): boolean {
  agent.speed = agent.baseSpeed
  agent.myrr!.targetId = -1
  return true
}

function walk(agent: Agent, to: PathNode, ctx: HiveContext): boolean {
  const path = findPath(ctx.world, tileOf(agent), to, 'myrr')
  if (!path?.length) return false
  agent.path = path
  agent.state = { name: 'moving' }
  return true
}

function distance(a: Agent, b: Agent): number {
  return Math.abs(a.levelIndex - b.levelIndex) * 200 + Math.hypot(a.x - b.x, a.y - b.y)
}
