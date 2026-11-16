// The rescue chain, drawn on the map so it can be followed:
//   - a dashed green line from an escort squad's leader to the person it is walking out
//   - a ring over each known-infected person: it empties as their larva gets closer to hatching
//     (green, turning red near the end)
//   - in a med bay bed, a blue ring that fills as the cure runs (grey while the power is out)
// Reads the sim only.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import { knownInfected } from '../systems/medbay.ts'
import { hasPower } from '../systems/power.ts'
import { isFree } from '../agents/civilian.ts'

const TPS = CONFIG.sim.ticksPerSecond
const COLORS = { escort: 'rgba(120, 230, 140, 0.8)', back: 'rgba(0, 0, 0, 0.55)', safe: '#7be07b', late: '#ff5c4d', cure: '#5cb8ff', paused: '#8b949e' }

export function drawRescues(ctx: CanvasRenderingContext2D, sim: SimState, levelIndex: number, ox: number, oy: number, tile: number): void {
  // Escorts: leader → the person they're walking to the med bay.
  ctx.save()
  ctx.setLineDash([Math.max(3, tile * 0.3), Math.max(3, tile * 0.25)])
  ctx.lineWidth = Math.max(1.5, tile * 0.08)
  ctx.strokeStyle = COLORS.escort
  for (const squad of sim.squads) {
    const person = squad.escortId >= 0 ? sim.agents[squad.escortId] : null
    const leader = squad.members.map((id) => sim.agents[id]).find((m) => m && !m.dead && isFree(m))
    if (!person || !leader || person.dead || person.levelIndex !== levelIndex || leader.levelIndex !== levelIndex) continue
    ctx.beginPath()
    ctx.moveTo(ox + leader.x * tile, oy + leader.y * tile)
    ctx.lineTo(ox + person.x * tile, oy + person.y * tile)
    ctx.stroke()
  }
  ctx.restore()

  // Timers over known-infected people: hatching (shrinking) or curing (filling).
  const inBed = new Set(sim.medbays.flatMap((b) => b.beds))
  const powered = hasPower(sim.power)
  const r = Math.max(4, tile * 0.32)
  ctx.lineWidth = Math.max(2, tile * 0.1)
  for (const a of sim.agents) {
    if (a.levelIndex !== levelIndex || !knownInfected(a) || a.civ!.mode === 'cocooned') continue
    const civ = a.civ!
    const cx = ox + a.x * tile, cy = oy + a.y * tile - tile * 0.95
    const curing = inBed.has(a.id)
    const share = curing
      ? civ.cureTicks / (CONFIG.medbay.cureSeconds * TPS)
      : Math.max(0, civ.infection!.hatchTick - sim.tick) / (CONFIG.lifecycle.incubationSeconds * TPS)
    ctx.strokeStyle = COLORS.back
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = curing ? (powered ? COLORS.cure : COLORS.paused) : share < 0.25 ? COLORS.late : COLORS.safe
    ctx.beginPath()
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, share))
    ctx.stroke()
  }
}
