// How each tile type is drawn with the sprite sheet (the Art Pass). The other
// mapping, tileArt.ts, draws the same tiles as coloured shapes; press G to switch.
//
// Walls are autotiled: `spot.open` says which sides of the tile face open floor,
// and picks the wall sprite drawn for exactly that mix (see scripts/make-sprites.ts).

import { Tile } from '../world/tiles.ts'
import type { SpriteName } from './spriteRects.ts'
import { drawSprite } from './sprites.ts'
import { ROOM_FLOOR, type FloorKind } from './tileArt.ts'

/** What a tile's sprite depends on besides its type. */
export interface TileSpot {
  levelIndex: number
  floor: FloorKind
  /** Sides facing open floor: 1 north, 2 east, 4 south, 8 west. */
  open: number
  /** Walls (or wall-like tiles) on its left and right, so a door here spans left to right. */
  horizontal: boolean
  /** 0-3, fixed per tile: picks between texture variants so floors don't look tiled. */
  variant: number
}

export type SpriteTileDraw = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, spot: TileSpot) => void

const sprite = (name: SpriteName): SpriteTileDraw => (ctx, x, y, s) => drawSprite(ctx, name, x, y, s, s)

/** The floor under a tile: mine dirt, colony plates (tinted by room type) or outdoor paving. */
function floor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, spot: TileSpot): void {
  const f = spot.floor
  const v = spot.variant
  if (f === 'natural') return drawSprite(ctx, `mine_${v}` as SpriteName, x, y, s, s)
  if (f === 'built') return drawSprite(ctx, `colony_${v % 2}` as SpriteName, x, y, s, s)
  if (f.outdoor) return drawSprite(ctx, `paved_${v % 2}` as SpriteName, x, y, s, s)
  // Rooms dug out of the mine (and the hive) have dirt floors; built rooms have plates.
  if (f.room === 'hive' || (spot.levelIndex > 0 && f.room === 'other')) return drawSprite(ctx, `mine_${v}` as SpriteName, x, y, s, s)
  drawSprite(ctx, `colony_${v % 2}` as SpriteName, x, y, s, s)
  const tint = ROOM_FLOOR[f.room]
  if (tint) {
    ctx.globalAlpha = 0.3
    ctx.fillStyle = tint
    ctx.fillRect(x, y, s, s)
    ctx.globalAlpha = 1
  }
}

const onFloor = (name: SpriteName | ((spot: TileSpot) => SpriteName)): SpriteTileDraw => (ctx, x, y, s, spot) => {
  floor(ctx, x, y, s, spot)
  drawSprite(ctx, typeof name === 'string' ? name : name(spot), x, y, s, s)
}

export const TILE_SPRITES: Record<Tile, SpriteTileDraw> = {
  [Tile.Rock]: (ctx, x, y, s, spot) => drawSprite(ctx, `rock_${spot.open}_${spot.variant % 2}` as SpriteName, x, y, s, s),
  [Tile.BuildingWall]: (ctx, x, y, s, spot) => drawSprite(ctx, `wall_${spot.open}` as SpriteName, x, y, s, s),
  [Tile.Floor]: floor,
  [Tile.Ground]: (ctx, x, y, s, spot) => drawSprite(ctx, `ground_${spot.variant}` as SpriteName, x, y, s, s),
  [Tile.Boulder]: (ctx, x, y, s, spot) => {
    drawSprite(ctx, `ground_${spot.variant}` as SpriteName, x, y, s, s)
    drawSprite(ctx, 'boulder', x, y, s, s)
  },
  [Tile.Door]: onFloor((spot) => (spot.horizontal ? 'door_h' : 'door_v')),
  [Tile.Window]: (ctx, x, y, s, spot) => drawSprite(ctx, spot.horizontal ? 'window_h' : 'window_v', x, y, s, s),
  [Tile.Doorway]: onFloor((spot) => (spot.horizontal ? 'doorway_h' : 'doorway_v')),
  [Tile.Elevator]: sprite('elevator'),
  [Tile.Ladder]: sprite('ladder'),
  [Tile.Chute]: onFloor('chute'),
  [Tile.Vent]: sprite('vent'),
}

/** Barriers over a tile: 1 barricade, 2 weld, 3 boards, 4 lock. */
export const BARRIER_SPRITES: Record<number, SpriteName> = { 1: 'barricade', 2: 'weld', 3: 'boards', 4: 'lock' }

/** Resin covering a tile (its own texture, replacing the floor). */
export function drawResinSprite(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, spot: TileSpot): void {
  drawSprite(ctx, `resin_${spot.variant}` as SpriteName, x, y, s, s)
}
