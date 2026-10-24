// Tile types and their rules. Map characters are listed in PLAN.md (Map format).

export const Tile = {
  Rock: 0,
  BuildingWall: 1,
  /** Indoor floor or mine tunnel floor. */
  Floor: 2,
  /** Open outdoor ground (surface). */
  Ground: 3,
  Boulder: 4,
  Door: 5,
  Window: 6,
  /** Open doorway: walkable, marks the edge of a room. */
  Doorway: 7,
  Elevator: 8,
  Ladder: 9,
  Chute: 10,
  /** Vent: a shaft to the next level when paired, otherwise a duct inside the level. Myrr only. */
  Vent: 11,
} as const

export type Tile = (typeof Tile)[keyof typeof Tile]

export interface TileInfo {
  name: string
  humanWalkable: boolean
  myrrWalkable: boolean
  blocksSight: boolean
}

export const TILE_INFO: Record<Tile, TileInfo> = {
  [Tile.Rock]: { name: 'Rock', humanWalkable: false, myrrWalkable: false, blocksSight: true },
  [Tile.BuildingWall]: { name: 'Building wall', humanWalkable: false, myrrWalkable: false, blocksSight: true },
  [Tile.Floor]: { name: 'Floor', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Ground]: { name: 'Ground', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Boulder]: { name: 'Boulder', humanWalkable: false, myrrWalkable: false, blocksSight: false },
  [Tile.Door]: { name: 'Door', humanWalkable: true, myrrWalkable: true, blocksSight: true },
  [Tile.Window]: { name: 'Window', humanWalkable: false, myrrWalkable: false, blocksSight: false },
  [Tile.Doorway]: { name: 'Doorway', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Elevator]: { name: 'Elevator', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Ladder]: { name: 'Ladder', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Chute]: { name: 'Ore chute', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Vent]: { name: 'Vent', humanWalkable: false, myrrWalkable: true, blocksSight: true },
}

/** Map characters for fixed tiles. Room letters are handled by the loader. */
export const CHAR_TO_TILE: Record<string, Tile> = {
  '#': Tile.Rock,
  'X': Tile.BuildingWall,
  '.': Tile.Floor,
  ',': Tile.Ground,
  'o': Tile.Boulder,
  'D': Tile.Door,
  'W': Tile.Window,
  ':': Tile.Doorway,
  'E': Tile.Elevator,
  'L': Tile.Ladder,
  'C': Tile.Chute,
  'V': Tile.Vent,
}

/** Tiles that belong to a room when flood-filling from its marker. Everything else bounds the room. */
export function isRoomInterior(t: Tile): boolean {
  return t === Tile.Floor || t === Tile.Elevator || t === Tile.Ladder || t === Tile.Chute
}
