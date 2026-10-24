// Links between levels. A link tile connects to the same kind of tile at the
// same position on the level directly above or below.

import { Tile } from './tiles.ts'

export type LinkKind = 'elevator' | 'ladder' | 'chute' | 'vent'

export const LINK_KIND_INFO: Record<LinkKind, { tile: Tile; name: string; myrrOnly: boolean }> = {
  elevator: { tile: Tile.Elevator, name: 'Elevator', myrrOnly: false },
  ladder: { tile: Tile.Ladder, name: 'Ladder', myrrOnly: false },
  chute: { tile: Tile.Chute, name: 'Ore chute', myrrOnly: true },
  vent: { tile: Tile.Vent, name: 'Vent shaft', myrrOnly: true },
}

/** Link kind for a tile, if it is a link tile. */
export function linkKindOf(t: Tile): LinkKind | null {
  for (const [kind, info] of Object.entries(LINK_KIND_INFO)) if (info.tile === t) return kind as LinkKind
  return null
}

export interface LinkEnd {
  level: number
  x: number
  y: number
}

export interface Link {
  kind: LinkKind
  myrrOnly: boolean
  /** Upper end, then lower end. Both at the same x, y. */
  ends: [LinkEnd, LinkEnd]
}

/** The other end of a link, seen from the given level. */
export function otherEnd(link: Link, fromLevel: number): LinkEnd {
  return link.ends[0].level === fromLevel ? link.ends[1] : link.ends[0]
}
