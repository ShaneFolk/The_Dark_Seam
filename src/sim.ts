// The simulation: all game state plus the step() that advances it one tick.
// Never touches the canvas or the DOM, so it can run headless.

import { Rng } from './core/rng.ts'
import { createWorld, type World } from './world/world.ts'

export interface SimState {
  seed: number
  tick: number
  rng: Rng
  world: World
}

export function createSim(seed: number): SimState {
  return { seed, tick: 0, rng: new Rng(seed), world: createWorld() }
}

/** Advance the simulation by exactly one fixed tick. */
export function step(sim: SimState): void {
  sim.tick++
}

/** Activity counts per level for the sidebar. Agents arrive in Phase 2. */
export function levelActivity(_sim: SimState, _levelIndex: number): { humans: number; myrr: number } {
  return { humans: 0, myrr: 0 }
}
