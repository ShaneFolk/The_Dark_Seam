// The hive's units. Phase 4: the Brood Mother (stays in the hive core) and
// Takers, which run this state machine:
//
//   rest ─▶ scout ──lone human seen──▶ hunt ─▶ attack (claw, sting) ─▶ carry ─▶ (deliver) ─▶ rest
//     │       └─ trips without prey ─▶ return ─▶ rest
//     └─▶ spread resin ─▶ coat ─▶ rest
//
// Takers only go after people who are alone; a group makes them back off,
// and armed humans or getting hurt send them home.

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import { canWalk, findPath, type PathNode } from '../world/pathfinding.ts'
import { findRooms, roomTiles } from '../world/rooms.ts'
import { depositTrail, strongestTrail, type Pheromones } from '../systems/pheromones.ts'
import { coatResin, resinFrontier } from '../systems/resin.ts'
import { digTile, findDigSite, type DigJob } from '../systems/digging.ts'
import { makeNoise } from '../systems/noise.ts'
import type { Noise } from '../systems/noise.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canSee } from './perception.ts'
import { isFree, setMode } from './civilian.ts'
import { isRanged, tryAttack, type CombatContext } from './combat.ts'

export type Task =
  | 'rest' | 'scout' | 'return' | 'hunt' | 'attack' | 'carry' | 'spread' | 'coat' | 'dig' | 'sabotage' // Takers
  | 'inject' // Brood Mother
  | 'grow' // Broodlings
  | 'guard' | 'respond' // Spinebacks

export interface MyrrData {
  role: 'taker' | 'mother' | 'broodling' | 'spineback'
  task: Task
  /** Ticks left in timed tasks (rest, grab, coat). */
  ticksLeft: number
  /** Human being hunted or carried. */
  targetId: number
  /** Tick the hunted human was last seen. */
  lastSeenTick: number
  /** Next tick a hunter re-plans its route. */
  repathTick: number
  /** Scouting trips in a row that found nothing. */
  trips: number
  /** Last tile index scent was laid on while carrying. */
  lastTrailTile: number
  /** Tick the current hunt started. */
  huntStartTick: number
  /** Human this Taker has given up on, and until when. */
  ignoreId: number
  ignoreUntilTick: number
}

export interface HiveState {
  motherId: number
  /** Humans held in the hive, waiting to be injected (oldest first). */
  captives: number[]
  /** Broodlings hatched so far. */
  hatched: number
  /** Recent losses, used to decide what Broodlings grow into (Phase 6 fills these). */
  losses: { taker: number; spineback: number }
  /** Tiles covered in resin, all levels. */
  resinTiles: number
  /** Tunnel being dug, if any (one at a time), and when the next may start. */
  dig: DigJob | null
  nextDigTick: number
  tunnelsDug: number
}

export interface HiveContext {
  world: World
  rng: Rng
  tick: number
  agents: Agent[]
  noises: Noise[]
  pheromones: Pheromones
  hive: HiveState
}

const TPS = CONFIG.sim.ticksPerSecond
const H = CONFIG.hive

export function createMyrrData(role: MyrrData['role']): MyrrData {
  return { role, task: 'rest', ticksLeft: 0, targetId: -1, lastSeenTick: 0, repathTick: 0, trips: 0, lastTrailTile: -1, huntStartTick: 0, ignoreId: -1, ignoreUntilTick: 0 }
}

// ---------------------------------------------------------------- update

