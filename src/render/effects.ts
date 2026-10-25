// Visual effects layered over the map. Purely for looks: they read the sim and
// remember a little of their own (marks, ripples, ships), but never change the sim.
//
//   fight marks    hits and deaths leave splatters that fade: green acid where a
//                  Myrr was hit, dark red blood where a human was
//   burn scars     incendiaries and flamethrowers leave scorched patches that
//                  fade slowly (as if the resin grows back over them)
//   resin glints   a few pixels on the resin catch the light now and then
//   screech rings  a ring spreads out where a Myrr screeches for a swarm
//   ships          the drop ship and the evacuation ship come down onto the
//                  Landing Pad, wait, and lift off again
//   darkness       it is always night on the surface, and the Upper and Deep
//                  Mines are dark: light comes only from soldiers' flashlight
//                  beams, glows around people, flares, muzzle flashes and the
//                  ships' landing lights (the Myrr get a faint glow so they can
//                  still be watched). Purely visual: the sim's own lighting
//                  (how far people see) is unchanged.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import type { Agent } from '../agents/agent.ts'
import { isFree } from '../agents/civilian.ts'
import { findRooms } from '../world/rooms.ts'
import { drawSprite } from './sprites.ts'

const TPS = CONFIG.sim.ticksPerSecond
const E = {
  /** Fight marks fade out over this many sim seconds; burn scars last scarSeconds. At most maxMarks are kept. */
  markSeconds: 180,
  scarSeconds: 600,
  maxMarks: 500,
  acid: '120, 200, 60',
  blood: '120, 20, 24',
  scorch: '22, 14, 10',
  /** Darkness: the surface (always night) and the mine levels. */
  surfaceDark: 0.45,
  mineDark: 0.55,
  /** Flashlight cone length and half-width (tiles, radians); glows around people and Myrr (tiles). */
  beamTiles: 7,
  beamWidth: 0.55,
  glowTiles: 1.6,
  myrrGlowTiles: 0.9,
  /** Muzzle flashes light this many tiles around the shooter. */
  flashTiles: 2.2,
  /** A screech ring spreads to the screech's hearing range over this many sim seconds. */
  ringSeconds: 1.5,
  /** Ships take this long to come down or lift off, and the drop ship waits this long before leaving (sim seconds). */
  shipMoveSeconds: 8,
  dropShipWaitSeconds: 15,
  /** The ship is drawn this many tiles wide. */
  shipTiles: 3,
}

interface Mark { levelIndex: number; x: number; y: number; tick: number; rgb: string; size: number; seed: number; life: number }
interface Ring { levelIndex: number; x: number; y: number; tick: number }

export class Effects {
  private marks: Mark[] = []
  private rings: Ring[] = []
  private lastShotTick = -1
  private lastNoiseTick = -1
  private wasDead = new Set<number>()
  /** Last direction each agent moved in, for flashlight beams. */
  private facing = new Map<number, { dx: number; dy: number; x: number; y: number }>()
  /** Tick the drop ship is due, and the tick it landed (for drawing it). */
  private dropDue: number | null = null
  private dropLanded = -1e9
  private dark: HTMLCanvasElement = document.createElement('canvas')

  /** Collect new marks and rings, and follow the ships. Call once per frame. */
  update(sim: SimState): void {
    for (const s of sim.shots) {
      if (s.tick <= this.lastShotTick) continue
      if (s.burn) this.add(s.levelIndex, s.x1, s.y1, s.tick, E.scorch, 0.5 + s.burn * 0.45, E.scarSeconds)
      else if (s.flame) this.add(s.levelIndex, s.x1, s.y1, s.tick, E.scorch, 0.35, E.scarSeconds)
      else if (s.hit) this.add(s.levelIndex, s.x1, s.y1, s.tick, s.side === 'human' ? E.acid : E.blood, 0.18, E.markSeconds)
    }
    for (const s of sim.shots) this.lastShotTick = Math.max(this.lastShotTick, s.tick)
    for (const a of sim.agents) {
      if (!a.dead || this.wasDead.has(a.id)) continue
      this.wasDead.add(a.id)
      if (a.kind !== 'turret') this.add(a.levelIndex, a.x, a.y, sim.tick, a.side === 'myrr' ? E.acid : E.blood, 0.42, E.markSeconds)
    }
    for (const n of sim.noises) {
      if (n.tick <= this.lastNoiseTick) continue
      if (n.kind === 'screech') this.rings.push({ levelIndex: n.levelIndex, x: n.x, y: n.y, tick: n.tick })
    }
    for (const n of sim.noises) this.lastNoiseTick = Math.max(this.lastNoiseTick, n.tick)
    this.rings = this.rings.filter((r) => sim.tick - r.tick < E.ringSeconds * TPS)
    this.marks = this.marks.filter((m) => sim.tick - m.tick < m.life * TPS)
    if (this.marks.length > E.maxMarks) this.marks.splice(0, this.marks.length - E.maxMarks)
    // The drop ship has landed when its due tick passes (the sim clears it then).
    const due = sim.commander.reinforcementsDue
    if (due !== null) this.dropDue = due
    else if (this.dropDue !== null && sim.tick >= this.dropDue) { this.dropLanded = this.dropDue; this.dropDue = null }
  }

