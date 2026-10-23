// Draws the sim state to the canvas. Only reads the sim, never changes it.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import type { Level, RoomType } from '../world/level.ts'
import { Tile } from '../world/tiles.ts'

const COLORS = {
  background: '#0b0d10',
  text: '#c9d1d9',
  panel: 'rgba(0, 0, 0, 0.6)',
  roomLabel: 'rgba(230, 237, 243, 0.75)',
}

const TILE_COLORS: Record<Tile, string> = {
  [Tile.Floor]: '#1f242c',
  [Tile.Wall]: '#3d4552',
  [Tile.Door]: '#c08a2e',
  [Tile.Threshold]: '#2a303a',
  [Tile.Vent]: '#4b2f5e',
  [Tile.Elevator]: '#38b2c9',
  [Tile.Ladder]: '#d08a3c',
  [Tile.Chute]: '#8a6a45',
  [Tile.VentShaft]: '#9b59c4',
}

/** Floor tint per room type, so rooms read at a glance. Unlisted types use the default. */
const ROOM_FLOOR: Partial<Record<RoomType, string>> = {
  command: '#232c3d',
  medbay: '#1d3332',
  armory: '#3a2224',
  generator: '#363220',
  hive: '#2e1f36',
  security: '#2a2a3d',
}
const DEFAULT_ROOM_FLOOR = '#262b33'

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

  render(sim: SimState, levelIndex: number): void {
    this.resizeToWindow()
    this.updateFps()

    const { ctx, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const level = sim.world.levels[levelIndex]

    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, w, h)

    // Fit the whole level on screen, centered. (Pan/zoom camera comes next.)
    const base = CONFIG.render.tileSize
    const scale = Math.min(w / (level.width * base), h / (level.height * base))
    const tile = base * scale
    const offsetX = (w - level.width * tile) / 2
    const offsetY = (h - level.height * tile) / 2

    this.drawTiles(level, offsetX, offsetY, tile)
    this.drawRoomLabels(level, offsetX, offsetY, tile)
    this.drawDebug(sim, level)
  }

  private drawTiles(level: Level, ox: number, oy: number, tile: number): void {
    const { ctx } = this
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
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

  private drawDebug(sim: SimState, level: Level): void {
    const { ctx } = this
    const lines = [
      `seed ${sim.seed}`,
      `tick ${sim.tick}`,
      `sim time ${(sim.tick / CONFIG.sim.ticksPerSecond).toFixed(1)}s`,
      `fps ${this.fps}`,
      `level ${level.id}: ${level.name}`,
    ]
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