export function updateTaker(agent: Agent, ctx: CombatContext): void {
  const m = agent.myrr!

  if (agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    carryAlong(agent, ctx)
    return
  }

  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0 && m.task !== 'carry' && m.task !== 'attack' && m.task !== 'dig' && m.task !== 'sabotage') {
    lookForPrey(agent, m, ctx)
  }

  switch (m.task) {
    case 'rest': {
      if (--m.ticksLeft > 0) return
      // Strategic target: once humans have shown they fight back, knock out the power.
      const working = ctx.power.generators.filter((g) => g.health > 0)
      if (working.length && ctx.hive.losses.taker >= CONFIG.power.sabotageAfterLosses && ctx.rng.chance(CONFIG.power.sabotageChance)) {
        const gen = ctx.rng.pick(working)
        if (goTo(agent, ctx, gen.at)) { m.task = 'sabotage'; m.targetId = ctx.power.generators.indexOf(gen); return }
      }
      if (ctx.hive.resinTiles < CONFIG.resin.maxTiles && ctx.rng.chance(H.resinTaskChance)) {
        const spot = resinFrontier(ctx.world, agent.levelIndex, ctx.rng)
        if (spot && goTo(agent, ctx, spot)) { m.task = 'spread'; return }
      }
      m.task = 'scout'
      m.trips = 0
      nextScoutTrip(agent, m, ctx)
      return
    }

    case 'scout': {
      if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
      // Arrived and found nothing: the scent here has gone stale.
      weakenScent(ctx, tileOf(agent))
      if (++m.trips >= H.tripsBeforeReturn) return goHome(agent, m, ctx)
      nextScoutTrip(agent, m, ctx)
      return
    }

    case 'return': {
      if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
      return rest(agent, m, ctx)
    }

    case 'hunt': {
      const target = ctx.agents[m.targetId]
      if (
        !target || !isFree(target) ||
        ctx.tick - m.lastSeenTick > H.huntGiveUpSeconds * TPS ||
        ctx.tick - m.huntStartTick > H.maxHuntSeconds * TPS
      ) {
        return giveUp(agent, m, ctx)
      }
      // Pounce: speed up for the last few tiles.
      const close = target.levelIndex === agent.levelIndex && Math.hypot(target.x - agent.x, target.y - agent.y) <= H.pounceRange
      agent.speed = agent.baseSpeed * (close ? H.pounceMultiplier : 1)
      if (target.levelIndex === agent.levelIndex && Math.hypot(target.x - agent.x, target.y - agent.y) <= 1.1) {
        m.task = 'attack'
        // Grab hold: the human can't run, only fight back.
        target.heldBy = agent.id
        target.path = []
        if (target.state.name !== 'crossing') target.state = { name: 'idle', ticksLeft: 0 }
        agent.path = []
        agent.state = { name: 'idle', ticksLeft: 0 }
        return
      }
      if (ctx.tick >= m.repathTick) {
        m.repathTick = ctx.tick + Math.round(H.repathSeconds * TPS)
        if (!goTo(agent, ctx, tileOf(target))) return giveUp(agent, m, ctx)
      }
      followPath(agent, ctx.world)
      return
    }

    case 'attack': {
      // Claw at the human until they are weak enough to sting.
      const target = ctx.agents[m.targetId]
      if (!target || !isFree(target) || target.levelIndex !== agent.levelIndex || Math.hypot(target.x - agent.x, target.y - agent.y) > 1.6) {
        m.task = 'hunt'
        m.repathTick = ctx.tick
        return
      }
      tryAttack(agent, target, ctx)
      // The human fights back with whatever they have (fists for most civilians).
      tryAttack(target, agent, ctx)
      if (agent.dead) return
      const civ = target.civ!
      civ.fear = Math.max(civ.fear, CONFIG.fear.panic)
      civ.threat = { levelIndex: agent.levelIndex, x: agent.x, y: agent.y }
      civ.lastSeenTick = ctx.tick
      if (!target.dead && target.health <= H.stingHealth) {
        sting(target, ctx)
        capture(agent, m, target, ctx)
      }
      return
    }

    case 'carry': {
      const done = followPath(agent, ctx.world)
      carryAlong(agent, ctx)
      layTrail(agent, m, ctx)
      if (done) deliver(agent, m, ctx)
      return
    }

    case 'spread': {
      if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
      m.task = 'coat'
      m.ticksLeft = Math.round(CONFIG.resin.patchSeconds * TPS)
      agent.state = { name: 'idle', ticksLeft: 0 }
      return
    }

    case 'dig': {
      const job = ctx.hive.dig
      if (!job || job.takerId !== agent.id) return rest(agent, m, ctx)
      if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
      // At the rock face: dig, loudly.
      if (ctx.tick % (2 * TPS) === 0) makeNoise(ctx.noises, 'dig', agent.levelIndex, agent.x, agent.y, ctx.tick, agent.id)
      if (--job.ticksLeft > 0) return
      const tile = job.tiles[job.done]
      digTile(ctx.world, tile)
      agent.levelIndex = tile.levelIndex
      agent.x = tile.x + 0.5
      agent.y = tile.y + 0.5
      if (++job.done < job.tiles.length) {
        job.ticksLeft = Math.round(H.digSecondsPerTile * TPS)
        return
      }
      ctx.hive.dig = null
      ctx.hive.nextDigTick = ctx.tick + Math.round(H.digCooldownSeconds * TPS)
      ctx.hive.tunnelsDug++
      return rest(agent, m, ctx)
    }

    case 'sabotage': {
      const gen = ctx.power.generators[m.targetId]
      if (!gen || gen.health <= 0) { m.targetId = -1; return goHome(agent, m, ctx) }
      const close = agent.levelIndex === gen.at.levelIndex && Math.hypot(agent.x - (gen.at.x + 0.5), agent.y - (gen.at.y + 0.5)) <= 1.6
      if (!close) {
        if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
        if (!close && !goTo(agent, ctx, gen.at)) { m.targetId = -1; return goHome(agent, m, ctx) }
        return
      }
      agent.path = []
      agent.state = { name: 'idle', ticksLeft: 0 }
      if (ctx.tick % (2 * TPS) === 0) makeNoise(ctx.noises, 'smash', agent.levelIndex, agent.x, agent.y, ctx.tick, agent.id)
      gen.health = Math.max(0, gen.health - CONFIG.power.sabotageDps / TPS)
      return
    }

    case 'coat': {
      if (--m.ticksLeft > 0) return
      const room = CONFIG.resin.maxTiles - ctx.hive.resinTiles
      ctx.hive.resinTiles += coatResin(ctx.world, tileOf(agent), room)
      return rest(agent, m, ctx, 0.3)
    }
  }
}

