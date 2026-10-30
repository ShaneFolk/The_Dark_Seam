// Landing scouts.
//
// Riding the elevator down means stepping out wherever it stops, with no way to
// look first. So a squad of a few soldiers heading down by elevator stops at the
// top and sends one soldier down alone. The scout looks around for a few
// seconds and rides back up.
//
//   saw Myrr, died, or didn't come back in time  ->  the landing is "hot": for a
//     few minutes squads plan their routes as if the elevator were very slow
//     there, so they take a ladder instead (unless there's no other way)
//   all quiet  ->  the landing is "clear" for a while and the squad rides down
//
// The scout's ride makes the elevator clank too (landing.ts), so scouting can be
// what wakes the hive. Better one soldier finds that out than the whole squad.

import { CONFIG } from '../config.ts'
import { findPath, type PathNode } from '../world/pathfinding.ts'
import type { Link } from '../world/links.ts'
import { Tile } from '../world/tiles.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree } from './civilian.ts'
import { nearestVisible } from './combat.ts'
import { followPath } from './movement.ts'
import { humanSight } from '../systems/power.ts'
import { landingKey, placeName } from './landing.ts'
import { logEvent } from '../core/events.ts'
import type { World } from '../world/loadWorld.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'
import type { Squad } from './soldier.ts'

const TPS = CONFIG.sim.ticksPerSecond
const SC = CONFIG.landing.scout

export interface Scouting {
  scoutId: number
  key: string
  /** Bottom of the elevator, where the scout looks around. */
  bottom: PathNode
  phase: 'down' | 'look' | 'up'
  /** Ticks left before the squad gives up waiting, and ticks left looking around. */
  ticksLeft: number
  lookLeft: number
  saw: boolean
}

/** What the humans know about each elevator landing (by landingKey). */
export type LandingNotes = Record<string, { hotUntil: number; clearUntil: number; scoutedUntil: number }>

/** Extra route cost for humans going down an elevator to a landing known to be hot. */
export function landingCost(ctx: CombatContext): (link: Link, fromLevelId: number) => number {
  return (link, fromLevelId) => {
    if (link.kind !== 'elevator' || fromLevelId !== link.ends[0].level) return 0
    const bottom = endTile(ctx.world, link.ends[1])
    if (!bottom) return 0
    const note = ctx.commander.landings[landingKey(ctx.world, bottom)]
    return note && note.hotUntil > ctx.tick ? SC.hotPenaltySeconds : 0
  }
}

/**
 * The leader is about to ride an elevator down: stop and send a scout first, if
 * the squad is big enough, isn't in a hurry, and nobody has checked the landing lately.
 */
export function startScouting(squad: Squad, leader: Agent, alive: Agent[], ctx: CombatContext): boolean {
  if (squad.scouting || alive.length < SC.minSquad) return false
  if (squad.order === 'rescue' || squad.order === 'retreat') return false
  // The first level change on the route, if it's an elevator going down close ahead.
  let prev = tileOf(leader)
  let bottom: PathNode | null = null
  for (const step of leader.path) {
    if (step.levelIndex !== prev.levelIndex) {
      const level = ctx.world.levels[prev.levelIndex]
      if (step.levelIndex > prev.levelIndex && level.tiles[prev.y * level.width + prev.x] === Tile.Elevator) bottom = step
      break
    }
    if (Math.hypot(step.x - leader.x, step.y - leader.y) > SC.startTiles + 1) return false
    prev = step
  }
  if (!bottom || prev.levelIndex !== leader.levelIndex || Math.hypot(prev.x + 0.5 - leader.x, prev.y + 0.5 - leader.y) > SC.startTiles) return false
  const key = landingKey(ctx.world, bottom)
  const note = ctx.commander.landings[key]
  if (note && (note.hotUntil > ctx.tick || note.clearUntil > ctx.tick)) return false
  // Another squad's scout is already down there: wait at the top for word.
  if (note && note.scoutedUntil > ctx.tick) {
    leader.path = []
    leader.state = { name: 'idle', ticksLeft: 0 }
    return true
  }

  const others = alive.slice(1)
  const scout = others.filter((s) => s.soldier!.role === 'soldier').pop() ?? others.pop()
  if (!scout) return false
  const path = findPath(ctx.world, tileOf(scout), bottom, 'human')
  if (!path?.length) return false
  scout.path = path
  scout.state = { name: 'moving' }
  ctx.commander.landings[key] = { hotUntil: 0, clearUntil: 0, scoutedUntil: ctx.tick + Math.round(SC.maxSeconds * TPS) }
  squad.scouting = { scoutId: scout.id, key, bottom, phase: 'down', ticksLeft: Math.round(SC.maxSeconds * TPS), lookLeft: Math.round(SC.lookSeconds * TPS), saw: false }
  leader.path = []
  leader.state = { name: 'idle', ticksLeft: 0 }
  logEvent(ctx, 'command', `Squad ${squad.id + 1} stops at the elevator and sends a scout down to the ${placeName(ctx.world, bottom)}`)
  return true
}