  private add(levelIndex: number, x: number, y: number, tick: number, rgb: string, size: number, life: number): void {
    this.marks.push({ levelIndex, x, y, tick, rgb, size, life, seed: Math.floor(Math.abs(x * 7919 + y * 104729) % 9973) })
  }

  /** Splatters and scorch marks under the agents, fading with age. */
  drawMarks(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    for (const m of this.marks) {
      if (m.levelIndex !== levelIndex) continue
      const alpha = (m.rgb === E.scorch ? 0.6 : 0.55) * (1 - (sim.tick - m.tick) / (m.life * TPS))
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

  /** Spreading rings where Myrr screeched. */
  drawRings(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    const range = CONFIG.noise.radius.screech
    for (const r of this.rings) {
      if (r.levelIndex !== levelIndex) continue
      const t = (sim.tick - r.tick) / (E.ringSeconds * TPS)
      ctx.beginPath()
      ctx.arc(ox + r.x * tile, oy + r.y * tile, Math.max(1, t * range * tile), 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255, 90, 70, ${0.7 * (1 - t)})`
      ctx.lineWidth = Math.max(1, tile * 0.15)
      ctx.stroke()
    }
  }

  /** Muzzle flashes: a bright dot at the shooter for each recent gunshot. */
  drawMuzzleFlashes(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    for (const s of sim.shots) {
      if (s.levelIndex !== levelIndex || !s.ranged || s.tick < sim.tick - 1) continue
      ctx.fillStyle = s.flame ? 'rgba(255, 150, 40, 0.9)' : 'rgba(255, 240, 170, 0.95)'
      ctx.beginPath()
      ctx.arc(ox + s.x0 * tile, oy + s.y0 * tile, tile * (s.flame ? 0.35 : 0.22), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** The ship on the Landing Pad, and how high it is (0 landed, 1 out of sight), or null if there is none. */
  private ship(sim: SimState): { x: number; y: number; height: number } | null {
    const pad = findRooms(sim.world, ['other'], 0).find((r) => r.room.name === 'Landing Pad')
    if (!pad) return null
    const move = E.shipMoveSeconds * TPS
    const c = sim.commander
    const at = (height: number) => ({ x: pad.room.centerX + 0.5, y: pad.room.centerY + 0.5, height: Math.max(0, Math.min(1, height)) })
    // The evacuation ship: coming down, waiting, lifting off.
    if (c.evacuation === 'called' && sim.tick > c.shipLands - move) return at((c.shipLands - sim.tick) / move)
    if (c.evacuation === 'landed') return at(0)
    if (c.evacuation === 'gone' && sim.tick < c.shipLeaves + move) return at((sim.tick - c.shipLeaves) / move)
    // The drop ship.
    if (this.dropDue !== null && sim.tick > this.dropDue - move) return at((this.dropDue - sim.tick) / move)
    const leaves = this.dropLanded + E.dropShipWaitSeconds * TPS
    if (sim.tick >= this.dropLanded && sim.tick < leaves + move) return at((sim.tick - leaves) / move)
    return null
  }

  /** The ship: its shadow on the pad, and the ship itself, bigger and offset while high up. */
  drawShip(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
    const ship = levelIndex === 0 ? this.ship(sim) : null
    if (!ship || ship.height >= 1) return
    const size = E.shipTiles * tile
    const cx = ox + ship.x * tile, cy = oy + ship.y * tile
    ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * (1 - ship.height)})`
    ctx.beginPath()
    ctx.ellipse(cx, cy, size * 0.45, size * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
    const scale = 1 + ship.height * 0.6, lift = ship.height * tile * 4
    ctx.globalAlpha = 1 - ship.height * 0.5
    drawSprite(ctx, 'ship', cx - (size * scale) / 2, cy - (size * scale) / 2 - lift, size * scale, size * scale)
    ctx.globalAlpha = 1
  }

  /**
   * Darkness over the level, with holes cut for light (beams, glows, flares,
   * muzzle flashes, the ship). Drawn over the agents.
   */
  drawDarkness(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number, w: number, h: number): void {
    this.trackFacing(sim)
    const level = sim.world.levels[levelIndex]
    const alpha = levelIndex === 0 ? E.surfaceDark : E.mineDark

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
        if ((a.soldier || a.kind === 'commander') && isFree(a)) this.drawBeam(d, a, cx, cy, tile)
      } else {
        glow(d, cx, cy, E.myrrGlowTiles * tile * (a.kind === 'brood-mother' ? 2.5 : 1))
      }
    }
    for (const f of level.flares) glow(d, ox + f.x * tile, oy + f.y * tile, CONFIG.flares.radius * tile)
    for (const s of sim.shots) {
      if (s.levelIndex === levelIndex && s.ranged && s.tick >= sim.tick - 1) glow(d, ox + s.x0 * tile, oy + s.y0 * tile, E.flashTiles * tile * (s.flame ? 1.5 : 1))
    }
    const ship = levelIndex === 0 ? this.ship(sim) : null
    if (ship && ship.height < 1) glow(d, ox + ship.x * tile, oy + ship.y * tile, E.shipTiles * 1.6 * tile * (1 - ship.height * 0.5))
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
