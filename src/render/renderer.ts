// Draws the sim state to the canvas. Only reads the sim, never changes it.

import { CONFIG } from '../config.ts'
import { TILE_WALL, type SimState } from '../sim.ts'

const COLORS = {
  background: '#0b0d10',
  floor: '#1c2128',
  wall: '#4a5361',
  gridLine: '#0b0d10',
  text: '#c9d1d9',
  panel: 'rgba(0, 0, 0, 0.6)',
}

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

  render(sim: SimState): void {
    this.resizeToWindow()
    this.updateFps()

    const { ctx, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight

    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, w, h)

    // Fit the whole grid on screen, centered. (Pan/zoom camera is Phase 1.)
    const base = CONFIG.render.tileSize
    const scale = Math.min(w / (sim.gridWidth * base), h / (sim.gridHeight * base))
    const tile = base * scale
    const offsetX = (w - sim.gridWidth * tile) / 2
    const offsetY = (h - sim.gridHeight * tile) / 2

    for (let y = 0; y < sim.gridHeight; y++) {
      for (let x = 0; x < sim.gridWidth; x++) {
        const t = sim.tiles[y * sim.gridWidth + x]
        ctx.fillStyle = t === TILE_WALL ? COLORS.wall : COLORS.floor
        // 1px gap between tiles so the grid is visible.
        ctx.fillRect(offsetX + x * tile, offsetY + y * tile, tile - 1, tile - 1)
      }
    }

    this.drawDebug(sim)
  }

  private drawDebug(sim: SimState): void {
    const { ctx } = this
    const lines = [
      `seed ${sim.seed}`,
      `tick ${sim.tick}`,
      `sim time ${(sim.tick / CONFIG.sim.ticksPerSecond).toFixed(1)}s`,
      `fps ${this.fps}`,
    ]
    ctx.fillStyle = COLORS.panel
    ctx.fillRect(8, 8, 150, 16 + lines.length * 16)
    ctx.fillStyle = COLORS.text
    ctx.font = '13px monospace'
    ctx.textBaseline = 'top'
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
