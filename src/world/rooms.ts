// Room lookups across the world: find rooms by type and pick tiles inside them.

import type { Rng } from '../core/rng.ts'
import type { World } from './loadWorld.ts'
import type { Room, RoomType } from './level.ts'
import type { PathNode } from './pathfinding.ts'
import { TILE_INFO, Tile } from './tiles.ts'
import { CONFIG } from '../config.ts'

/** A room plus the level it is on. */
export interface RoomRef {
  levelIndex: number
  room: Room
}

const tileCache = new WeakMap<World, Map<string, PathNode[]>>()

/** Walkable tiles of a room (cached). */
export function roomTiles(world: World, ref: RoomRef): PathNode[] {
  let cache = tileCache.get(world)
  if (!cache) tileCache.set(world, (cache = new Map()))
  const key = `${ref.levelIndex}:${ref.room.index}`
  let tiles = cache.get(key)
  if (!tiles) {
    const level = world.levels[ref.levelIndex]
    tiles = []
    for (let i = 0; i < level.roomOf.length; i++) {
      if (level.roomOf[i] !== ref.room.index) continue
      if (!TILE_INFO[level.tiles[i] as Tile].humanWalkable) continue
      tiles.push({ levelIndex: ref.levelIndex, x: i % level.width, y: Math.floor(i / level.width) })
    }
    cache.set(key, tiles)
  }
  return tiles
}

export function randomTileIn(world: World, ref: RoomRef, rng: Rng): PathNode {
  return rng.pick(roomTiles(world, ref))
}

/** Rooms of the given types, optionally only on one level. */
export function findRooms(world: World, types: readonly RoomType[], levelIndex?: number): RoomRef[] {
  const out: RoomRef[] = []
  world.levels.forEach((level, li) => {
    if (levelIndex !== undefined && li !== levelIndex) return
    for (const room of level.rooms) if (types.includes(room.type)) out.push({ levelIndex: li, room })
  })
  return out
}

/** The room an agent's tile is in, if any. */
export function roomAt(world: World, at: PathNode): RoomRef | null {
  const level = world.levels[at.levelIndex]
  const r = level.roomOf[at.y * level.width + at.x]
  return r >= 0 ? { levelIndex: at.levelIndex, room: level.rooms[r] } : null
}

export function sameRoom(a: RoomRef | null, b: RoomRef | null): boolean {
  return !!a && !!b && a.levelIndex === b.levelIndex && a.room.index === b.room.index
}

/** Tiles in a room that touch a wall: good hiding spots. */
export function cornerTiles(world: World, ref: RoomRef): PathNode[] {
  const level = world.levels[ref.levelIndex]
  return roomTiles(world, ref).filter(({ x, y }) => {
    let walls = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = level.tiles[(y + dy) * level.width + (x + dx)] as Tile
      if (t === Tile.BuildingWall || t === Tile.Rock) walls++
    }
    return walls >= 2
  })
}

/** The walkable tile nearest a room's middle. */
export function centreTile(world: World, ref: RoomRef): PathNode {
  const { centerX, centerY } = ref.room
  return roomTiles(world, ref).reduce((best, t) =>
    Math.hypot(t.x - centerX, t.y - centerY) < Math.hypot(best.x - centerX, best.y - centerY) ? t : best)
}

/** A room found by its name (as written in the map file), or null. */
export function roomNamed(world: World, name: string, levelIndex?: number): RoomRef | null {
  for (let li = 0; li < world.levels.length; li++) {
    if (levelIndex !== undefined && li !== levelIndex) continue
    const room = world.levels[li].rooms.find((r) => r.name === name)
    if (room) return { levelIndex: li, room }
  }
  return null
}

/** The Landing Pad on the surface (where ships land and the evacuation gathers). */
export function findLandingPad(world: World): RoomRef | null {
  return roomNamed(world, 'Landing Pad', 0)
}

/** Is a point (an agent or a tile) inside this room? */
export function isIn(world: World, at: { levelIndex: number; x: number; y: number }, ref: RoomRef | null): boolean {
  if (!ref || at.levelIndex !== ref.levelIndex) return false
  const level = world.levels[at.levelIndex]
  return level.roomOf[Math.floor(at.y) * level.width + Math.floor(at.x)] === ref.room.index
}

/**
 * A rough "how far" for picking the nearest of several things across levels: the
 * straight-line distance, plus CONFIG.movement.otherLevelDistance for each level apart.
 */
export function roughDistance(a: { levelIndex: number; x: number; y: number }, b: { levelIndex: number; x: number; y: number }): number {
  return Math.abs(a.levelIndex - b.levelIndex) * CONFIG.movement.otherLevelDistance + Math.hypot(a.x - b.x, a.y - b.y)
}
