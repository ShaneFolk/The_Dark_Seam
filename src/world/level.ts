// Level and room types: the hand-written definition (LevelDef) and the
// loaded, ready-to-use form (Level).

import type { Tile } from './tiles.ts'
import type { Link } from './links.ts'

export type RoomType =
  | 'command' | 'medbay' | 'armory' | 'mess' | 'quarters' | 'lobby'
  | 'generator' | 'supply' | 'lockers' | 'stairwell' | 'workshop' | 'ore'
  | 'utility' | 'security' | 'office' | 'equipment' | 'breakroom' | 'camp' | 'hive'

export interface RoomDef {
  name: string
  type: RoomType
}

/** A level as written in data/maps/. */
export interface LevelDef {
  id: number
  name: string
  /** Room marker letter (a–z) → room. */
  rooms: Record<string, RoomDef>
  /** One string per row, one character per tile. */
  map: string[]
}

export interface Room {
  /** Index into Level.rooms. */
  index: number
  marker: string
  name: string
  type: RoomType
  tileCount: number
  /** Average tile position, used for labels. */
  centerX: number
  centerY: number
}

/** A loaded level. Grids are flat arrays, index = y * width + x. */
export interface Level {
  id: number
  name: string
  width: number
  height: number
  tiles: Uint8Array
  /** Resin layer on top of the floor (0 = none). Filled in Phase 4. */
  resin: Uint8Array
  /** Room index for each tile, or -1 for corridors and tunnels. */
  roomOf: Int16Array
  rooms: Room[]
  /** Link endpoint at a tile index, if any. */
  linksAt: Map<number, Link>
}

export function tileAt(level: Level, x: number, y: number): Tile {
  return level.tiles[y * level.width + x] as Tile
}
