// Barriers: obstacles that can be broken given time.
//
//   windows    Myrr smash through them (quick); boards make that slower
//   walls      Takers chew through building walls (very slow, and loud)
//   barricades and welds on doors: humans put them up; Myrr break them down;
//              humans can take their own down again (cutting a weld is slow)
//
// Route planning counts the time it would take to break through, so Myrr pick
// the quickest way in: often a window, sometimes a weak barricade, rarely a wall.

import { CONFIG } from '../config.ts'
import type { Level } from '../world/level.ts'
import { Tile } from '../world/tiles.ts'
import type { World } from '../world/loadWorld.ts'
import { roomTiles, type RoomRef } from '../world/rooms.ts'
import { markChanged } from './resin.ts'

export const Barrier = { None: 0, Barricade: 1, Weld: 2, Boards: 3 } as const
export type BarrierKind = (typeof Barrier)[keyof typeof Barrier]

const B = CONFIG.barriers

/** Health of the tile itself (before any barrier): windows and walls only. */
function baseHp(t: number): number {
  return t === Tile.Window ? B.windowHp : t === Tile.BuildingWall ? B.wallHp : 0
}

/** Health left before this tile stops blocking. */
export function remainingHp(level: Level, i: number): number {
  return level.barrier[i] + Math.max(0, baseHp(level.tiles[i]) - level.damage[i])
}

/**
 * Is this tile an obstacle the side must break (or take down) to pass?
 * Humans: only barriers on doors/floors. Myrr: barriers, windows, and walls if `walls`.
 */
export function isObstacle(level: Level, i: number, side: 'human' | 'myrr', walls: boolean): boolean {
  if (level.barrier[i] > 0) return true
  if (side === 'human') return false
  const t = level.tiles[i]
  return t === Tile.Window || (walls && t === Tile.BuildingWall)
}

/** Seconds this side needs to get through the obstacle (for route planning). */
export function breakSeconds(level: Level, i: number, side: 'human' | 'myrr'): number {
  if (side === 'myrr') return remainingHp(level, i) / B.myrrBreakDps
  return level.barrier[i] / (level.barrierKind[i] === Barrier.Weld ? B.humanCutDps : B.humanRemoveDps)
}

/** Damage per second this side does to the obstacle. */
export function breakRate(level: Level, i: number, side: 'human' | 'myrr'): number {
  if (side === 'myrr') return B.myrrBreakDps
  return level.barrierKind[i] === Barrier.Weld ? B.humanCutDps : B.humanRemoveDps
}

/** Damage an obstacle. Returns true when it no longer blocks. */
export function hitObstacle(level: Level, i: number, amount: number): boolean {
  if (level.barrier[i] > 0) {
    level.barrier[i] -= amount
    if (level.barrier[i] > 0) return false
    amount = -level.barrier[i]
    level.barrier[i] = 0
    level.barrierKind[i] = Barrier.None
    markChanged(level, i)
  }
  const base = baseHp(level.tiles[i])
  if (!base) return true
  level.damage[i] += amount
  if (level.damage[i] < base) return false
  // Smashed window or chewed-through wall: it's an opening now.
  level.tiles[i] = Tile.Floor
  level.damage[i] = 0
  markChanged(level, i)
  return true
}

export function putBarrier(level: Level, i: number, kind: BarrierKind): void {
  const hp = kind === Barrier.Weld ? B.weldHp : kind === Barrier.Boards ? B.boardsHp : B.barricadeHp
  level.barrierKind[i] = kind
  level.barrier[i] = hp
  markChanged(level, i)
}

/**
 * Openings of a room that could be fortified: doors, doorways and windows on
 * its edge, each with a tile inside the room to stand on while working.
 */
export function roomOpenings(world: World, room: RoomRef): { tile: number; standX: number; standY: number; kind: BarrierKind }[] {
  const level = world.levels[room.levelIndex]
  const out: { tile: number; standX: number; standY: number; kind: BarrierKind }[] = []
  const seen = new Set<number>()
  for (const t of roomTiles(world, room)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = (t.y + dy) * level.width + (t.x + dx)
      if (seen.has(i)) continue
      const tile = level.tiles[i]
      const kind = tile === Tile.Window ? Barrier.Boards : tile === Tile.Door || tile === Tile.Doorway ? Barrier.Barricade : Barrier.None
      if (kind === Barrier.None) continue
      seen.add(i)
      out.push({ tile: i, standX: t.x, standY: t.y, kind })
    }
  }
  return out
}

/** Seconds to put up a barrier of this kind. */
export function buildSeconds(kind: BarrierKind): number {
  return kind === Barrier.Weld ? B.weldSeconds : kind === Barrier.Boards ? B.boardSeconds : B.barricadeSeconds
}
