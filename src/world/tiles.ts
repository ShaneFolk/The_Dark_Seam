// Tile types and their rules.

export const Tile = {
  Floor: 0,
  Wall: 1,
  Door: 2,
  /** Open doorway: plain floor that marks the edge of a room. */
  Threshold: 3,
  /** Vent duct inside a level. Only the Myrr fit through. */
  Vent: 4,
  // Level link endpoints (which link is defined in data/maps/links.ts)
  Elevator: 5,
  Ladder: 6,
  Chute: 7,
  VentShaft: 8,
} as const

export type Tile = (typeof Tile)[keyof typeof Tile]

export interface TileInfo {
  name: string
  humanWalkable: boolean
  myrrWalkable: boolean
  blocksSight: boolean
}

export const TILE_INFO: Record<Tile, TileInfo> = {
  [Tile.Floor]: { name: 'Floor', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Wall]: { name: 'Wall', humanWalkable: false, myrrWalkable: false, blocksSight: true },
  [Tile.Door]: { name: 'Door', humanWalkable: true, myrrWalkable: true, blocksSight: true },
  [Tile.Threshold]: { name: 'Doorway', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Vent]: { name: 'Vent duct', humanWalkable: false, myrrWalkable: true, blocksSight: true },
  [Tile.Elevator]: { name: 'Elevator', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Ladder]: { name: 'Ladder', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.Chute]: { name: 'Ore chute', humanWalkable: true, myrrWalkable: true, blocksSight: false },
  [Tile.VentShaft]: { name: 'Vent shaft', humanWalkable: false, myrrWalkable: true, blocksSight: true },
}

/** Map characters that are fixed tiles. Letters (rooms, links) are handled by the loader. */
export const CHAR_TO_TILE: Record<string, Tile> = {
  '#': Tile.Wall,
  '.': Tile.Floor,
  '+': Tile.Door,
  ':': Tile.Threshold,
  '~': Tile.Vent,
}

/** Tiles that bound a room when flood-filling from its marker. */
export function isRoomEdge(t: Tile): boolean {
  return t === Tile.Wall || t === Tile.Door || t === Tile.Threshold || t === Tile.Vent
}
