// A* pathfinding across all levels.
//
// A* explores tiles outward from the start, always picking next the tile with the
// lowest "cost so far + estimated cost to the goal". The estimate never overshoots,
// so the first time it reaches the goal, that path is the cheapest one.
//
// Costs are in seconds of travel time, so slower tiles (or faster ones, like resin
// for the Myrr) and slow links (elevator vs. ladder) are weighed correctly.

import { CONFIG } from '../config.ts'
import { MinHeap } from '../core/heap.ts'
import { TILE_INFO, type Tile } from './tiles.ts'
import { otherEnd } from './links.ts'
import type { World } from './loadWorld.ts'
import type { Level } from './level.ts'

export type Side = 'human' | 'myrr'

export interface PathNode {
  /** Index into world.levels (0 = Level 1). */
  levelIndex: number
  x: number
  y: number
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

export function canWalk(level: Level, x: number, y: number, side: Side): boolean {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return false
  const info = TILE_INFO[level.tiles[y * level.width + x] as Tile]
  return side === 'human' ? info.humanWalkable : info.myrrWalkable
}

/** Speed multiplier on a tile for a side (resin speeds up the Myrr). */
export function speedFactor(level: Level, i: number, side: Side): number {
  return side === 'myrr' && level.resin[i] ? CONFIG.movement.resinSpeedMultiplier : 1
}

/** Reusable search buffers, sized for the whole world. */
class SearchBuffers {
  cost: Float64Array
  cameFrom: Int32Array
  closed: Uint8Array
  heap = new MinHeap()
  constructor(n: number) {
    this.cost = new Float64Array(n)
    this.cameFrom = new Int32Array(n)
    this.closed = new Uint8Array(n)
  }
}
let buffers: SearchBuffers | null = null

/**
 * Cheapest path from `from` to `to` for the given side, or null if there is none.
 * The path starts with the first step after `from` and ends at `to`.
 */
export function findPath(world: World, from: PathNode, to: PathNode, side: Side): PathNode[] | null {
  const { levels } = world
  const w = levels[0].width, h = levels[0].height
  const perLevel = w * h
  const total = perLevel * levels.length
  if (!buffers || buffers.cost.length !== total) buffers = new SearchBuffers(total)
  const { cost, cameFrom, closed, heap } = buffers
  cost.fill(Infinity)
  closed.fill(0)
  heap.clear()

  const goalLevel = levels[to.levelIndex]
  if (!canWalk(goalLevel, to.x, to.y, side)) return null

  const baseSpeed = side === 'human' ? CONFIG.movement.humanSpeed : CONFIG.movement.myrrSpeed
  const maxSpeed = baseSpeed * (side === 'myrr' ? CONFIG.movement.resinSpeedMultiplier : 1)
  const minLinkSeconds = Math.min(...Object.values(CONFIG.movement.linkSeconds))

  // Estimated seconds to the goal: straight-line (octile) distance at top speed,
  // plus the quickest possible link for each level to change. Never too high.
  const estimate = (li: number, x: number, y: number) => {
    const dx = Math.abs(x - to.x), dy = Math.abs(y - to.y)
    const tiles = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
    return tiles / maxSpeed + Math.abs(li - to.levelIndex) * minLinkSeconds
  }

  const start = from.levelIndex * perLevel + from.y * w + from.x
  const goal = to.levelIndex * perLevel + to.y * w + to.x
  cost[start] = 0
  cameFrom[start] = -1
  heap.push(start, estimate(from.levelIndex, from.x, from.y))

  while (heap.size) {
    const node = heap.pop()
    if (closed[node]) continue
    closed[node] = 1
    if (node === goal) return rebuild(node, cameFrom, perLevel, w)

    const li = Math.floor(node / perLevel)
    const i = node - li * perLevel
    const x = i % w, y = (i - x) / w
    const level = levels[li]
    const here = speedFactor(level, i, side)

    // Walk to a neighbouring tile. Diagonals may not cut wall corners.
    for (const [dx, dy, dist] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (!canWalk(level, nx, ny, side)) continue
      if (dx && dy && (!canWalk(level, x + dx, y, side) || !canWalk(level, x, y + dy, side))) continue
      const ni = ny * w + nx
      const there = speedFactor(level, ni, side)
      const step = dist / (baseSpeed * (here + there) / 2)
      relax(node, li * perLevel + ni, cost[node] + step, li, nx, ny)
    }

    // Take a link to the level above or below.
    const links = level.linksAt.get(i)
    if (links) {
      for (const link of links) {
        if (link.myrrOnly && side === 'human') continue
        const end = otherEnd(link, level.id)
        const endIndex = levels.findIndex((l) => l.id === end.level)
        if (endIndex < 0) continue
        relax(node, endIndex * perLevel + i, cost[node] + CONFIG.movement.linkSeconds[link.kind], endIndex, x, y)
      }
    }
  }
  return null

  function relax(fromNode: number, n: number, c: number, li: number, x: number, y: number): void {
    if (closed[n] || c >= cost[n]) return
    cost[n] = c
    cameFrom[n] = fromNode
    heap.push(n, c + estimate(li, x, y))
  }
}

function rebuild(node: number, cameFrom: Int32Array, perLevel: number, w: number): PathNode[] {
  const path: PathNode[] = []
  for (let n = node; cameFrom[n] !== -1; n = cameFrom[n]) {
    const li = Math.floor(n / perLevel)
    const i = n - li * perLevel
    path.push({ levelIndex: li, x: i % w, y: Math.floor(i / w) })
  }
  return path.reverse()
}
