// Turns the hand-written maps into loaded levels, and checks them for mistakes.
// All problems are collected and reported together, with level and position.

import { CHAR_TO_TILE, TILE_INFO, Tile, isRoomEdge } from './tiles.ts'
import type { Level, LevelDef, Room } from './level.ts'
import { CONFIG } from '../config.ts'
import { LINK_KIND_INFO, type Link, type LinkDef, type LinkEnd } from './links.ts'

export interface World {
  /** Levels in order; levels[0] is Level 1. */
  levels: Level[]
  links: Link[]
}

const isRoomMarker = (c: string) => c >= 'a' && c <= 'z'
const isLinkMarker = (c: string) => c >= 'A' && c <= 'Z'

export function loadWorld(defs: LevelDef[], linkDefs: LinkDef[]): World {
  const errors: string[] = []
  const linkById = new Map(linkDefs.map((l) => [l.id, l]))
  /** Link letter → endpoints found so far. */
  const found = new Map<string, LinkEnd[]>()

  const levels = defs.map((def) => {
    const where = (x: number, y: number) => `Level ${def.id} (${x}, ${y})`
    const height = def.map.length
    const width = Math.max(...def.map.map((r) => r.length))
    def.map.forEach((row, y) => {
      if (row.length !== width) errors.push(`Level ${def.id} row ${y} is ${row.length} wide, expected ${width}`)
    })

    const tiles = new Uint8Array(width * height).fill(Tile.Wall)
    const markers = new Map<string, number>() // room letter → tile index

    for (let y = 0; y < height; y++) {
      const row = def.map[y]
      for (let x = 0; x < row.length; x++) {
        const c = row[x]
        const i = y * width + x
        if (c in CHAR_TO_TILE) {
          tiles[i] = CHAR_TO_TILE[c]
        } else if (isRoomMarker(c)) {
          tiles[i] = Tile.Floor
          if (markers.has(c)) errors.push(`${where(x, y)}: room marker '${c}' appears twice`)
          markers.set(c, i)
        } else if (isLinkMarker(c)) {
          const link = linkById.get(c)
          if (!link) {
            errors.push(`${where(x, y)}: '${c}' is not defined in links.ts`)
            continue
          }
          tiles[i] = LINK_KIND_INFO[link.kind].tile
          const ends = found.get(c) ?? []
          ends.push({ level: def.id, x, y })
          found.set(c, ends)
        } else {
          errors.push(`${where(x, y)}: unknown character '${c}'`)
        }
      }
    }

    // Rooms: flood-fill from each marker out to walls, doors and doorways.
    const roomOf = new Int16Array(width * height).fill(-1)
    const rooms: Room[] = []
    for (const [marker, roomDef] of Object.entries(def.rooms)) {
      const start = markers.get(marker)
      if (start === undefined) {
        errors.push(`Level ${def.id}: room '${marker}' (${roomDef.name}) has no marker on the map`)
        continue
      }
      const index = rooms.length
      const stack = [start]
      roomOf[start] = index
      let count = 0, sumX = 0, sumY = 0
      while (stack.length) {
        const i = stack.pop()!
        const x = i % width, y = (i - x) / width
        count++; sumX += x; sumY += y
        for (const n of [i - 1, i + 1, i - width, i + width]) {
          const nx = n % width
          if (n < 0 || n >= tiles.length || Math.abs(nx - x) > 1) continue
          if (isRoomEdge(tiles[n] as Tile)) continue
          if (roomOf[n] === index) continue
          if (roomOf[n] !== -1) {
            errors.push(`Level ${def.id}: room '${marker}' leaks into room '${rooms[roomOf[n]].marker}' — missing a door or doorway?`)
            continue
          }
          roomOf[n] = index
          stack.push(n)
        }
      }
      if (count > CONFIG.world.maxRoomTiles) {
        errors.push(`Level ${def.id}: room '${marker}' (${roomDef.name}) spreads over ${count} tiles — missing a door or doorway?`)
      }
      rooms.push({ index, marker, name: roomDef.name, type: roomDef.type, tileCount: count, centerX: sumX / count, centerY: sumY / count })
    }
    for (const marker of markers.keys()) {
      if (!(marker in def.rooms)) errors.push(`Level ${def.id}: marker '${marker}' is on the map but not in rooms`)
    }

    const level: Level = {
      id: def.id,
      name: def.name,
      width,
      height,
      tiles,
      resin: new Uint8Array(width * height),
      roomOf,
      rooms,
      linksAt: new Map(),
    }
    return level
  })

  // Links: each letter must appear once on each of its two levels.
  const links: Link[] = []
  for (const def of linkDefs) {
    const ends = found.get(def.id) ?? []
    const [upper, lower] = def.levels
    const up = ends.filter((e) => e.level === upper)
    const down = ends.filter((e) => e.level === lower)
    const stray = ends.filter((e) => e.level !== upper && e.level !== lower)
    if (up.length !== 1) errors.push(`Link ${def.id} (${def.name}) should appear once on Level ${upper}, found ${up.length}`)
    if (down.length !== 1) errors.push(`Link ${def.id} (${def.name}) should appear once on Level ${lower}, found ${down.length}`)
    for (const e of stray) errors.push(`Link ${def.id} found on Level ${e.level} at (${e.x}, ${e.y}), but it joins ${upper} and ${lower}`)
    if (up.length !== 1 || down.length !== 1) continue

    const link: Link = {
      id: def.id,
      kind: def.kind,
      name: def.name,
      myrrOnly: LINK_KIND_INFO[def.kind].myrrOnly,
      ends: [up[0], down[0]],
    }
    links.push(link)
    for (const end of link.ends) {
      const level = levels.find((l) => l.id === end.level)
      level?.linksAt.set(end.y * level.width + end.x, link)
    }
  }

  if (errors.length) throw new Error(`Map problems:\n- ${errors.join('\n- ')}`)
  return { levels, links }
}

/** Short description of a tile, for the debug readout. */
export function describeTile(level: Level, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return ''
  const i = y * level.width + x
  const parts = [TILE_INFO[level.tiles[i] as Tile].name]
  const room = level.roomOf[i]
  parts.push(room >= 0 ? level.rooms[room].name : level.id === 1 ? 'corridor' : 'tunnels')
  const link = level.linksAt.get(i)
  if (link) parts.push(`${link.name}${link.myrrOnly ? ' (Myrr only)' : ''}`)
  return parts.join(' · ')
}
