// Visual effects layered over the map. Purely for looks: they read the sim and
// remember a little of their own (fight marks), but never change the sim.
//
//   fight marks   hits and deaths leave splatters that fade: green acid where a
//                 Myrr was hit, dark red blood where a human was
//   resin glints  a few pixels on the resin catch the light now and then
//   night         the surface darkens and turns blue on the night shift
//   flashlights   unlit levels (the Deep Mine, or anywhere when the power is out)
//                 sit in darkness, with light cones around soldiers and the
//                 Commander pointing where they're going, and small glows
//                 around everyone else and around flares (the Myrr get a faint
//                 one too, so they can still be watched)

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import type { Agent } from '../agents/agent.ts'
import { isFree } from '../agents/civilian.ts'
import { hourOfDay } from '../core/clock.ts'

const TPS = CONFIG.sim.ticksPerSecond
const E = {
  /** Fight marks fade out over this many sim seconds; at most this many are kept. */
  markSeconds: 180,
  maxMarks: 400,
  acid: '120, 200, 60',
  blood: '120, 20, 24',
  /** Night tint on the surface at its darkest, and the hours it runs (fading in and out over fadeHours). */
  nightAlpha: 0.4,
  nightFrom: 20,
  nightTo: 5,
  fadeHours: 2,
  /** Darkness on unlit levels, flashlight cone length and width (tiles, radians), glow radius around others (tiles). */
  darkAlpha: 0.5,
  beamTiles: 7,
  beamWidth: 0.55,
  glowTiles: 1.6,
  /** A faint glow around each Myrr, so the viewer can still follow them in the dark (tiles). */
  myrrGlowTiles: 0.9,
}

interface Mark { levelIndex: number; x: number; y: number; tick: number; rgb: string; size: number; seed: number }

export class Effects {
  private marks: Mark[] = []
  private lastShotTick = -1
  private wasDead = new Set<number>()
  /** Last direction each agent moved in, for flashlight beams. */
  private facing = new Map<number, { dx: number; dy: number; x: number; y: number }>()
  private dark: HTMLCanvasElement = document.createElement('canvas')

  /** Collect new fight marks from this tick's hits and deaths. Call once per frame. */
  update(sim: SimState): void {
    for (const s of sim.shots) {
      if (!s.hit || s.tick <= this.lastShotTick) continue
      this.add(s.levelIndex, s.x1, s.y1, s.tick, s.side === 'human' ? E.acid : E.blood, 0.18)
    }
    if (sim.shots.length) this.lastShotTick = Math.max(this.lastShotTick, ...sim.shots.map((s) => s.tick))
    for (const a of sim.agents) {
      if (!a.dead || this.wasDead.has(a.id)) continue
      this.wasDead.add(a.id)
      if (a.kind !== 'turret') this.add(a.levelIndex, a.x, a.y, sim.tick, a.side === 'myrr' ? E.acid : E.blood, 0.42)
    }
    const old = sim.tick - E.markSeconds * TPS
    if (this.marks.length && this.marks[0].tick < old) this.marks = this.marks.filter((m) => m.tick >= old)
    if (this.marks.length > E.maxMarks) this.marks.splice(0, this.marks.length - E.maxMarks)
  }

  private add(levelIndex: number, x: number, y: number, tick: number, rgb: string, size: number): void {
    this.marks.push({ levelIndex, x, y, tick, rgb, size, seed: Math.floor((x * 7919 + y * 104729) % 9973) })
  }

  /** Splatters under the agents: a blob and a few droplets, fading with age. */
  drawMarks(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    const life = E.markSeconds * TPS
    for (const m of this.marks) {
      if (m.levelIndex !== levelIndex) continue
      const alpha = 0.55 * (1 - (sim.tick - m.tick) / life)
      if (alpha <= 0) continue
      ctx.fillStyle = `rgba(${m.rgb}, ${alpha})`
      const cx = ox + m.x * tile, cy = oy + m.y * tile, r = m.size * tile
      ctx.beginPath()
      ctx.ellipse(cx, cy, r, r * 0.7, (m.seed % 6) * 0.5, 0, Math.PI * 2)
      ctx.fill()
      for (let k = 0; k < 3; k++) {
        const ang = ((m.seed + k * 2311) % 628) / 100, d = r * (1.3 + (k % 2) * 0.6)
        ctx.fillRect(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, Math.max(1, tile * 0.08), Math.max(1, tile * 0.08))
      }
    }
  }

