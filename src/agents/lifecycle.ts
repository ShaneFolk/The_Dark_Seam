// The hive's life cycle:
//
//   captive ─▶ Brood Mother injects ─▶ cocooned (infected) ─▶ Broodling bursts out
//   Broodling grows in the hive ─▶ becomes a Taker or a Spineback, by what the hive needs.
//
// The infection belongs to the person: if soldiers cut them free, it keeps
// ticking wherever they go until a medic stabilizes them or the med bay cures them.
// Spinebacks guard the Brood Mother and kill humans who come near the hive.

import { CONFIG } from '../config.ts'
import { findPath } from '../world/pathfinding.ts'
import { cornerTiles, findRooms, randomTileIn, roomTiles } from '../world/rooms.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { createAgent, tileOf, type Agent } from './agent.ts'
import { isFree, setMode } from './civilian.ts'
import { followPath } from './movement.ts'
import { createMyrrData, type HiveContext } from './myrr.ts'
import { makeWeapon, nearestVisible, tryAttack, type CombatContext } from './combat.ts'

const TPS = CONFIG.sim.ticksPerSecond
const L = CONFIG.lifecycle

// ---------------------------------------------------------------- Brood Mother

/** Inject waiting captives one at a time. */
export function updateMother(mother: Agent, ctx: HiveContext): void {
  const m = mother.myrr!
  const { hive } = ctx

  if (m.task === 'inject') {
    if (--m.ticksLeft > 0) return
    const captive = ctx.agents[m.targetId]
    hive.captives = hive.captives.filter((id) => id !== m.targetId)
    if (captive?.civ && captive.civ.mode === 'captive') cocoon(captive, ctx)
    m.task = 'rest'
    m.targetId = -1
    return
  }

  // Next in line: the oldest captive still held in the hive.
  const next = hive.captives.find((id) => ctx.agents[id]?.civ?.mode === 'captive')
  if (next === undefined) return
  m.task = 'inject'
  m.targetId = next
  m.ticksLeft = Math.round(L.injectSeconds * TPS)
}

/** Infect and wrap a captive in a cocoon near the edge of the hive core. */
function cocoon(captive: Agent, ctx: HiveContext): void {
  const spot = cocoonSpot(ctx)
  const civ = captive.civ!
  setMode(captive, civ, 'cocooned')
  civ.infection = { hatchTick: ctx.tick + Math.round(L.incubationSeconds * TPS), pausedTicksLeft: null }
  captive.state = { name: 'idle', ticksLeft: 1e9 }
  captive.levelIndex = spot.levelIndex
  captive.x = spot.x + 0.5
  captive.y = spot.y + 0.5
}

/** A free corner tile of the hive core (cocoons line its walls). */
function cocoonSpot(ctx: HiveContext): PathNode {
  const hive = findRooms(ctx.world, ['hive'])[0]
  const taken = new Set(
    ctx.agents.filter((a) => a.civ?.mode === 'cocooned').map((a) => `${Math.floor(a.x)},${Math.floor(a.y)}`),
  )
  const free = cornerTiles(ctx.world, hive).filter((t) => !taken.has(`${t.x},${t.y}`))
  return free.length ? ctx.rng.pick(free) : randomTileIn(ctx.world, hive, ctx.rng)
}

// ---------------------------------------------------------------- infections

/** Hatch infections whose time is up, wherever the host is. */
export function updateInfections(ctx: HiveContext): void {
  const count = ctx.agents.length
  for (let i = 0; i < count; i++) {
    const host = ctx.agents[i]
    const inf = host.civ?.infection
    if (!inf || host.dead || inf.pausedTicksLeft !== null || inf.hatchTick > ctx.tick) continue
    host.civ!.infection = null
    host.civ!.mode = 'dead'
    host.civ!.deathCause = 'hatched'
    host.dead = true
    host.health = 0
    const brood = createAgent(ctx.agents.length, 'broodling', 'myrr', tileOf(host), CONFIG.movement.myrrSpeed * 0.5, CONFIG.health.broodling)
    brood.myrr = createMyrrData('broodling')
    brood.myrr.task = 'grow'
    brood.myrr.ticksLeft = Math.round(L.growSeconds * TPS)
    ctx.agents.push(brood)
    ctx.hive.hatched++
  }
}

// ---------------------------------------------------------------- Broodlings

