// The hive and the elevator.
//
// The elevator is loud: while a human rides it, it clanks at both ends, and
// Myrr close enough to hear it come to look (a few Takers, and Spinebacks the
// Brood Mother can spare). The ladders are quiet.
//
// The hive also learns: once it has noticed squads coming down an elevator a
// couple of times, whenever it hears the elevator running it has spare Spinebacks stake out the bottom, hidden on resin
// near the landing, and strike when soldiers come close. It's a risk, not a wall:
// only a couple wait there, for a few minutes, and squads can scout first or
// take a ladder (see scout.ts).

import { CONFIG } from '../config.ts'
import type { LinkKind } from '../world/links.ts'
import { canWalk, findPath, type PathNode } from '../world/pathfinding.ts'
import { roomAt } from '../world/rooms.ts'
import { Tile } from '../world/tiles.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree } from './civilian.ts'
import { followPath, isMoving } from './movement.ts'
import { canHear, canSee } from './perception.ts'
import { coatResin } from '../systems/resin.ts'
import { makeNoise } from '../systems/noise.ts'
import { logEvent } from '../core/events.ts'
import type { World } from '../world/loadWorld.ts'
import type { CombatContext } from './combat.ts'
import { intruderCount } from './lifecycle.ts'

const TPS = CONFIG.sim.ticksPerSecond
const LD = CONFIG.landing
const ST = LD.stakeout

/** What the hive knows about the elevator landings. */
export interface LandingWatch {
  /** Rides down by soldiers the hive has noticed (rides close together count once), and the last one's tick. */
  ridesSeen: number
  lastRideTick: number
  /** Where the last squad came out at the bottom: the spot to stake out. */
  at: PathNode | null
  /** Next tick Spinebacks may be sent to stake it out, and the last tick the elevator was heard running. */
  nextTick: number
  lastClankTick: number
  /** Last tick Myrr were sent to look at each noisy elevator end (by place). */
  heard: Record<string, number>
}

export function createLandingWatch(): LandingWatch {
  return { ridesSeen: 0, lastRideTick: -1e9, at: null, nextTick: 0, lastClankTick: -1e9, heard: {} }
}

/** The name of the place a tile is in, for the log. */
export function placeName(world: World, at: PathNode): string {
  return roomAt(world, at)?.room.name ?? `elevator on Level ${at.levelIndex + 1}`
}

/** A key for "this landing" (the room it opens into, else the spot). */
export function landingKey(world: World, at: PathNode): string {
  const room = roomAt(world, at)
  return room ? `${at.levelIndex}:r${room.room.index}` : `${at.levelIndex}:${at.x >> 2},${at.y >> 2}`
}

// ---------------------------------------------------------------- the noise

/** Each tick of a ride: a human on the elevator makes it clank, at both ends. */
export function elevatorRide(agent: Agent, kind: LinkKind | null, from: PathNode, to: PathNode, ticksLeft: number, ctx: CombatContext): void {
  if (kind !== 'elevator' || agent.side !== 'human') return
  if (ticksLeft % Math.round(LD.noiseEverySeconds * TPS) !== 0) return
  ctx.hive.landing.lastClankTick = ctx.tick
  for (const end of [from, to]) makeNoise(ctx.noises, 'elevator', end.levelIndex, end.x + 0.5, end.y + 0.5, ctx.tick, agent.id)
}

/** Myrr who hear the elevator come to look (a few, and not the Brood Mother's last guards). */
export function planListening(ctx: CombatContext): void {
  if (ctx.tick % CONFIG.perception.intervalTicks !== 0) return
  const since = ctx.tick - CONFIG.perception.intervalTicks
  const watch = ctx.hive.landing
  for (const noise of ctx.noises) {
    if (noise.kind !== 'elevator' || noise.tick <= since) continue
    const at = { levelIndex: noise.levelIndex, x: Math.floor(noise.x), y: Math.floor(noise.y) }
    const key = landingKey(ctx.world, at)
    if (ctx.tick - (watch.heard[key] ?? -1e9) < LD.listenCooldownSeconds * TPS) continue
    const level = ctx.world.levels[noise.levelIndex]
    let guards = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && a.myrr.task === 'guard').length
    const listeners = ctx.agents
      .filter((a) => !a.dead && a.myrr && canHear(a, noise, level) && free(a))
      .sort((a, b) => Math.hypot(a.x - noise.x, a.y - noise.y) - Math.hypot(b.x - noise.x, b.y - noise.y))
    let sent = 0
    for (const a of listeners) {
      if (sent >= LD.listeners) break
      const m = a.myrr!
      if (m.task === 'guard') {
        if (guards <= CONFIG.spinebacks.homeGuards + ST.keepGuards) continue
        guards--
      }
      const path = findPath(ctx.world, tileOf(a), at, 'myrr')
      if (!path?.length) continue
      // Spinebacks answer as they would an alarm; Takers go scouting there.
      m.task = m.task === 'guard' ? 'respond' : 'scout'
      m.lastSeenTick = ctx.tick
      a.path = path
      a.state = { name: 'moving' }
      sent++
    }
    if (!sent) continue
    watch.heard[key] = ctx.tick
    logEvent(ctx, 'hive', `The elevator's clatter drew ${sent} Myrr toward the ${placeName(ctx.world, at)}`)
  }
}

/** Free to go and look: resting or wandering Takers (and raiders), and guarding Spinebacks. */
function free(a: Agent): boolean {
  const m = a.myrr!
  if (m.role === 'spineback') return m.task === 'guard' || m.task === 'rest'
  return m.role === 'taker' && (m.task === 'rest' || m.task === 'scout' || m.task === 'return' || m.task === 'spread')
}

