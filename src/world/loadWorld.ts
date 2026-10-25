// Turns the hand-written maps into loaded levels, and checks them for mistakes.
// All problems are collected and reported together, with level and position.

import { CONFIG } from '../config.ts'
import { CHAR_TO_TILE, TILE_INFO, Tile, isRoomInterior } from './tiles.ts'
import { ROOM_LETTERS, type Level, type LevelDef, type Room } from './level.ts'
import { LINK_KIND_INFO, linkKindOf, type Link } from './links.ts'

export interface World {
  /** Levels in order; levels[0] is Level 1. */
  levels: Level[]
  links: Link[]
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

export function loadWorld(defs: LevelDef[]): World {
  const errors: string[] = []
  const { levelWidth: width, levelHeight: height } = CONFIG.world

  const levels = defs.map((def) => {
    const where = (x: number, y: number) => `Level ${def.id} (${x}, ${y})`
    if (def.map.length !== height) errors.push(`Level ${def.id} has ${def.map.length} rows, expected ${height}`)
    def.map.forEach((row, y) => {
      if (row.length !== width) errors.push(`Level ${def.id} row ${y} is ${row.length} wide, expected ${width}`)
    })

    const tiles = new Uint8Array(width * height).fill(Tile.Rock)
    const markers: { letter: string; i: number }[] = [] // in reading order

    for (let y = 0; y < Math.min(height, def.map.length); y++) {
      const row = def.map[y]
      for (let x = 0; x < Math.min(width, row.length); x++) {
        const c = row[x]
        const i = y * width + x
        if (c in CHAR_TO_TILE) {
          tiles[i] = CHAR_TO_TILE[c]
        } else if (c in ROOM_LETTERS) {
          tiles[i] = Tile.Floor
          markers.push({ letter: c, i })
        } else {
          errors.push(`${where(x, y)}: unknown character '${c}'`)
        }
      }
    }

    const rooms = findRooms(def, tiles, width, markers, errors)
    const level: Level = {
      id: def.id,
      name: def.name,
      width,
      height,
      tiles,
      resin: new Uint8Array(width * height),
      barrierKind: new Uint8Array(width * height),
      barrier: new Float32Array(width * height),
      damage: new Float32Array(width * height),
      natural: findNaturalFloor(tiles, width, rooms.roomOf),
      roomOf: rooms.roomOf,
      rooms: rooms.list,
      linksAt: new Map(),
      changes: [],
      changesTrimmed: 0,
      flares: [],
    }
    return level
  })

  const links = joinLevels(levels, errors)
  checkSurfaceVents(levels, errors)

  if (errors.length) throw new Error(`Map problems:\n- ${errors.join('\n- ')}`)
  return { levels, links }
}

/** Flood-fill each room from its marker letter, and name it. */
function findRooms(
  def: LevelDef,
  tiles: Uint8Array,
  width: number,
  markers: { letter: string; i: number }[],
  errors: string[],
): { roomOf: Int16Array; list: Room[] } {
  const roomOf = new Int16Array(tiles.length).fill(-1)
  const list: Room[] = []
  const countByLetter: Record<string, number> = {}

  for (const { letter, i: start } of markers) {
    const n = (countByLetter[letter] = (countByLetter[letter] ?? 0) + 1)
    const info = ROOM_LETTERS[letter]
    const name = def.names[letter]?.[n - 1] ?? `${info.label} ${n}`
    const sx = start % width, sy = (start - sx) / width

    if (roomOf[start] !== -1) {
      errors.push(`Level ${def.id} (${sx}, ${sy}): '${letter}' (${name}) is inside room '${list[roomOf[start]].name}', which already has a letter`)
      continue
    }

    const index = list.length
    const stack = [start]
    roomOf[start] = index
    let count = 0, sumX = 0, sumY = 0, outdoor = false
    while (stack.length) {
      const i = stack.pop()!
      const x = i % width, y = (i - x) / width
      count++; sumX += x; sumY += y
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny * width >= tiles.length) continue
        const n2 = ny * width + nx
        if (tiles[n2] === Tile.Ground) outdoor = true
        if (!isRoomInterior(tiles[n2] as Tile) || roomOf[n2] === index) continue
        roomOf[n2] = index
        stack.push(n2)
      }
    }
    if (count > CONFIG.world.maxRoomTiles) {
      errors.push(`Level ${def.id}: room '${name}' spreads over ${count} tiles — missing a wall, door or doorway?`)
    }
    list.push({ index, name, type: info.type, tileCount: count, outdoor, centerX: sumX / count, centerY: sumY / count })
  }

  for (const [letter, names] of Object.entries(def.names)) {
    const used = countByLetter[letter] ?? 0
    if (names && names.length > used) {
      errors.push(`Level ${def.id}: ${names.length} names given for '${letter}' but the map has ${used} '${letter}' rooms`)
    }
  }
  return { roomOf, list }
}

