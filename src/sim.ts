// The simulation: all game state plus the step() that advances it one tick.
// Never touches the canvas or the DOM, so it can run headless.

import { CONFIG } from './config.ts'
import { Rng } from './core/rng.ts'
import { createWorld, type World } from './world/world.ts'
import { createAgent, type Agent } from './agents/agent.ts'
import { updateWanderer } from './agents/wander.ts'
import { activityAt, createCivilianData, roomFor, updateCivilian, type CivilianContext } from './agents/civilian.ts'
import { seedHiveResin } from './systems/resin.ts'
import { makeNoise, pruneNoises, type Noise } from './systems/noise.ts'
import { randomTileIn } from './world/rooms.ts'
import type { PathNode } from './world/pathfinding.ts'

export interface SimState {
  seed: number
  tick: number
  rng: Rng
  world: World
  agents: Agent[]
  noises: Noise[]
}

export function createSim(seed: number): SimState {
  const sim: SimState = { seed, tick: 0, rng: new Rng(seed), world: createWorld(), agents: [], noises: [] }
  seedHiveResin(sim.world)
  spawnCivilians(sim)
  spawnMyrrWanderers(sim)
  return sim
}

const SKITTER_TICKS = Math.round(CONFIG.noise.skitterEverySeconds * CONFIG.sim.ticksPerSecond)

/** Advance the simulation by exactly one fixed tick. Agents update in id order. */
export function step(sim: SimState): void {
  sim.tick++
  pruneNoises(sim.noises, sim.tick)
  const ctx: CivilianContext = { world: sim.world, rng: sim.rng, tick: sim.tick, agents: sim.agents, noises: sim.noises }
  for (const agent of sim.agents) {
    if (agent.civ) {
      updateCivilian(agent, ctx)
    } else {
      updateWanderer(agent, sim.world, sim.rng)
      // Moving Myrr skitter now and then.
      if (agent.side === 'myrr' && agent.state.name === 'moving' && (sim.tick + agent.id) % SKITTER_TICKS === 0) {
        makeNoise(sim.noises, 'skitter', agent.levelIndex, agent.x, agent.y, sim.tick, agent.id)
      }
    }
  }
}

/** Activity counts per level for the sidebar. */
export function levelActivity(sim: SimState, levelIndex: number): { humans: number; myrr: number } {
  let humans = 0, myrr = 0
  for (const a of sim.agents) {
    if (a.levelIndex !== levelIndex) continue
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

/** Phase 2 test Myrr, kept as threats until the hive arrives in Phase 4. */
function spawnMyrrWanderers(sim: SimState): void {
  const { world, rng } = sim
  const hiveTiles: PathNode[] = []
  world.levels.forEach((level, li) => {
    for (let i = 0; i < level.tiles.length; i++) {
      const r = level.roomOf[i]
      if (r >= 0 && level.rooms[r].type === 'hive') hiveTiles.push({ levelIndex: li, x: i % level.width, y: Math.floor(i / level.width) })
    }
  })
  for (let n = 0; n < CONFIG.wanderers.myrr && hiveTiles.length; n++) {
    sim.agents.push(createAgent(sim.agents.length, 'wanderer-myrr', 'myrr', rng.pick(hiveTiles), CONFIG.movement.myrrSpeed))
  }
}