// ---------------------------------------------------------------- digging

/**
 * Every few seconds: drop a dig whose digger died, or start a new one if danger
 * is high and the cooldown is over, giving it to the nearest Taker that's free.
 */
export function planDigging(ctx: HiveContext): void {
  if (ctx.tick % (5 * TPS) !== 0) return
  const { hive } = ctx
  if (hive.dig) {
    const digger = ctx.agents[hive.dig.takerId]
    if (!digger || digger.dead || digger.myrr?.task !== 'dig') {
      hive.dig = null
      hive.nextDigTick = ctx.tick + Math.round(H.digCooldownSeconds * TPS * 0.5)
    }
    return
  }
  if (ctx.tick < hive.nextDigTick) return
  const site = findDigSite(ctx.world, ctx.pheromones, ctx.rng)
  if (!site) { hive.nextDigTick = ctx.tick + Math.round(H.digCooldownSeconds * TPS * 0.25); return }

  const free = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'taker' && ['rest', 'scout', 'return', 'spread'].includes(a.myrr.task))
  free.sort((a, b) => (a.levelIndex !== site.levelIndex ? 1000 : 0) - (b.levelIndex !== site.levelIndex ? 1000 : 0) +
    Math.hypot(a.x - site.start.x, a.y - site.start.y) - Math.hypot(b.x - site.start.x, b.y - site.start.y))
  for (const taker of free) {
    if (!goTo(taker, ctx, site.start)) continue
    hive.dig = { ...site, takerId: taker.id, done: 0, ticksLeft: Math.round(H.digSecondsPerTile * TPS) }
    taker.myrr!.task = 'dig'
    taker.myrr!.targetId = -1
    return
  }
}

// ---------------------------------------------------------------- hunting

