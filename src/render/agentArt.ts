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
}

export const AGENT_ART: Record<AgentKind, AgentDraw> = {
  civilian: (ctx, cx, cy, tile, agent) => {
    const mode = agent.civ?.mode ?? 'routine'
    dot(ctx, cx, cy, tile * 0.32, CIVILIAN_MODE_COLORS[mode], '#0b2540', tile)
  },
  'wanderer-myrr': (ctx, cx, cy, tile) => dot(ctx, cx, cy, tile * 0.36, '#e0533d', '#3a0d06', tile),
}
