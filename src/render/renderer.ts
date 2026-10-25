// Draws the sim state to the canvas. Only reads the sim, never changes it.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import type { Level } from '../world/level.ts'
import { Tile } from '../world/tiles.ts'
import { BARRIER_ART, TILE_ART, drawFlare, drawResin, floorColor, type FloorKind } from './tileArt.ts'
import { AGENT_ART } from './agentArt.ts'
import { BARRIER_SPRITES, TILE_SPRITES, drawResinSprite, type TileSpot } from './tileSprites.ts'
import { AGENT_SPRITES } from './agentSprites.ts'
import { drawSprite, spritesReady } from './sprites.ts'
import { Effects } from './effects.ts'
import { isHidden } from '../systems/camouflage.ts'
import { describeAgent } from '../agents/describe.ts'
import { formatClock } from '../core/clock.ts'
import { isLit } from '../systems/power.ts'
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
  choiceBack: 'rgba(10, 12, 16, 0.75)',
  choiceText: '#ffe08a',
  hover: 'rgba(255, 255, 255, 0.35)',
}

/** Tiles that count as wall when choosing a wall's edges and a door's direction. */
const WALL_LIKE = new Set<number>([Tile.Rock, Tile.BuildingWall, Tile.Window, Tile.Door, Tile.Doorway])