/** Spot free humans; lay scent where they are; hunt the closest one who is alone. */
function lookForPrey(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const level = ctx.world.levels[agent.levelIndex]
  const range = H.sightRange
  let best: Agent | null = null
  let bestDist = Infinity
  const scentPerLook = CONFIG.pheromones.sighting * (CONFIG.perception.intervalTicks / TPS)

  for (const human of ctx.agents) {
    if (human.dead || !isFree(human) || human.levelIndex !== agent.levelIndex) continue
    const dist = Math.hypot(human.x - agent.x, human.y - agent.y)
    if (dist > range || !canSee(agent, human, level, range)) continue
    // Armed humans: Takers are weak in a straight fight, so they go home.
    if (human.weapon && isRanged(human.weapon)) {
      // Not worth it here: wipe out the prey scent around this spot so scouts look elsewhere.
      weakenScent(ctx, tileOf(agent), 8, 0.05)
      if (m.task !== 'return' && m.task !== 'rest') goHome(agent, m, ctx)
      return
    }
    depositTrail(ctx.pheromones, ctx.world, human.levelIndex, human.x, human.y, scentPerLook)
    if (m.task === 'hunt' && human.id === m.targetId) m.lastSeenTick = ctx.tick
    if (companions(human, ctx) >= H.groupSize) continue // too many of them
    if (human.id === m.ignoreId && ctx.tick < m.ignoreUntilTick) continue // gave up on this one
    if (dist < bestDist) { best = human; bestDist = dist }
  }

  if (m.task === 'hunt') {
    const target = ctx.agents[m.targetId]
    if (target && companions(target, ctx) >= H.groupSize) giveUp(agent, m, ctx)
    return
  }
  if (best) {
    m.task = 'hunt'
    m.targetId = best.id
    m.lastSeenTick = ctx.tick
    m.repathTick = ctx.tick
    m.huntStartTick = ctx.tick
  }
}

/** Free humans within `loneRadius` of this one. */
function companions(human: Agent, ctx: HiveContext): number {
  let n = 0
  for (const other of ctx.agents) {
    if (other === human || !isFree(other) || other.levelIndex !== human.levelIndex) continue
    if (Math.hypot(other.x - human.x, other.y - human.y) <= H.loneRadius) n++
  }
  return n
}

/** Paralyse a weakened human. */
export function sting(target: Agent, ctx: HiveContext): void {
  const civ = target.civ!
  setMode(target, civ, 'paralyzed')
  civ.paralyzedUntilTick = ctx.tick + Math.round(H.paralysisSeconds * TPS)
  target.path = []
  target.state = { name: 'idle', ticksLeft: 1e9 }
}

function capture(agent: Agent, m: MyrrData, target: Agent, ctx: HiveContext): void {
  target.civ!.mode = 'captured'
  target.path = []
  target.state = { name: 'idle', ticksLeft: 1e9 }
  target.speed = target.baseSpeed
  depositTrail(ctx.pheromones, ctx.world, agent.levelIndex, agent.x, agent.y, CONFIG.pheromones.capture)

  m.task = 'carry'
  m.lastTrailTile = -1
  agent.speed = agent.baseSpeed * H.carrySpeedMultiplier
  if (!goTo(agent, ctx, nearMother(ctx))) agent.path = []
}

/** Keep the carried human with the Taker. */
function carryAlong(agent: Agent, ctx: HiveContext): void {
  const m = agent.myrr!
  if (m.task !== 'carry') return
  const captive = ctx.agents[m.targetId]
  if (!captive) return
  captive.levelIndex = agent.levelIndex
  captive.x = agent.x
  captive.y = agent.y
}

/** Lay scent on each new tile on the way home with prey. */
function layTrail(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const level = ctx.world.levels[agent.levelIndex]
  const tile = agent.levelIndex * level.width * level.height + Math.floor(agent.y) * level.width + Math.floor(agent.x)
  if (tile === m.lastTrailTile) return
  m.lastTrailTile = tile
  depositTrail(ctx.pheromones, ctx.world, agent.levelIndex, agent.x, agent.y, CONFIG.pheromones.carryTrail)
}

function deliver(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const captive = ctx.agents[m.targetId]
  const mother = ctx.agents[ctx.hive.motherId]
  // Not home yet (e.g. the first route failed): try again.
  if (mother && (agent.levelIndex !== mother.levelIndex || Math.hypot(mother.x - agent.x, mother.y - agent.y) > 4)) {
    if (goTo(agent, ctx, nearMother(ctx))) return
  }
  if (captive?.civ) {
    captive.civ.mode = 'captive'
    const spot = nearMother(ctx)
    captive.levelIndex = spot.levelIndex
    captive.x = spot.x + 0.5
    captive.y = spot.y + 0.5
    ctx.hive.captives.push(captive.id)
  }
  m.targetId = -1
  agent.speed = agent.baseSpeed
  rest(agent, m, ctx)
}

function giveUp(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  m.ignoreId = m.targetId
  m.ignoreUntilTick = ctx.tick + Math.round(H.ignoreSeconds * TPS)
  m.targetId = -1
  agent.speed = agent.baseSpeed
  m.task = 'scout'
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 0 }
  nextScoutTrip(agent, m, ctx)
}

