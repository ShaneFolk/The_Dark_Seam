// The simulation: all game state plus the step() that advances it one tick.
// Never touches the canvas or the DOM, so it can run headless.

import { CONFIG } from './config.ts'
import { Rng } from './core/rng.ts'

export const TILE_FLOOR = 0
export const TILE_WALL = 1

export interface SimState {
  seed: number
  tick: number
  rng: Rng
  gridWidth: number
  gridHeight: number
  /** One tile type per cell, row by row (index = y * width + x). */
  tiles: Uint8Array
}

export function createSim(seed: number): SimState {
  const rng = new Rng(seed)
  const { width, height, testWallChance } = CONFIG.grid

  // Placeholder test grid: random walls from the seed.
  // Replaced by real hand-built maps in Phase 1.
  const tiles = new Uint8Array(width * height)
  for (let i = 0; i < tiles.length; i++) {
    tiles[i] = rng.chance(testWallChance) ? TILE_WALL : TILE_FLOOR
  }

  return { seed, tick: 0, rng, gridWidth: width, gridHeight: height, tiles }
}

/** Advance the simulation by exactly one fixed tick. */
export function step(sim: SimState): void {
  sim.tick++
}
