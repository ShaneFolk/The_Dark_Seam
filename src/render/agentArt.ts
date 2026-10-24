// How each agent kind is drawn. Like tileArt.ts, this is the one mapping the
// Art Pass replaces with sprites.

import type { Agent, AgentKind } from '../agents/agent.ts'
import type { Mode } from '../agents/civilian.ts'

/** Draws one agent centred at (cx, cy); `tile` is the on-screen tile size. */
export type AgentDraw = (ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number, agent: Agent) => void

function dot(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, outline: string, tile: number): void {
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = Math.max(1, tile * 0.08)
  ctx.strokeStyle = outline
  ctx.stroke()
}

/** Civilian colour shows their mode at a glance. */
export const CIVILIAN_MODE_COLORS: Record<Mode, string> = {
  routine: '#5ab0ff',
  hide: '#8fa3b8',
  flee: '#ffb347',
  panic: '#ff5ce1',
  paralyzed: '#e8f6ff',
  captured: '#f2f2f2',
  captive: '#b18bd1',
  cocooned: '#b18bd1',
  dead: '#000000',
}

export const AGENT_ART: Record<AgentKind, AgentDraw> = {
  civilian: (ctx, cx, cy, tile, agent) => {
    const mode = agent.civ?.mode ?? 'routine'
    if (mode === 'dead') return
    if (mode === 'cocooned') {
      // An upright purple oval stuck to the hive wall.
      ctx.beginPath()
      ctx.ellipse(cx, cy, tile * 0.32, tile * 0.48, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#7d5a9e'
      ctx.fill()
      ctx.lineWidth = Math.max(1, tile * 0.08)
      ctx.strokeStyle = '#2a1838'
      ctx.stroke()
      return
    }
    dot(ctx, cx, cy, tile * 0.32, CIVILIAN_MODE_COLORS[mode], '#0b2540', tile)
  },
  soldier: (ctx, cx, cy, tile, agent) => {
    const mode = agent.civ?.mode ?? 'routine'
    dot(ctx, cx, cy, tile * 0.34, mode === 'routine' ? '#4caf50' : CIVILIAN_MODE_COLORS[mode], '#0d2b0f', tile)
  },
  medic: (ctx, cx, cy, tile, agent) => {
    const mode = agent.civ?.mode ?? 'routine'
    dot(ctx, cx, cy, tile * 0.34, mode === 'routine' ? '#e8f5e9' : CIVILIAN_MODE_COLORS[mode], '#0d2b0f', tile)
    ctx.fillStyle = '#2e7d32'
    ctx.fillRect(cx - tile * 0.05, cy - tile * 0.2, tile * 0.1, tile * 0.4)
    ctx.fillRect(cx - tile * 0.2, cy - tile * 0.05, tile * 0.4, tile * 0.1)
  },
  spineback: (ctx, cx, cy, tile) => dot(ctx, cx, cy, tile * 0.42, '#8f1d1d', '#ffcfb8', tile),
  broodling: (ctx, cx, cy, tile) => dot(ctx, cx, cy, tile * 0.2, '#e6d3b0', '#6e5a3c', tile),
  taker: (ctx, cx, cy, tile, agent) => {
    dot(ctx, cx, cy, tile * 0.36, '#e0533d', '#3a0d06', tile)
    // A white ring while carrying someone.
    if (agent.myrr?.task === 'carry') {
      ctx.beginPath()
      ctx.arc(cx, cy, tile * 0.55, 0, Math.PI * 2)
      ctx.strokeStyle = '#f2f2f2'
      ctx.lineWidth = Math.max(1, tile * 0.1)
      ctx.stroke()
    }
  },
  'brood-mother': (ctx, cx, cy, tile) => dot(ctx, cx, cy, tile * 0.9, '#e0559f', '#ffd76a', tile),
  'wanderer-myrr': (ctx, cx, cy, tile) => dot(ctx, cx, cy, tile * 0.36, '#e0533d', '#3a0d06', tile),
}