/** What a tile's sprite depends on: open sides (for wall edges), door direction, texture variant. */
function tileSpot(level: Level, x: number, y: number, floor: FloorKind): TileSpot {
  const wall = (tx: number, ty: number) => tx < 0 || ty < 0 || tx >= level.width || ty >= level.height || WALL_LIKE.has(level.tiles[ty * level.width + tx])
  const open = (wall(x, y - 1) ? 0 : 1) | (wall(x + 1, y) ? 0 : 2) | (wall(x, y + 1) ? 0 : 4) | (wall(x - 1, y) ? 0 : 8)
  const solid = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return true
    const t = level.tiles[ty * level.width + tx]
    return t === Tile.Rock || t === Tile.BuildingWall || t === Tile.Window
  }
  const horizontal = solid(x - 1, y) || solid(x + 1, y)
  const variant = (((x * 73856093) ^ (y * 19349663) ^ (level.id * 83492791)) >>> 0) % 4
  return { levelIndex: level.id - 1, floor, open, horizontal, variant }
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
  /** Drawing with sprites (the sheet has loaded and G hasn't switched to shapes). */
  private sprites = false
  /** Fight marks, resin glints, night and flashlights (sprite mode only). */
  private effects = new Effects()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D not supported')
    this.ctx = ctx
  }

  render(sim: SimState, view: ViewState): void {
    this.resizeToWindow()
    this.updateFps()
    // Switched between sprites and shapes (or the sheet just loaded): repaint the levels.
    const sprites = view.art === 'sprites' && spritesReady()
    if (sprites !== this.sprites) {
      this.sprites = sprites
      this.levelCache.clear()
      this.changesSeen.clear()
    }

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
    this.effects.update(sim)
    if (this.sprites) {
      this.effects.drawMarks(ctx, sim, view.levelIndex, ox, oy, tile)
      this.effects.drawResinGlints(ctx, sim, view.levelIndex, ox, oy, tile, w, h)
    }
    this.drawLinkMarkers(level, ox, oy, tile)
    if (view.showPheromones) this.drawPheromones(sim, view.levelIndex, ox, oy, tile)
    this.drawSensors(sim, view.levelIndex, ox, oy, tile)
    this.drawAgents(sim, view.levelIndex, ox, oy, tile)
    if (view.paused) this.drawChoices(sim, view.levelIndex, ox, oy, tile)
    // Darkness: with sprites, night on the surface and flashlights on unlit levels;
    // with shapes, just dim the whole level when it has no light.
    if (this.sprites) {
      this.effects.drawDarkness(ctx, sim, view.levelIndex, isLit(sim.power, view.levelIndex), ox, oy, tile, w, h)
    } else if (!isLit(sim.power, view.levelIndex)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.fillRect(ox, oy, level.width * tile, level.height * tile)
    }
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
      for (let k = seen - level.changesTrimmed; k < level.changes.length; k++) {
        const i = level.changes[k]
        this.paintTile(ctx, level, i)
        // Walls pick their edges from their neighbours, so a dug tunnel changes those too.
        if (this.sprites) for (const n of [i - 1, i + 1, i - level.width, i + level.width]) if (n >= 0 && n < level.tiles.length) this.paintTile(ctx, level, n)
      }
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
    if (this.sprites) {
      const spot = tileSpot(level, x, y, kind)
      TILE_SPRITES[level.tiles[i] as Tile](ctx, x * size, y * size, size, spot)
      if (level.resin[i]) drawResinSprite(ctx, x * size, y * size, size, spot)
      const barrier = BARRIER_SPRITES[level.barrierKind[i]]
      if (barrier) drawSprite(ctx, barrier, x * size, y * size, size, size)
      return
    }
    TILE_ART[level.tiles[i] as Tile](ctx, x * size, y * size, size, floorColor(kind))
    if (level.resin[i]) drawResin(ctx, x * size, y * size, size, '')
    if (level.barrierKind[i]) BARRIER_ART[level.barrierKind[i]]?.(ctx, x * size, y * size, size, '')
  }

  /** Motion sensors: small blue dots, red for a moment after they go off. */
  private drawSensors(sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    const { ctx } = this
    for (const s of sim.sensors) {
      if (s.levelIndex !== levelIndex) continue
      ctx.fillStyle = sim.tick - s.lastAlert < 40 ? '#ff4d4d' : '#4da6ff'
      ctx.fillRect(ox + s.x * tile - tile * 0.15, oy + s.y * tile - tile * 0.15, tile * 0.3, tile * 0.3)
    }
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
    for (const f of sim.world.levels[levelIndex].flares) drawFlare(ctx, ox + f.x * tile, oy + f.y * tile, CONFIG.flares.radius * tile, tile)
    for (const agent of sim.agents) {
      if (agent.dead || agent.civ?.mode === 'evacuated' || agent.levelIndex !== levelIndex) continue
      // Faint: crossing between levels, or a Myrr hidden in the resin (humans can't see it).
      ctx.globalAlpha = agent.state.name === 'crossing' ? 0.4 : isHidden(agent, sim.world.levels[levelIndex]) ? 0.45 : 1
      const cx = ox + agent.x * tile, cy = oy + agent.y * tile
      ;(this.sprites ? AGENT_SPRITES : AGENT_ART)[agent.kind](ctx, cx, cy, tile, agent)
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
      ctx.strokeStyle = s.flame ? 'rgba(255, 120, 30, 0.9)' : s.hit ? 'rgba(255, 230, 120, 0.9)' : 'rgba(255, 230, 120, 0.35)'
      ctx.beginPath()
      ctx.moveTo(ox + s.x0 * tile, oy + s.y0 * tile)
      ctx.lineTo(ox + s.x1 * tile, oy + s.y1 * tile)
      ctx.stroke()
    }
  }

  /**
   * While paused: each Myrr's last scored choice and its score ("scout 0.85") over
   * its head, once zoomed in enough to read (see core/utility.ts).
   */
  private drawChoices(sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    if (tile < CONFIG.render.linkLabelMinTilePx) return
    const { ctx } = this
    ctx.font = `${Math.round(Math.max(9, tile * 0.55))}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (const a of sim.agents) {
      const choice = a.myrr?.lastChoice
      if (!choice || a.dead || a.levelIndex !== levelIndex) continue
      const pick = choice.split(' ')[0]
      const score = choice.match(new RegExp(`[(,] ?${pick} ([0-9.]+)`))?.[1] ?? ''
      const label = `${pick} ${score}`
      const x = ox + a.x * tile, y = oy + a.y * tile - tile * 0.7
      ctx.fillStyle = COLORS.choiceBack
      const w = ctx.measureText(label).width + 6
      ctx.fillRect(x - w / 2, y - tile * 0.65, w, tile * 0.65)
      ctx.fillStyle = COLORS.choiceText
      ctx.fillText(label, x, y)
    }
    ctx.textAlign = 'left'
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
