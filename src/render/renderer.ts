// Draws the sim state to the canvas. Only reads the sim, never changes it.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import type { Level, RoomType } from '../world/level.ts'
import { Tile } from '../world/tiles.ts'
import { describeTile } from '../world/loadWorld.ts'
import { otherEnd } from '../world/links.ts'
import type { Camera } from './camera.ts'
import { currentCamera, type ViewState } from './view.ts'

const COLORS = {
  background: '#0b0d10',
  text: '#c9d1d9',
  panel: 'rgba(0, 0, 0, 0.6)',
  roomLabel: 'rgba(230, 237, 243, 0.75)',
  linkLabel: '#0b0d10',
  hover: 'rgba(255, 255, 255, 0.35)',
}

const TILE_COLORS: Record<Tile, string> = {
  [Tile.Floor]: '#2c323b',
  [Tile.Wall]: '#12161b',
  [Tile.Door]: '#c08a2e',
  [Tile.Threshold]: '#3a414c',
  [Tile.Vent]: '#4b2f5e',
  [Tile.Elevator]: '#38b2c9',
  [Tile.Ladder]: '#d08a3c',
  [Tile.Chute]: '#8a6a45',
  [Tile.VentShaft]: '#9b59c4',
}

/** Floor tint per room type, so rooms read at a glance. Unlisted types use the default. */
const ROOM_FLOOR: Partial<Record<RoomType, string>> = {
  command: '#2f3b52',
  medbay: '#284544',
  armory: '#4a2e31',
  generator: '#47422a',
  hive: '#3d2948',
  security: '#363650',
}
const DEFAULT_ROOM_FLOOR = '#353c47'

export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private fps = 0
  private framesThisSecond = 0
  private fpsTimer = performance.now()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D not supported')
    this.ctx = ctx
  }

  render(sim: SimState, view: ViewState): void {
    this.resizeToWindow()
    this.updateFps()

    const { ctx, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const level = sim.world.levels[view.levelIndex]
    const camera = currentCamera(view)
    const base = CONFIG.render.tileSize
    const worldW = level.width * base
    const worldH = level.height * base

    if (!camera.fitted) camera.fit(worldW, worldH, w, h)
    camera.clamp(worldW, worldH)

    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, w, h)

    // Screen position of the level's top-left corner, and tile size on screen.
    const [ox, oy] = camera.worldToScreen(0, 0, w, h)
    const tile = base * camera.zoom

    this.drawTiles(level, ox, oy, tile, w, h)
    this.drawLinkMarkers(level, ox, oy, tile)
    this.drawRoomLabels(level, ox, oy, tile)
    const hovered = this.hoveredTile(level, camera, view, w, h)
    if (hovered) {
      ctx.strokeStyle = COLORS.hover
      ctx.lineWidth = 2
      ctx.strokeRect(ox + hovered.x * tile, oy + hovered.y * tile, tile, tile)
    }
    this.drawDebug(sim, level, camera, hovered)
  }

  private hoveredTile(level: Level, camera: Camera, view: ViewState, w: number, h: number): { x: number; y: number } | null {
    if (!view.mouse) return null
    const [wx, wy] = camera.screenToWorld(view.mouse.x, view.mouse.y, w, h)
    const x = Math.floor(wx / CONFIG.render.tileSize)
    const y = Math.floor(wy / CONFIG.render.tileSize)
    if (x < 0 || y < 0 || x >= level.width || y >= level.height) return null
    return { x, y }
  }

  private drawTiles(level: Level, ox: number, oy: number, tile: number, w: number, h: number): void {
    const { ctx } = this
    // Only draw the tiles that are on screen.
    const x0 = Math.max(0, Math.floor(-ox / tile))
    const y0 = Math.max(0, Math.floor(-oy / tile))
    const x1 = Math.min(level.width - 1, Math.floor((w - ox) / tile))
    const y1 = Math.min(level.height - 1, Math.floor((h - oy) / tile))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * level.width + x
        ctx.fillStyle = this.tileColor(level, i)
        // Slightly oversized so neighbouring tiles leave no gaps when scaled.
        ctx.fillRect(ox + x * tile, oy + y * tile, tile + 0.5, tile + 0.5)
      }
    }
  }

  private tileColor(level: Level, i: number): string {
    const t = level.tiles[i] as Tile
    if (t !== Tile.Floor) return TILE_COLORS[t]
    const room = level.roomOf[i]
    if (room < 0) return TILE_COLORS[Tile.Floor]
    return ROOM_FLOOR[level.rooms[room].type] ?? DEFAULT_ROOM_FLOOR
  }

  /** Up/down arrows on link tiles, once tiles are big enough to read. */
  private drawLinkMarkers(level: Level, ox: number, oy: number, tile: number): void {
    if (tile < CONFIG.render.linkLabelMinTilePx) return
    const { ctx } = this
    ctx.fillStyle = COLORS.linkLabel
    ctx.font = `bold ${Math.round(tile * 0.7)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [i, link] of level.linksAt) {
      const x = i % level.width
      const y = (i - x) / level.width
      const arrow = otherEnd(link, level.id).level < level.id ? '▲' : '▼'
      ctx.fillText(arrow, ox + (x + 0.5) * tile, oy + (y + 0.5) * tile)
    }
    ctx.textAlign = 'left'
  }

  private drawRoomLabels(level: Level, ox: number, oy: number, tile: number): void {
    if (tile < CONFIG.render.roomLabelMinTilePx) return
    const { ctx } = this
    ctx.fillStyle = COLORS.roomLabel
    ctx.font = `${Math.round(Math.min(14, tile * 0.9))}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const room of level.rooms) {
      ctx.fillText(room.name, ox + (room.centerX + 0.5) * tile, oy + (room.centerY + 0.5) * tile)
    }
    ctx.textAlign = 'left'
  }

  private drawDebug(sim: SimState, level: Level, camera: Camera, hovered: { x: number; y: number } | null): void {
    const { ctx } = this
    const lines = [
      `seed ${sim.seed}`,
      `tick ${sim.tick}`,
      `sim time ${(sim.tick / CONFIG.sim.ticksPerSecond).toFixed(1)}s`,
      `fps ${this.fps}`,
      `level ${level.id}: ${level.name}`,
      `zoom ${camera.zoom.toFixed(2)}`,
    ]
    if (hovered) lines.push(`tile ${hovered.x}, ${hovered.y}: ${describeTile(level, hovered.x, hovered.y)}`)
    ctx.font = '13px monospace'
    ctx.textBaseline = 'top'
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16
    ctx.fillStyle = COLORS.panel
    ctx.fillRect(8, 8, width, 16 + lines.length * 16)
    ctx.fillStyle = COLORS.text
    lines.forEach((line, i) => ctx.fillText(line, 16, 16 + i * 16))
  }

  private updateFps(): void {
    this.framesThisSecond++
    const now = performance.now()
    if (now - this.fpsTimer >= 1000) {
      this.fps = this.framesThisSecond
      this.framesThisSecond = 0
      this.fpsTimer = now
    }
  }

  /** Match the canvas's pixel size to its on-screen size (sharp on high-DPI screens). */
  private resizeToWindow(): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(this.canvas.clientWidth * dpr)
    const h = Math.round(this.canvas.clientHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
