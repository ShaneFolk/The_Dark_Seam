// Digging: the hive tunnels around places where it keeps losing Myrr.
//
// When danger scent builds up strongly somewhere in the mines (Levels 2 and 3),
// the hive looks near it for a short run of rock (up to maxDigLength tiles) with
// open ground on both ends, where walking round the long way is much further.
// One Taker digs it out a tile at a time. Digging is loud, so humans can hear it.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import { Tile } from '../world/tiles.ts'
import { canWalk, findPath, type PathNode } from '../world/pathfinding.ts'
import { strongest, type Pheromones } from './pheromones.ts'
import { markChanged } from './resin.ts'
import type { Rng } from '../core/rng.ts'

export interface DigJob {
  levelIndex: number
  /** Open tile the digger starts from. */
  start: PathNode
  /** Rock tiles to dig, in order. */
  tiles: PathNode[]
  /** How many are dug so far. */
  done: number
  takerId: number
  /** Ticks left on the current tile. */
  ticksLeft: number
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/** Where should the hive dig next? Null if danger isn't high enough or no good spot exists. */
export function findDigSite(world: World, ph: Pheromones, rng: Rng): Omit<DigJob, 'takerId' | 'done' | 'ticksLeft'> | null {
  const H = CONFIG.hive
  // Only in the mines: the surface has buildings, not rock (chewing walls is Phase 7).
  const hot = strongest(ph, 'danger', world, 5, H.digTriggerDanger).find((s) => s.at.levelIndex >= 1)
  if (!hot) return null
  const level = world.levels[hot.at.levelIndex]
  const r = H.digSearchRadius

  let best: { start: PathNode; tiles: PathNode[]; savings: number } | null = null
  for (let tries = 0; tries < 30; tries++) {
    const sx = hot.at.x + rng.int(-r, r), sy = hot.at.y + rng.int(-r, r)
    if (sx < 2 || sy < 2 || sx >= level.width - 2 || sy >= level.height - 2) continue
    if (level.tiles[sy * level.width + sx] !== Tile.Rock) continue
    const [dx, dy] = rng.pick(DIRS)
    // Open ground behind the first rock tile...
    if (!canWalk(level, sx - dx, sy - dy, 'myrr')) continue
    // ...a short run of rock...
    const tiles: PathNode[] = []
    let x = sx, y = sy
    while (tiles.length < H.maxDigLength && x > 1 && y > 1 && x < level.width - 2 && y < level.height - 2 &&
      level.tiles[y * level.width + x] === Tile.Rock) {
      tiles.push({ levelIndex: hot.at.levelIndex, x, y })
      x += dx; y += dy
    }
    // ...and open ground on the far side.
    if (!canWalk(level, x, y, 'myrr')) continue
    const start = { levelIndex: hot.at.levelIndex, x: sx - dx, y: sy - dy }
    const end = { levelIndex: hot.at.levelIndex, x, y }
    const around = findPath(world, start, end, 'myrr')
    const savings = (around ? around.length : 999) - (tiles.length + 1)
    if (savings >= H.minDigSavings && (!best || savings > best.savings)) best = { start, tiles, savings }
  }
  return best ? { levelIndex: hot.at.levelIndex, start: best.start, tiles: best.tiles } : null
}

/** Turn one rock tile into tunnel floor. */
export function digTile(world: World, at: PathNode): void {
  const level = world.levels[at.levelIndex]
  const i = at.y * level.width + at.x
  level.tiles[i] = Tile.Floor
  level.natural[i] = 1
  markChanged(level, i)
}

/**
 * A mining charge: tunnel floor within `radius` of (x, y) collapses into rock for
 * good. Anyone standing there is killed by the caller. Returns the collapsed tiles.
 */
export function collapseTunnel(world: World, at: PathNode, radius: number): number[] {
  const level = world.levels[at.levelIndex]
  const out: number[] = []
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const x = at.x + dx, y = at.y + dy
      if (x < 1 || y < 1 || x >= level.width - 1 || y >= level.height - 1) continue
      const i = y * level.width + x
      // Only natural tunnel floor (not rooms, links or built corridors).
      if (level.tiles[i] !== Tile.Floor || !level.natural[i] || level.roomOf[i] >= 0) continue
      level.tiles[i] = Tile.Rock
      level.resin[i] = 0
      markChanged(level, i)
      out.push(i)
    }
  return out
}

/** A narrow tunnel tile (two or fewer open neighbours) near (x, y): a good place for a charge. */
export function chokePoint(world: World, at: PathNode, searchRadius: number): PathNode | null {
  const level = world.levels[at.levelIndex]
  let best: PathNode | null = null, bestD = Infinity
  for (let dy = -searchRadius; dy <= searchRadius; dy++)
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      const x = at.x + dx, y = at.y + dy
      if (x < 2 || y < 2 || x >= level.width - 2 || y >= level.height - 2) continue
      const i = y * level.width + x
      if (level.tiles[i] !== Tile.Floor || !level.natural[i] || level.roomOf[i] >= 0) continue
      let open = 0
      for (const [ox, oy] of DIRS) if (canWalk(level, x + ox, y + oy, 'human')) open++
      if (open > 2) continue
      const d = Math.hypot(dx, dy)
      if (d < bestD) { best = { levelIndex: at.levelIndex, x, y }; bestD = d }
    }
  return best
}
