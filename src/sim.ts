// The simulation: all game state plus the step() that advances it one tick.
// Never touches the canvas or the DOM, so it can run headless.

import { CONFIG } from './config.ts'
import { Rng } from './core/rng.ts'
import { createWorld, type World } from './world/world.ts'
import { createAgent, type Agent } from './agents/agent.ts'
import { updateWanderer } from './agents/wander.ts'
import { seedHiveResin } from './systems/resin.ts'
import type { PathNode } from './world/pathfinding.ts'

export interface SimState {
  seed: number
  tick: number
  rng: Rng
  world: World
  agents: Agent[]
}

export function createSim(seed: number): SimState {
  const sim: SimState = { seed, tick: 0, rng: new Rng(seed), world: createWorld(), agents: [] }
  seedHiveResin(sim.world)
  spawnWanderers(sim)
  return sim
}

/** Advance the simulation by exactly one fixed tick. Agents update in id order. */
export function step(sim: SimState): void {
  sim.tick++
  for (const agent of sim.agents) updateWanderer(agent, sim.world, sim.rng)
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

/** Phase 2 test units: humans inside the colony buildings, Myrr in the hive core. */
function spawnWanderers(sim: SimState): void {
  const { world, rng } = sim
  const surface = world.levels[0]
  const indoorTiles = tilesWhere(0, (i) => {
    const room = surface.roomOf[i]
    return room >= 0 && !surface.rooms[room].outdoor
  })
  const hiveTiles = world.levels.flatMap((level, li) =>
    tilesWhere(li, (i) => level.roomOf[i] >= 0 && level.rooms[level.roomOf[i]].type === 'hive'),
  )

  for (let n = 0; n < CONFIG.wanderers.humans && indoorTiles.length; n++) {
    sim.agents.push(createAgent(sim.agents.length, 'wanderer-human', 'human', rng.pick(indoorTiles), CONFIG.movement.humanSpeed))
  }
  for (let n = 0; n < CONFIG.wanderers.myrr && hiveTiles.length; n++) {
    sim.agents.push(createAgent(sim.agents.length, 'wanderer-myrr', 'myrr', rng.pick(hiveTiles), CONFIG.movement.myrrSpeed))
  }

  function tilesWhere(levelIndex: number, test: (i: number) => boolean): PathNode[] {
    const level = world.levels[levelIndex]
    const out: PathNode[] = []
    for (let i = 0; i < level.tiles.length; i++) {
      if (test(i)) out.push({ levelIndex, x: i % level.width, y: Math.floor(i / level.width) })
    }
    return out
  }
}