/** Floor outside rooms is natural (cave, tunnel) if its open area touches rock or ground, else built (corridor). */
function findNaturalFloor(tiles: Uint8Array, width: number, roomOf: Int16Array): Uint8Array {
  const natural = new Uint8Array(tiles.length)
  const done = new Uint8Array(tiles.length)
  const inArea = (i: number) => roomOf[i] === -1 && isRoomInterior(tiles[i] as Tile)
  for (let start = 0; start < tiles.length; start++) {
    if (done[start] || !inArea(start)) continue
    const area = [start]
    done[start] = 1
    let touchesNature = false
    for (let k = 0; k < area.length; k++) {
      const i = area[k]
      const x = i % width, y = (i - x) / width
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny * width >= tiles.length) continue
        const n = ny * width + nx
        if (tiles[n] === Tile.Rock || tiles[n] === Tile.Ground) touchesNature = true
        if (!done[n] && inArea(n)) { done[n] = 1; area.push(n) }
      }
    }
    if (touchesNature) for (const i of area) natural[i] = 1
  }
  return natural
}

/** Pair link tiles with the same tile at the same spot on the next level down. */
function joinLevels(levels: Level[], errors: string[]): Link[] {
  const links: Link[] = []
  const byId = new Map(levels.map((l) => [l.id, l]))

  for (const upper of levels) {
    const lower = byId.get(upper.id + 1)
    if (!lower) continue
    for (let i = 0; i < upper.tiles.length; i++) {
      const kind = linkKindOf(upper.tiles[i] as Tile)
      if (!kind || lower.tiles[i] !== upper.tiles[i]) continue
      const x = i % upper.width, y = (i - x) / upper.width
      const link: Link = {
        kind,
        myrrOnly: LINK_KIND_INFO[kind].myrrOnly,
        ends: [{ level: upper.id, x, y }, { level: lower.id, x, y }],
      }
      links.push(link)
      for (const level of [upper, lower]) {
        const list = level.linksAt.get(i) ?? []
        list.push(link)
        level.linksAt.set(i, list)
      }
    }
  }

  // Every elevator, ladder and chute tile needs a partner. Unpaired vents are
  // ducts inside the level, allowed below the surface only.
  // Only checked once both neighbouring levels are loaded (a level may still be being drawn).
  for (const level of levels) {
    const above = level.id - 1, below = level.id + 1
    const neighboursLoaded = (above < 1 || byId.has(above)) && (below > CONFIG.world.levelCount || byId.has(below))
    if (!neighboursLoaded) continue
    for (let i = 0; i < level.tiles.length; i++) {
      const kind = linkKindOf(level.tiles[i] as Tile)
      if (!kind || level.linksAt.has(i)) continue
      if (kind === 'vent' && level.id > 1) continue
      const x = i % level.width, y = (i - x) / level.width
      errors.push(`Level ${level.id} (${x}, ${y}): ${LINK_KIND_INFO[kind].name} has no matching tile on the level above or below`)
    }
  }
  return links
}

/** On Level 1, vents must open outdoors (open ground or a cave), never inside a building. */
function checkSurfaceVents(levels: Level[], errors: string[]): void {
  const surface = levels.find((l) => l.id === 1)
  if (!surface) return
  const { tiles, width } = surface
  const open = (t: Tile) => t !== Tile.Rock && t !== Tile.BuildingWall && t !== Tile.Door && t !== Tile.Window && t !== Tile.Boulder

  for (let start = 0; start < tiles.length; start++) {
    if (tiles[start] !== Tile.Vent) continue
    // Spread through open tiles; reaching ground or touching rock means outdoors.
    const seen = new Set([start])
    const stack = [start]
    let outdoors = false
    while (stack.length && !outdoors && seen.size < 5000) {
      const i = stack.pop()!
      const x = i % width, y = (i - x) / width
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny * width >= tiles.length) continue
        const n = ny * width + nx
        const t = tiles[n] as Tile
        if (t === Tile.Ground || t === Tile.Rock) { outdoors = true; break }
        if (!seen.has(n) && open(t)) { seen.add(n); stack.push(n) }
      }
    }
    if (!outdoors) {
      const x = start % width, y = (start - x) / width
      errors.push(`Level 1 (${x}, ${y}): vent opens inside a building — surface vents must be outdoors`)
    }
  }
}

/** Short description of a tile, for the debug readout. */
export function describeTile(level: Level, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return ''
  const i = y * level.width + x
  const t = level.tiles[i] as Tile
  const room = level.roomOf[i]
  const parts = [TILE_INFO[t].name]
  if (room >= 0) parts.push(level.rooms[room].name)
  const barrierNames = ['', 'barricaded', 'welded', 'boarded', 'locked']
  if (level.barrierKind[i]) parts.push(barrierNames[level.barrierKind[i]] + ' (' + Math.round(level.barrier[i]) + ' hp)')
  else if (level.damage[i] > 0) parts.push('damaged (' + Math.round(level.damage[i]) + ')')
  const links = level.linksAt.get(i)
  if (links) {
    const dirs = links.map((l) => (l.ends[0].level === level.id ? `down to Level ${l.ends[1].level}` : `up to Level ${l.ends[0].level}`))
    parts.push(`${LINK_KIND_INFO[links[0].kind].name}: ${dirs.join(', ')}${links[0].myrrOnly ? ' (Myrr only)' : ''}`)
  } else if (t === Tile.Vent) {
    parts.push('duct (Myrr only)')
  }
  return parts.join(' · ')
}
