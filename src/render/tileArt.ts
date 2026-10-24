// How each tile type is drawn. This is the ONE place that maps a tile type to
// its look. The Art Pass swaps these draw functions for sprites; nothing else changes.

import { Tile } from '../world/tiles.ts'
import type { RoomType } from '../world/level.ts'

/** Draws one tile at screen position (x, y) with size s. `floor` is the floor colour under it. */
export type TileDraw = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, floor: string) => void

const PALETTE = {
  rock: '#221c17',
  wall: '#5b6573',
  floorSurface: '#2f353e',
  floorMine: '#4a4134',
  ground: '#4b4436',
  paved: '#5c5a55',
  boulder: '#7c756b',
  door: '#c08a2e',
  windowGlass: '#8fd3e8',
  doorway: '#4a5260',
  elevator: '#c9a227',
  ladder: '#d08a3c',
  chute: '#161412',
  vent: '#9b59c4',
  dark: '#14171b',
}

const fill = (color: string): TileDraw => (ctx, x, y, s) => {
  ctx.fillStyle = color
  ctx.fillRect(x, y, s + 0.5, s + 0.5)
}

export const TILE_ART: Record<Tile, TileDraw> = {
  [Tile.Rock]: fill(PALETTE.rock),
  [Tile.BuildingWall]: fill(PALETTE.wall),
  [Tile.Floor]: (ctx, x, y, s, floor) => fill(floor)(ctx, x, y, s, floor),
  [Tile.Ground]: fill(PALETTE.ground),
  [Tile.Boulder]: (ctx, x, y, s) => {
    fill(PALETTE.ground)(ctx, x, y, s, '')
    ctx.fillStyle = PALETTE.boulder
    ctx.beginPath()
    ctx.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2)
    ctx.fill()
  },
  [Tile.Door]: (ctx, x, y, s, floor) => {
    fill(floor)(ctx, x, y, s, floor)
    ctx.fillStyle = PALETTE.door
    ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8)
  },
  [Tile.Window]: (ctx, x, y, s) => {
    fill(PALETTE.wall)(ctx, x, y, s, '')
    ctx.fillStyle = PALETTE.windowGlass
    ctx.fillRect(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4)
  },
  [Tile.Doorway]: fill(PALETTE.doorway),
  [Tile.Elevator]: (ctx, x, y, s) => {
    fill(PALETTE.dark)(ctx, x, y, s, '')
    ctx.strokeStyle = PALETTE.elevator
    ctx.lineWidth = Math.max(1, s * 0.12)
    ctx.strokeRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8)
  },
  [Tile.Ladder]: (ctx, x, y, s) => {
    fill(PALETTE.dark)(ctx, x, y, s, '')
    ctx.fillStyle = PALETTE.ladder
    ctx.fillRect(x + s * 0.2, y, s * 0.12, s)
    ctx.fillRect(x + s * 0.68, y, s * 0.12, s)
    for (const f of [0.2, 0.5, 0.8]) ctx.fillRect(x + s * 0.2, y + s * f, s * 0.6, s * 0.08)
  },
  [Tile.Chute]: (ctx, x, y, s, floor) => {
    fill(floor)(ctx, x, y, s, floor)
    ctx.fillStyle = PALETTE.chute
    ctx.beginPath()
    ctx.arc(x + s / 2, y + s / 2, s * 0.4, 0, Math.PI * 2)
    ctx.fill()
  },
  [Tile.Vent]: (ctx, x, y, s) => {
    fill(PALETTE.dark)(ctx, x, y, s, '')
    ctx.fillStyle = PALETTE.vent
    for (const f of [0.2, 0.45, 0.7]) ctx.fillRect(x + s * 0.15, y + s * f, s * 0.7, s * 0.12)
  },
}

/** Barriers drawn over a tile: 1 barricade (planks), 2 weld (orange seam), 3 boards (planks on a window). */
export const BARRIER_ART: Record<number, TileDraw> = {
  1: (ctx, x, y, s) => {
    ctx.fillStyle = '#7a5530'
    ctx.fillRect(x + s * 0.05, y + s * 0.2, s * 0.9, s * 0.18)
    ctx.fillRect(x + s * 0.05, y + s * 0.6, s * 0.9, s * 0.18)
  },
  2: (ctx, x, y, s) => {
    ctx.fillStyle = '#ff8c1a'
    ctx.fillRect(x + s * 0.42, y + s * 0.05, s * 0.16, s * 0.9)
    ctx.fillRect(x + s * 0.05, y + s * 0.42, s * 0.9, s * 0.16)
  },
  3: (ctx, x, y, s) => {
    ctx.fillStyle = '#8a6238'
    ctx.fillRect(x + s * 0.1, y + s * 0.15, s * 0.8, s * 0.2)
    ctx.fillRect(x + s * 0.1, y + s * 0.6, s * 0.8, s * 0.2)
  },
}

/** Resin layer drawn over a tile. */
export const drawResin: TileDraw = (ctx, x, y, s) => {
  ctx.fillStyle = 'rgba(120, 70, 170, 0.55)'
  ctx.fillRect(x, y, s + 0.5, s + 0.5)
}

/** Floor colour by room type, so rooms read at a glance. */
const ROOM_FLOOR: Partial<Record<RoomType, string>> = {
  command: '#2f3b52',
  armory: '#4a2e31',
  medbay: '#284544',
  generator: '#47422a',
  security: '#363650',
  mess: '#3b3542',
  hive: '#3d2948',
}
const DEFAULT_ROOM_FLOOR = '#353c47'

/** What kind of floor a tile is, for choosing its colour. */
export type FloorKind = { room: RoomType; outdoor: boolean } | 'built' | 'natural'

export function floorColor(kind: FloorKind): string {
  if (kind === 'built') return PALETTE.floorSurface
  if (kind === 'natural') return PALETTE.floorMine
  if (kind.outdoor) return PALETTE.paved
  return ROOM_FLOOR[kind.room] ?? DEFAULT_ROOM_FLOOR
}