/** Crawl around the hive while growing, then turn into what the hive needs. */
export function updateBroodling(agent: Agent, ctx: HiveContext): void {
  const m = agent.myrr!
  if (--m.ticksLeft <= 0) return growUp(agent, ctx)
  if (agent.state.name === 'moving' || agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }
  if (ctx.rng.chance(1 / (3 * TPS))) wanderInHive(agent, ctx)
}

function growUp(agent: Agent, ctx: HiveContext): void {
  const role = whatTheHiveNeeds(ctx)
  agent.kind = role
  agent.baseSpeed = agent.speed = CONFIG.movement.myrrSpeed
  agent.health = agent.maxHealth = role === 'taker' ? CONFIG.health.taker : CONFIG.health.spineback
  agent.weapon = makeWeapon(role === 'taker' ? 'claws' : 'spines', CONFIG.combat.skill.myrr)
  agent.myrr = createMyrrData(role)
  agent.myrr.task = role === 'taker' ? 'rest' : 'guard'
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 0 }
}

/**
 * Spineback if the hive has fewer than its target share of them (raised by
 * Spineback losses), otherwise Taker.
 */
export function whatTheHiveNeeds(ctx: HiveContext): 'taker' | 'spineback' {
  let takers = 0, spinebacks = 0
  for (const a of ctx.agents) {
    if (a.dead) continue
    if (a.kind === 'taker') takers++
    else if (a.kind === 'spineback') spinebacks++
  }
  const want = Math.min(0.8, L.spinebackShare + L.lossBias * ctx.hive.losses.spineback)
  const share = spinebacks / Math.max(1, takers + spinebacks)
  return share < want ? 'spineback' : 'taker'
}

// ---------------------------------------------------------------- Spinebacks

/** Guard the Brood Mother; attack any human who comes near; then return. */
export function updateSpineback(agent: Agent, ctx: CombatContext): void {
  const m = agent.myrr!
  const mother = ctx.agents[ctx.hive.motherId]
  const chaseRange = L.guardRadius + 10

  // Look for intruders every few ticks.
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0) {
    const intruder = nearestVisible(agent, ctx, CONFIG.hive.sightRange, (a) =>
      a.side === 'human' && isFree(a) && !!mother && a.levelIndex === mother.levelIndex &&
      Math.hypot(a.x - mother.x, a.y - mother.y) <= chaseRange)
    m.targetId = intruder ? intruder.id : -1
  }

  const target = m.targetId >= 0 ? ctx.agents[m.targetId] : null
  if (target && !target.dead && isFree(target)) {
    if (tryAttack(agent, target, ctx)) return
    if (ctx.tick >= m.repathTick) {
      m.repathTick = ctx.tick + TPS
      const path = findPath(ctx.world, tileOf(agent), tileOf(target), 'myrr')
      if (path?.length) { agent.path = path; agent.state = { name: 'moving' } }
    }
    if (agent.state.name === 'moving' || agent.state.name === 'crossing') followPath(agent, ctx.world)
    return
  }
  m.targetId = -1

  if (agent.state.name === 'moving' || agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }
  const far = mother && (agent.levelIndex !== mother.levelIndex || Math.hypot(mother.x - agent.x, mother.y - agent.y) > L.guardRadius)
  if (far || ctx.rng.chance(1 / (6 * TPS))) guardSpot(agent, ctx)
}

function guardSpot(agent: Agent, ctx: HiveContext): void {
  const mother = ctx.agents[ctx.hive.motherId]
  const hive = findRooms(ctx.world, ['hive'])[0]
  if (!hive) return
  const near = roomTiles(ctx.world, hive).filter(
    (t) => !mother || Math.hypot(t.x + 0.5 - mother.x, t.y + 0.5 - mother.y) <= L.guardRadius,
  )
  if (!near.length) return
  const path = findPath(ctx.world, tileOf(agent), ctx.rng.pick(near), 'myrr')
  if (path?.length) {
    agent.path = path
    agent.state = { name: 'moving' }
  }
}

function wanderInHive(agent: Agent, ctx: HiveContext): void {
  const hive = findRooms(ctx.world, ['hive'])[0]
  if (!hive) return
  const path = findPath(ctx.world, tileOf(agent), randomTileIn(ctx.world, hive, ctx.rng), 'myrr')
  if (path?.length) {
    agent.path = path
    agent.state = { name: 'moving' }
  }
}
