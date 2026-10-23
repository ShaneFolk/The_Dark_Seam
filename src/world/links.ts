// Links between levels: elevator, ladders, ore chutes, vent shafts.

import { Tile } from './tiles.ts'

export type LinkKind = 'elevator' | 'ladder' | 'chute' | 'vent'

export const LINK_KIND_INFO: Record<LinkKind, { tile: Tile; myrrOnly: boolean }> = {
  elevator: { tile: Tile.Elevator, myrrOnly: false },
  ladder: { tile: Tile.Ladder, myrrOnly: false },
  chute: { tile: Tile.Chute, myrrOnly: true },
  vent: { tile: Tile.VentShaft, myrrOnly: true },
}

/** A link as written in data/maps/links.ts. Its letter appears once on each level. */
export interface LinkDef {
  /** Map letter (A–Z). */
  id: string
  kind: LinkKind
  name: string
  /** The two levels it joins, upper first. */
  levels: [number, number]
}

export interface LinkEnd {
  level: number
  x: number
  y: number
}

export interface Link {
  id: string
  kind: LinkKind
  name: string
  myrrOnly: boolean
  /** Upper end, then lower end. */
  ends: [LinkEnd, LinkEnd]
}

/** The other end of a link, seen from the given level. */
export function otherEnd(link: Link, fromLevel: number): LinkEnd {
  return link.ends[0].level === fromLevel ? link.ends[1] : link.ends[0]
}
