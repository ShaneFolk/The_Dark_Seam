// Draws the sim state to the canvas. Only reads the sim, never changes it.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import type { Level } from '../world/level.ts'
import type { Tile } from '../world/tiles.ts'
import { BARRIER_ART, TILE_ART, drawResin, floorColor, type FloorKind } from './tileArt.ts'
import { AGENT_ART } from './agentArt.ts'
import { describeAgent } from '../agents/describe.ts'
import { formatClock } from '../core/clock.ts'
import { describeTile } from '../world/loadWorld.ts'
import { otherEnd } from '../world/links.ts'
import type { Camera } from './camera.ts'
import { currentCamera, type ViewState } from './view.ts'

const COLORS = {
  background: '#0b0d10',
  text: '#c9d1d9',
  panel: 'rgba(0, 0, 0, 0.6)',
  roomLabel: 'rgba(230, 237, 243, 0.75)',
  linkLabel: '#f0f3f6',
  hover: 'rgba(255, 255, 255, 0.35)',
}

export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private fps = 0
  private framesThisSecond = 0
  private fpsTimer = performance.now()
  /** Each level's tiles drawn once at zoom 1. Redrawn only when invalidated. */
  private levelCache = new Map<number, HTMLCanvasElement>()
  /** How many entries of each level's change list have been repainted. */
  private changesSeen = new Map<number, number>()

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

    this.drawLevel(level, ox, oy, tile)
    this.drawLinkMarkers(level, ox, oy, tile)
    if (view.showPheromones) this.drawPheromones(sim, view.levelIndex, ox, oy, tile)
    this.drawAgents(sim, view.levelIndex, ox, oy, tile)
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

  /** Forget a level's cached image, e.g. after a door or resin changes (later phases). */
  invalidate(levelId: number): void {
    this.levelCache.delete(levelId)
  }

  private drawLevel(level: Level, ox: number, oy: number, tile: number): void {
    let cache = this.levelCache.get(level.id)
    const seen = this.changesSeen.get(level.id) ?? 0
    const total = level.changesTrimmed + level.changes.length
    // Repaint everything if the change list was trimmed past what we've seen.
    if (!cache || seen < level.changesTrimmed) {
      cache = this.paintLevel(level)
      this.levelCache.set(level.id, cache)
    } else if (seen < total) {
      const ctx = cache.getContext('2d')!
      for (let k = seen - level.changesTrimmed; k < level.changes.length; k++) this.paintTile(ctx, level, level.changes[k])
    }
    this.changesSeen.set(level.id, total)
    this.ctx.imageSmoothingEnabled = false
    this.ctx.drawImage(cache, ox, oy, level.width * tile, level.height * tile)
  }

  /** Draw every tile of a level once, at zoom 1, into an off-screen canvas. */
  private paintLevel(level: Level): HTMLCanvasElement {
    const size = CONFIG.render.tileSize
    const canvas = document.createElement('canvas')
    canvas.width = level.width * size
    canvas.height = level.height * size
    const ctx = canvas.getContext('2d')!
    for (let i = 0; i < level.tiles.length; i++) this.paintTile(ctx, level, i)
    return canvas
  }

  private paintTile(ctx: CanvasRenderingContext2D, level: Level, i: number): void {
    const size = CONFIG.render.tileSize
    const x = i % level.width, y = Math.floor(i / level.width)
    const room = level.roomOf[i]
    const kind: FloorKind = room >= 0
      ? { room: level.rooms[room].type, outdoor: level.rooms[room].outdoor }
      : level.natural[i] ? 'natural' : 'built'
    TILE_ART[level.tiles[i] as Tile](ctx, x * size, y * size, size, floorColor(kind))
    if (level.resin[i]) drawResin(ctx, x * size, y * size, size, '')
    if (level.barrierKind[i]) BARRIER_ART[level.barrierKind[i]]?.(ctx, x * size, y * size, size, '')
  }

  /** Scent as coloured squares, brighter where stronger. */
  private drawPheromones(sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    const w = sim.world.levels[levelIndex].width
    const { ctx } = this
    // Green = trail (prey), red = alarm, yellow = danger.
    const layers: [Float32Array, string][] = [
      [sim.pheromones.trail[levelIndex], '90, 230, 120'],
      [sim.pheromones.alarm[levelIndex], '255, 70, 60'],
      [sim.pheromones.danger[levelIndex], '255, 190, 40'],
    ]
    for (const [map, rgb] of layers) {
      for (let i = 0; i < map.length; i++) {
        const s = map[i]
        if (s < 0.05) continue
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.75, 0.15 + s / 10)})`
        ctx.fillRect(ox + (i % w) * tile, oy + Math.floor(i / w) * tile, tile, tile)
      }
    }
  }

  /** Agents on the shown level. Those riding a link are drawn faded at the link. */
  private drawAgents(sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    const { ctx } = this
    for (const agent of sim.agents) {
      if (agent.dead || agent.levelIndex !== levelIndex) continue
      ctx.globalAlpha = agent.state.name === 'crossing' ? 0.4 : 1
      const cx = ox + agent.x * tile, cy = oy + agent.y * tile
      AGENT_ART[agent.kind](ctx, cx, cy, tile, agent)
      // Health bar over anyone hurt, once zoomed in enough to read it.
      if (agent.health < agent.maxHealth && tile >= CONFIG.render.linkLabelMinTilePx && agent.civ?.mode !== 'cocooned') {
        const w = tile * 0.8, h = Math.max(2, tile * 0.1)
        ctx.fillStyle = '#300'
        ctx.fillRect(cx - w / 2, cy - tile * 0.6, w, h)
        ctx.fillStyle = agent.side === 'human' ? '#6fdc6f' : '#ff7a5c'
        ctx.fillRect(cx - w / 2, cy - tile * 0.6, w * Math.max(0, agent.health / agent.maxHealth), h)
      }
    }
    ctx.globalAlpha = 1
    // Tracers for recent shots and swings.
    ctx.lineWidth = Math.max(1, tile * 0.06)
    for (const s of sim.shots) {
      if (s.levelIndex !== levelIndex || !s.ranged) continue
      ctx.strokeStyle = s.hit ? 'rgba(255, 230, 120, 0.9)' : 'rgba(255, 230, 120, 0.35)'
      ctx.beginPath()
      ctx.moveTo(ox + s.x0 * tile, oy + s.y0 * tile)
      ctx.lineTo(ox + s.x1 * tile, oy + s.y1 * tile)
      ctx.stroke()
    }
  }

  /** Up/down arrows on link tiles, once tiles are big enough to read. */
  private drawLinkMarkers(level: Level, ox: number, oy: number, tile: number): void {
    if (tile < CONFIG.render.linkLabelMinTilePx) return
    const { ctx } = this
    ctx.fillStyle = COLORS.linkLabel
    ctx.font = `bold ${Math.round(tile * 0.7)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [i, links] of level.linksAt) {
      const x = i % level.width
      const y = (i - x) / level.width
      const up = links.some((l) => otherEnd(l, level.id).level < level.id)
      const down = links.some((l) => otherEnd(l, level.id).level > level.id)
      const arrow = up && down ? '⇅' : up ? '▲' : '▼'
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
    lines.splice(1, 0, formatClock(sim.tick))
    if (hovered) {
      lines.push(`tile ${hovered.x}, ${hovered.y}: ${describeTile(level, hovered.x, hovered.y)}`)
      // Any agent within half a tile of the mouse.
      for (const agent of sim.agents) {
        if (agent.levelIndex !== level.id - 1) continue
        if (Math.abs(agent.x - (hovered.x + 0.5)) <= 0.75 && Math.abs(agent.y - (hovered.y + 0.5)) <= 0.75) lines.push(describeAgent(agent, sim.tick))
      }
    }
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