  /** A few resin pixels glint on screen, changing about twice a second. */
  drawResinGlints(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number, w: number, h: number): void {
    if (tile < 6) return
    const level = sim.world.levels[levelIndex]
    const x0 = Math.max(0, Math.floor(-ox / tile)), y0 = Math.max(0, Math.floor(-oy / tile))
    const x1 = Math.min(level.width - 1, Math.ceil((w - ox) / tile)), y1 = Math.min(level.height - 1, Math.ceil((h - oy) / tile))
    const slot = Math.floor(performance.now() / 500)
    const px = Math.max(1, tile / 16)
    ctx.fillStyle = 'rgba(200, 170, 255, 0.85)'
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!level.resin[y * level.width + x]) continue
      const hash = ((x * 73856093) ^ (y * 19349663) ^ (slot * 83492791)) >>> 0
      if (hash % 23 !== 0) continue
      ctx.fillRect(ox + (x + ((hash >> 5) % 14 + 1) / 16) * tile, oy + (y + ((hash >> 9) % 14 + 1) / 16) * tile, px, px)
    }
  }

  /** How dark the surface is from the time of day (0 by day, up to nightAlpha at night). */
  nightLevel(tick: number): number {
    const hour = hourOfDay(tick)
    const fromNight = (a: number, b: number) => ((b - a) % 24 + 24) % 24 // hours from a to b
    if (fromNight(E.nightFrom, hour) < fromNight(E.nightFrom, E.nightTo)) {
      // Inside the night: fade in after nightFrom, fade out before nightTo.
      const sinceDusk = fromNight(E.nightFrom, hour), untilDawn = fromNight(hour, E.nightTo)
      return E.nightAlpha * Math.min(1, sinceDusk / E.fadeHours, untilDawn / E.fadeHours)
    }
    return 0
  }

  /**
   * Darkness over the level: on unlit levels, a dark layer with holes for light
   * (beams from soldiers, glows around people and flares); on the lit surface, the
   * night tint. Drawn over the agents.
   */
  drawDarkness(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, lit: boolean, ox: number, oy: number, tile: number, w: number, h: number): void {
    this.trackFacing(sim)
    const level = sim.world.levels[levelIndex]
    const night = levelIndex === 0 ? this.nightLevel(sim.tick) : 0
    const alpha = lit ? night : Math.max(E.darkAlpha, night)
    if (alpha <= 0.01) return

    const dark = this.dark
    if (dark.width !== w || dark.height !== h) { dark.width = w; dark.height = h }
    const d = dark.getContext('2d')!
    d.globalCompositeOperation = 'source-over'
    d.clearRect(0, 0, w, h)
    d.fillStyle = `rgba(6, 10, 26, ${alpha})`
    d.fillRect(Math.max(0, ox), Math.max(0, oy), Math.min(w, level.width * tile), Math.min(h, level.height * tile))

    // Cut out the light.
    d.globalCompositeOperation = 'destination-out'
    for (const a of sim.agents) {
      if (a.dead || a.levelIndex !== levelIndex || a.civ?.mode === 'evacuated' || a.civ?.mode === 'cocooned') continue
      const cx = ox + a.x * tile, cy = oy + a.y * tile
      if (a.side === 'human') {
        glow(d, cx, cy, E.glowTiles * tile)
        const beam = (a.soldier || a.kind === 'commander') && isFree(a)
        if (beam) this.drawBeam(d, a, cx, cy, tile)
      } else {
        glow(d, cx, cy, E.myrrGlowTiles * tile * (a.kind === 'brood-mother' ? 2.5 : 1))
      }
    }
    for (const f of level.flares) glow(d, ox + f.x * tile, oy + f.y * tile, CONFIG.flares.radius * tile)
    ctx.drawImage(dark, 0, 0)
  }

  /** A flashlight cone from (cx, cy) in the direction the agent last moved. */
  private drawBeam(d: CanvasRenderingContext2D, a: Agent, cx: number, cy: number, tile: number): void {
    const f = this.facing.get(a.id)
    const ang = f ? Math.atan2(f.dy, f.dx) : Math.PI / 2
    const len = E.beamTiles * tile
    const g = d.createRadialGradient(cx, cy, 0, cx, cy, len)
    g.addColorStop(0, 'rgba(0, 0, 0, 0.95)')
    g.addColorStop(0.7, 'rgba(0, 0, 0, 0.6)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    d.fillStyle = g
    d.beginPath()
    d.moveTo(cx, cy)
    d.arc(cx, cy, len, ang - E.beamWidth, ang + E.beamWidth)
    d.closePath()
    d.fill()
  }

  /** Remember which way each human last moved (beams keep pointing that way when they stop). */
  private trackFacing(sim: SimState): void {
    for (const a of sim.agents) {
      if (a.dead || a.side !== 'human' || a.kind === 'turret') continue
      const f = this.facing.get(a.id)
      if (!f) { this.facing.set(a.id, { dx: 0, dy: 1, x: a.x, y: a.y }); continue }
      const dx = a.x - f.x, dy = a.y - f.y
      if (Math.hypot(dx, dy) > 0.3) { f.dx = dx; f.dy = dy; f.x = a.x; f.y = a.y }
    }
  }
}

/** A soft round hole in the darkness. */
function glow(d: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const g = d.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, 'rgba(0, 0, 0, 0.9)')
  g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  d.fillStyle = g
  d.fillRect(cx - r, cy - r, r * 2, r * 2)
}