/** The rest of the squad waits at the top. Returns true while it should hold still. */
export function waitForScout(squad: Squad, leader: Agent, ctx: CombatContext): boolean {
  const sc = squad.scouting
  if (!sc) return false
  const scout = ctx.agents[sc.scoutId]
  if (!squad.members.includes(sc.scoutId) || sc.scoutId === leader.id || squad.order === 'retreat') {
    squad.scouting = null
    ctx.commander.landings[sc.key].scoutedUntil = 0
    return false
  }
  if (!scout || scout.dead || !isFree(scout)) return finish(squad, leader, ctx, 'lost')
  if (--sc.ticksLeft <= 0) return finish(squad, leader, ctx, sc.saw ? 'saw' : 'lost')
  if (leader.state.name !== 'crossing') {
    leader.path = []
    leader.state = { name: 'idle', ticksLeft: 0 }
  }
  return true
}

/** The scout's trip: down, a look around, back up to the leader. */
export function updateScout(agent: Agent, squad: Squad, leader: Agent, ctx: CombatContext): void {
  const sc = squad.scouting!
  if (agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }
  if (sc.phase === 'down') {
    if (agent.levelIndex === sc.bottom.levelIndex) {
      sc.phase = 'look'
      agent.path = []
      agent.state = { name: 'idle', ticksLeft: 0 }
    } else followPath(agent, ctx.world)
  }
  if (sc.phase === 'look') {
    if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0 &&
      nearestVisible(agent, ctx, humanSight(ctx.power, agent.levelIndex), (a) => a.side === 'myrr')) sc.saw = true
    if (sc.saw || --sc.lookLeft <= 0) {
      sc.phase = 'up'
      walk(agent, tileOf(leader), ctx)
    }
    return
  }
  if (sc.phase === 'up') {
    if (agent.levelIndex === leader.levelIndex && Math.hypot(agent.x - leader.x, agent.y - leader.y) <= SC.startTiles + 1) {
      finish(squad, leader, ctx, sc.saw ? 'saw' : 'clear')
      return
    }
    if (agent.state.name !== 'moving' || !agent.path.length) walk(agent, tileOf(leader), ctx)
    followPath(agent, ctx.world)
  }
}

function finish(squad: Squad, leader: Agent, ctx: CombatContext, result: 'saw' | 'lost' | 'clear'): false {
  const sc = squad.scouting!
  squad.scouting = null
  leader.soldier!.repathTick = 0
  const place = placeName(ctx.world, sc.bottom)
  if (result === 'clear') {
    ctx.commander.landings[sc.key] = { hotUntil: 0, clearUntil: ctx.tick + Math.round(SC.clearSeconds * TPS), scoutedUntil: 0 }
    logEvent(ctx, 'command', `Squad ${squad.id + 1}'s scout found the ${place} clear: the squad rides down`)
  } else {
    ctx.commander.landings[sc.key] = { hotUntil: ctx.tick + Math.round(SC.hotSeconds * TPS), clearUntil: 0, scoutedUntil: 0 }
    const what = result === 'saw' ? 'saw Myrr at' : "didn't come back from"
    logEvent(ctx, 'command', `Squad ${squad.id + 1}'s scout ${what} the ${place}: squads take a ladder down for a while`)
  }
  return false
}

function walk(agent: Agent, to: PathNode, ctx: CombatContext): void {
  const path = findPath(ctx.world, tileOf(agent), to, 'human')
  if (path?.length) {
    agent.path = path
    agent.state = { name: 'moving' }
  }
}

function endTile(world: World, end: Link['ends'][number]): PathNode | null {
  const levelIndex = world.levels.findIndex((l) => l.id === end.level)
  return levelIndex < 0 ? null : { levelIndex, x: end.x, y: end.y }
}
