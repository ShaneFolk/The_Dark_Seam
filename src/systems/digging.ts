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
