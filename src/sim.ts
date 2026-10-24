// The simulation: all game state plus the step() that advances it one tick.
// Never touches the canvas or the DOM, so it can run headless.

import { CONFIG } from './config.ts'
import { Rng } from './core/rng.ts'
import { createWorld, type World } from './world/world.ts'
import { createAgent, type Agent } from './agents/agent.ts'
import { updateWanderer } from './agents/wander.ts'
import { activityAt, createCivilianData, roomFor, updateCivilian, type CivilianContext } from './agents/civilian.ts'
import { createMyrrData, updateTaker, type HiveContext, type HiveState } from './agents/myrr.ts'
import { updateBroodling, updateCocoons, updateMother, updateSpineback } from './agents/lifecycle.ts'
import { countResin, seedHiveResin } from './systems/resin.ts'
import { makeNoise, pruneNoises, type Noise } from './systems/noise.ts'
import { createPheromones, decayPheromones, type Pheromones } from './systems/pheromones.ts'
import { findRooms, randomTileIn, roomTiles } from './world/rooms.ts'
import type { PathNode } from './world/pathfinding.ts'

export interface SimState {
  seed: number
  tick: number
  rng: Rng
  world: World
  agents: Agent[]
  noises: Noise[]
  pheromones: Pheromones
  hive: HiveState
}

export function createSim(seed: number): SimState {
  const world = createWorld()
  const sim: SimState = {
    seed,
    tick: 0,
    rng: new Rng(seed),
    world,
    agents: [],
    noises: [],
    pheromones: createPheromones(world),
    hive: { motherId: -1, captives: [], cocoons: [], hatched: 0, losses: { taker: 0, spineback: 0 }, resinTiles: 0 },
  }
  seedHiveResin(world)
  sim.hive.resinTiles = countResin(world)
  spawnCivilians(sim)
  spawnHive(sim)
  spawnMyrrWanderers(sim)
  return sim
}

const TPS = CONFIG.sim.ticksPerSecond
const SKITTER_TICKS = Math.round(CONFIG.noise.skitterEverySeconds * TPS)

/** Advance the simulation by exactly one fixed tick. Agents update in id order. */
export function step(sim: SimState): void {
  sim.tick++
  pruneNoises(sim.noises, sim.tick)
  if (sim.tick % TPS === 0) decayPheromones(sim.pheromones)

  const civCtx: CivilianContext = { world: sim.world, rng: sim.rng, tick: sim.tick, agents: sim.agents, noises: sim.noises }
  const hiveCtx: HiveContext = { ...civCtx, pheromones: sim.pheromones, hive: sim.hive }

  updateCocoons(hiveCtx)
  // Only agents that existed at the start of the tick act (new Broodlings wait a tick).
  const count = sim.agents.length
  for (let i = 0; i < count; i++) {
    const agent = sim.agents[i]
    if (agent.civ) {
      updateCivilian(agent, civCtx)
      continue
    }
    const role = agent.myrr?.role
    if (role === 'taker') updateTaker(agent, hiveCtx)
    else if (role === 'mother') updateMother(agent, hiveCtx)
    else if (role === 'broodling') updateBroodling(agent, hiveCtx)
    else if (role === 'spineback') updateSpineback(agent, hiveCtx)
    else if (agent.kind === 'wanderer-myrr') updateWanderer(agent, sim.world, sim.rng)
    // Moving Myrr skitter now and then.
    if (agent.side === 'myrr' && agent.state.name === 'moving' && (sim.tick + agent.id) % SKITTER_TICKS === 0) {
      makeNoise(sim.noises, 'skitter', agent.levelIndex, agent.x, agent.y, sim.tick, agent.id)
    }
  }
}

/** Activity counts per level for the sidebar. */
export function levelActivity(sim: SimState, levelIndex: number): { humans: number; myrr: number } {
  let humans = 0, myrr = 0
  for (const a of sim.agents) {
    if (a.levelIndex !== levelIndex) continue
    if (a.civ?.mode === 'dead' || a.civ?.mode === 'cocooned') continue
    if (a.side === 'human') humans++
    else myrr++
  }
  return { humans, myrr }
}

/** Civilians start wherever their schedule puts them at the start hour. */
function spawnCivilians(sim: SimState): void {
  const { world, rng } = sim
  for (let n = 0; n < CONFIG.civilians.count; n++) {
    const civ = createCivilianData(world, rng)
    if (!civ) break
    civ.activity = activityAt(civ, 0)
    civ.target = roomFor(civ, civ.activity, civ.home.levelIndex, world, rng)
    const at = randomTileIn(world, civ.target, rng)
    const agent = createAgent(sim.agents.length, 'civilian', 'human', at, CONFIG.movement.humanSpeed)
    agent.civ = civ
    sim.agents.push(agent)
  }
}

/** The Brood Mother at the centre of the hive core, Takers resting around her. */
function spawnHive(sim: SimState): void {
  const { world, rng } = sim
  const hive = findRooms(world, ['hive'])[0]
  if (!hive) return
  const tiles = roomTiles(world, hive)
  const centre = tiles.reduce((best, t) =>
    Math.hypot(t.x - hive.room.centerX, t.y - hive.room.centerY) < Math.hypot(best.x - hive.room.centerX, best.y - hive.room.centerY) ? t : best,
  )
  const mother = createAgent(sim.agents.length, 'brood-mother', 'myrr', centre, 0)
  mother.myrr = createMyrrData('mother')
  sim.hive.motherId = mother.id
  sim.agents.push(mother)

  for (let n = 0; n < CONFIG.hive.takers; n++) {
    const taker = createAgent(sim.agents.length, 'taker', 'myrr', rng.pick(tiles), CONFIG.movement.myrrSpeed)
    taker.myrr = createMyrrData('taker')
    taker.myrr.ticksLeft = rng.int(1, 10 * TPS) // stagger the first trips
    sim.agents.push(taker)
  }
  for (let n = 0; n < CONFIG.hive.spinebacks; n++) {
    const guard = createAgent(sim.agents.length, 'spineback', 'myrr', rng.pick(tiles), CONFIG.movement.myrrSpeed)
    guard.myrr = createMyrrData('spineback')
    guard.myrr.task = 'guard'
    sim.agents.push(guard)
  }
}

/** Phase 2 test Myrr (count is 0 now that the hive has Takers). */
function spawnMyrrWanderers(sim: SimState): void {
  const { world, rng } = sim
  const hive = findRooms(world, ['hive'])[0]
  const tiles: PathNode[] = hive ? roomTiles(world, hive) : []
  for (let n = 0; n < CONFIG.wanderers.myrr && tiles.length; n++) {
    sim.agents.push(createAgent(sim.agents.length, 'wanderer-myrr', 'myrr', rng.pick(tiles), CONFIG.movement.myrrSpeed))
  }
}