// ---------------------------------------------------------------- moving about

function nextScoutTrip(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const spots = ctx.rng.chance(H.followTrailChance) ? strongestTrail(ctx.pheromones, ctx.world, 12) : []
  if (spots.length) {
    // Stronger scent is more likely to be picked.
    let roll = ctx.rng.next() * spots.reduce((s, p) => s + p.strength, 0)
    for (const spot of spots) {
      const level = ctx.world.levels[spot.at.levelIndex]
      const danger = ctx.pheromones.danger[spot.at.levelIndex][spot.at.y * level.width + spot.at.x]
      if (danger > spot.strength) continue // prey there, but too many Myrr have died there
      if ((roll -= spot.strength) <= 0 && goTo(agent, ctx, spot.at)) return
    }
  }
  for (let tries = 0; tries < 5; tries++) {
    const levelIndex = pickWeighted(H.scoutLevelWeights, ctx.rng)
    const level = ctx.world.levels[levelIndex]
    for (let n = 0; n < 50; n++) {
      const x = ctx.rng.int(0, level.width - 1), y = ctx.rng.int(0, level.height - 1)
      if (canWalk(level, x, y, 'myrr') && goTo(agent, ctx, { levelIndex, x, y })) return
    }
  }
  goHome(agent, m, ctx)
}

/**
 * A Taker that is shot, or badly hurt, drops what it's doing (unless carrying
 * prey) and runs home. A punch from its prey doesn't scare it off.
 */
export function takerHurt(agent: Agent, source: Agent | null, ctx: HiveContext): void {
  const m = agent.myrr!
  if (m.role !== 'taker' || m.task === 'carry' || m.task === 'return' || m.task === 'dig') return
  if (m.task === 'sabotage' && agent.health > agent.maxHealth * 0.4) return // determined
  const shot = !!source?.weapon && isRanged(source.weapon)
  if (!shot && agent.health > agent.maxHealth * 0.4) return
  m.targetId = -1
  agent.speed = agent.baseSpeed
  goHome(agent, m, ctx)
}

function goHome(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  m.task = 'return'
  if (!goTo(agent, ctx, nearMother(ctx))) rest(agent, m, ctx)
}

function rest(agent: Agent, m: MyrrData, ctx: HiveContext, scale = 1): void {
  const [min, max] = H.restSeconds
  m.task = 'rest'
  m.ticksLeft = Math.round((min + ctx.rng.next() * (max - min)) * scale * TPS)
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 0 }
}

function goTo(agent: Agent, ctx: HiveContext, to: PathNode): boolean {
  // Takers steer around danger scent (places Myrr have been shot or killed).
  const path = findPath(ctx.world, tileOf(agent), to, 'myrr', { avoid: ctx.pheromones.danger, avoidCost: CONFIG.pheromones.dangerCost, breakWalls: true })
  if (!path || !path.length) return false
  agent.path = path
  agent.state = { name: 'moving' }
  return true
}

/** A hive-core tile close to the Brood Mother. */
function nearMother(ctx: HiveContext): PathNode {
  const mother = ctx.agents[ctx.hive.motherId]
  const hive = findRooms(ctx.world, ['hive'])[0]
  const tiles = roomTiles(ctx.world, hive).filter(
    (t) => !mother || Math.hypot(t.x + 0.5 - mother.x, t.y + 0.5 - mother.y) <= 4,
  )
  return ctx.rng.pick(tiles.length ? tiles : roomTiles(ctx.world, hive))
}

/** Scale down the scent around a spot (a scout that found nothing halves it). */
function weakenScent(ctx: HiveContext, at: PathNode, radius = 2, keep = 0.5): void {
  const map = ctx.pheromones.trail[at.levelIndex]
  const level = ctx.world.levels[at.levelIndex]
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const x = at.x + dx, y = at.y + dy
      if (x >= 0 && y >= 0 && x < level.width && y < level.height) map[y * level.width + x] *= keep
    }
}

function pickWeighted(weights: readonly number[], rng: Rng): number {
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < weights.length; i++) if ((roll -= weights[i]) <= 0) return i
  return weights.length - 1
}
