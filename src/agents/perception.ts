// Senses: line of sight and hearing.

import { CONFIG } from '../config.ts'
import type { Level } from '../world/level.ts'
import { TILE_INFO, type Tile } from '../world/tiles.ts'
import type { Noise } from '../systems/noise.ts'
import type { Agent } from './agent.ts'
import { isHidden } from '../systems/camouflage.ts'

/**
 * True if nothing that blocks sight lies between two tiles.
 * Walks the straight line between them tile by tile (Bresenham's line).
 */
export function lineOfSight(level: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0, y = y0
  for (;;) {
    if (x === x1 && y === y1) return true
    // The two end tiles may themselves be "blocking" (e.g. standing in a doorway).
    if (!(x === x0 && y === y0) && TILE_INFO[level.tiles[y * level.width + x] as Tile].blocksSight) return false
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}

/** Can `viewer` see `target`? Same level, within range, clear line. */
export function canSee(viewer: Agent, target: Agent, level: Level, range: number = CONFIG.perception.sightRange): boolean {
  if (viewer.levelIndex !== target.levelIndex || target.state.name === 'crossing') return false
  // A Myrr holding still on resin can only be spotted from close up.
  if (viewer.side === 'human' && isHidden(target, level)) range = Math.min(range, CONFIG.camouflage.sightRange)
  const dist = Math.hypot(target.x - viewer.x, target.y - viewer.y)
  if (dist > range) return false
  return lineOfSight(level, Math.floor(viewer.x), Math.floor(viewer.y), Math.floor(target.x), Math.floor(target.y))
}

/** Can `listener` hear `noise`? Walls shorten how far it carries. */
export function canHear(listener: Agent, noise: Noise, level: Level): boolean {
  if (listener.levelIndex !== noise.levelIndex) return false
  const dist = Math.hypot(noise.x - listener.x, noise.y - listener.y)
  if (dist > noise.radius) return false
  if (dist <= noise.radius * (1 - CONFIG.perception.wallMuffle)) return true
  return lineOfSight(level, Math.floor(listener.x), Math.floor(listener.y), Math.floor(noise.x), Math.floor(noise.y))
}
