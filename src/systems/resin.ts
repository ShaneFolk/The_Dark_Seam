// Resin: the hive's home turf. Myrr move faster on it.
// The hive starts coated; Takers then spread it outward a patch at a time.

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import type { Level } from '../world/level.ts'
import { canWalk, type PathNode } from '../world/pathfinding.ts'

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/** Cover the hive core and the walkable tiles within `startRadius` steps of it. */
export function seedHiveResin(world: World): void {
  for (const level of world.levels) {
    const hives = level.rooms.filter((r) => r.type === 'hive').map((r) => r.index)
    if (!hives.length) continue
    const { width, height } = level
    const dist = new Int32Array(width * height).fill(-1)
    const queue: number[] = []
    for (let i = 0; i < level.roomOf.length; i++) {
      if (hives.includes(level.roomOf[i])) { dist[i] = 0; queue.push(i) }
    }
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k]
      level.resin[i] = 1
      if (dist[i] >= CONFIG.resin.startRadius) continue
      const x = i % width, y = (i - x) / width
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy
        const n = ny * width + nx
        if (!canWalk(level, nx, ny, 'myrr') || dist[n] !== -1) continue
        dist[n] = dist[i] + 1
        queue.push(n)
      }
    }
  }
}

export function countResin(world: World): number {
  let n = 0
  for (const level of world.levels) for (let i = 0; i < level.resin.length; i++) n += level.resin[i]
  return n
}

/** A walkable tile next to existing resin on this level, or null if none. */
export function resinFrontier(world: World, levelIndex: number, rng: Rng): PathNode | null {
  const level = world.levels[levelIndex]
  const edge: number[] = []
  for (let i = 0; i < level.resin.length; i++) {
    if (level.resin[i]) continue
    const x = i % level.width, y = (i - x) / level.width
    if (!canWalk(level, x, y, 'myrr')) continue
    if (DIRS.some(([dx, dy]) => level.resin[(y + dy) * level.width + (x + dx)])) edge.push(i)
  }
  if (!edge.length) return null
  const i = rng.pick(edge)
  return { levelIndex, x: i % level.width, y: Math.floor(i / level.width) }
}

/** Coat a patch around (x, y). Returns how many new tiles got resin. */
export function coatResin(world: World, at: PathNode, budget: number): number {
  const level = world.levels[at.levelIndex]
  const r = CONFIG.resin.patchRadius
  let added = 0
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (added >= budget) return added
      const x = at.x + dx, y = at.y + dy
      if (!canWalk(level, x, y, 'myrr')) continue
      const i = y * level.width + x
      if (level.resin[i]) continue
      level.resin[i] = 1
      markChanged(level, i)
      added++
    }
  }
  return added
}

const MAX_CHANGES = 20000

/** Record that a tile's look changed, so the renderer repaints it. */
export function markChanged(level: Level, i: number): void {
  level.changes.push(i)
  if (level.changes.length > MAX_CHANGES) {
    const drop = MAX_CHANGES / 2
    level.changes.splice(0, drop)
    level.changesTrimmed += drop
  }
}