// ---------------------------------------------------------------- learning and staking out

/** A soldier just came down an elevator: the hive takes note. */
export function noteArrival(agent: Agent, kind: LinkKind | null, from: PathNode, to: PathNode, ctx: CombatContext): void {
  if (kind !== 'elevator' || !agent.soldier || to.levelIndex <= from.levelIndex) return
  const watch = ctx.hive.landing
  watch.at = to
  if (ctx.tick - watch.lastRideTick < ST.rideGapSeconds * TPS) return
  watch.lastRideTick = ctx.tick
  if (++watch.ridesSeen === ST.learnAfter) {
    logEvent(ctx, 'hive', `The hive has noticed soldiers keep coming down the elevator to the ${placeName(ctx.world, to)}: it will watch the landing`)
  }
}

/** Every few seconds: once learned, keep a couple of spare Spinebacks hidden by the landing. */
export function planStakeout(ctx: CombatContext): void {
  if (ctx.tick % (5 * TPS) !== 0) return
  const watch = ctx.hive.landing
  if (watch.ridesSeen < ST.learnAfter || !watch.at || ctx.tick < watch.nextTick || ctx.hive.collapsing || ctx.hive.escapeTo || intruderCount(ctx) > 0) return
  // Only while the elevator is in use: otherwise the Spinebacks are better off raiding.
  if (ctx.tick - watch.lastClankTick > ST.activeSeconds * TPS) return
  const spinebacks = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback')
  const lurking = spinebacks.filter((a) => a.myrr!.task === 'stakeout').length
  let guards = spinebacks.filter((a) => a.myrr!.task === 'guard').length
  const spots = hidingSpots(ctx.world, watch.at)
  if (!spots.length) return
  const at = watch.at
  // Raiders out looking for prey, and guards beyond the ones kept at home.
  const spare = spinebacks
    .filter((a) => a.myrr!.task === 'scout' || a.myrr!.task === 'rest' || (a.myrr!.task === 'guard' && !isMoving(a)))
    .sort((a, b) => far(a, at) - far(b, at))
  let sent = 0
  for (const a of spare) {
    if (lurking + sent >= ST.maxLurkers) break
    if (a.myrr!.task === 'guard' && guards <= CONFIG.spinebacks.homeGuards + ST.keepGuards) continue
    if (a.myrr!.task === 'guard') guards--
    const path = findPath(ctx.world, tileOf(a), ctx.rng.pick(spots), 'myrr')
    if (!path?.length) continue
    const m = a.myrr!
    m.task = 'stakeout'
    m.targetId = -1
    m.ticksLeft = Math.round(ST.lurkSeconds * TPS)
    a.path = path
    a.state = { name: 'moving' }
    sent++
  }
  if (!sent) return
  watch.nextTick = ctx.tick + Math.round(ST.everySeconds * TPS)
  logEvent(ctx, 'hive', `${sent} Spineback${sent === 1 ? ' goes' : 's go'} to lie in wait by the elevator at the ${placeName(ctx.world, at)}`)
}

/** A Spineback staking out the landing: get to its spot, coat it, keep still, strike when someone comes close. */
export function updateStakeout(agent: Agent, ctx: CombatContext): void {
  const m = agent.myrr!
  // Time's up, or the Brood Mother needs her guards: back to guarding.
  if (--m.ticksLeft <= 0 || ctx.hive.escapeTo || ((ctx.tick + agent.id) % TPS === 0 && intruderCount(ctx) > 0)) {
    m.task = 'guard'
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    return
  }
  if (isMoving(agent)) {
    if (followPath(agent, ctx.world) && agent.state.name !== 'crossing') {
      ctx.hive.resinTiles += coatResin(ctx.world, tileOf(agent), CONFIG.resin.maxTiles - ctx.hive.resinTiles)
    }
    return
  }
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks !== 0) return
  const level = ctx.world.levels[agent.levelIndex]
  const prey = ctx.agents.find((h) => !h.dead && isFree(h) && h.kind !== 'turret' && h.levelIndex === agent.levelIndex &&
    Math.hypot(h.x - agent.x, h.y - agent.y) <= ST.strikeRange && canSee(agent, h, level, ST.strikeRange))
  if (!prey) return
  // Out of hiding: fight like a Spineback answering an alarm.
  logEvent(ctx, 'hive', `A Spineback springs out of hiding at the ${placeName(ctx.world, tileOf(agent))}`)
  m.task = 'respond'
  m.targetId = prey.id
  m.lastSeenTick = ctx.tick
}

/** Floor tiles a few steps from the bottom of the elevator (hideMinTiles to hideMaxTiles), along a wall if possible. */
function hidingSpots(world: World, at: PathNode): PathNode[] {
  const level = world.levels[at.levelIndex]
  const out: PathNode[] = []
  const r = ST.hideMaxTiles
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dy), x = at.x + dx, y = at.y + dy
    if (d < ST.hideMinTiles || d > r || !canWalk(level, x, y, 'myrr') || level.tiles[y * level.width + x] !== Tile.Floor) continue
    out.push({ levelIndex: at.levelIndex, x, y })
  }
  const byWall = out.filter(({ x, y }) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !canWalk(level, x + dx, y + dy, 'myrr')))
  return byWall.length ? byWall : out
}

function far(a: Agent, at: PathNode): number {
  return Math.abs(a.levelIndex - at.levelIndex) * 200 + Math.hypot(a.x - at.x, a.y - at.y)
}
