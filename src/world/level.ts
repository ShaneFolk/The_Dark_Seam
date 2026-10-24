// Level and room types: the hand-written definition (LevelDef) and the
// loaded, ready-to-use form (Level).

import type { Tile } from './tiles.ts'
import type { Link } from './links.ts'

export type RoomType =
  | 'command' | 'armory' | 'medbay' | 'quarters' | 'mess' | 'generator'
  | 'supply' | 'workshop' | 'security' | 'other' | 'hive'

/** Room letters used on the maps. One letter goes somewhere inside each room. */
export const ROOM_LETTERS: Record<string, { type: RoomType; label: string }> = {
  K: { type: 'command', label: 'Command' },
  A: { type: 'armory', label: 'Armory' },
  M: { type: 'medbay', label: 'Med Bay' },
  Q: { type: 'quarters', label: 'Quarters' },
  F: { type: 'mess', label: 'Mess Hall' },
  G: { type: 'generator', label: 'Generator' },
  S: { type: 'supply', label: 'Supply' },
  T: { type: 'workshop', label: 'Workshop' },
  P: { type: 'security', label: 'Security' },
  R: { type: 'other', label: 'Room' },
  H: { type: 'hive', label: 'Hive Core' },
}

/** A level as written in data/maps/. */
export interface LevelDef {
  id: number
  name: string
  /**
   * Room names per letter, in reading order (top row first, then left to right).
   * Rooms without a name get "<label> <number>".
   */
  names: Partial<Record<string, string[]>>
  /** One string per row, one character per tile. */
  map: string[]
}

export interface Room {
  /** Index into Level.rooms. */
  index: number
  name: string
  type: RoomType
  tileCount: number
  /** Paved outdoor area (landing pad, yards) rather than a roofed room. */
  outdoor: boolean
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
  /** 1 where a floor tile outside any room is natural (cave, tunnel), 0 where it is built (corridor). */
  natural: Uint8Array
  /** Room index for each tile, or -1 outside rooms. */
  roomOf: Int16Array
  rooms: Room[]
  /** Links at a tile index (an elevator tile on Level 2 has one up and one down). */
  linksAt: Map<number, Link[]>
}

export function tileAt(level: Level, x: number, y: number): Tile {
  return level.tiles[y * level.width + x] as Tile
}
