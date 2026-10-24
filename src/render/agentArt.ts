// How each agent kind is drawn. Like tileArt.ts, this is the one mapping the
// Art Pass replaces with sprites.

import type { AgentKind } from '../agents/agent.ts'

/** Draws one agent centred at (cx, cy); `tile` is the on-screen tile size. */
export type AgentDraw = (ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number) => void

const dot = (fill: string, outline: string, scale: number): AgentDraw => (ctx, cx, cy, tile) => {
  const r = Math.max(2, tile * scale)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = Math.max(1, tile * 0.08)
  ctx.strokeStyle = outline
  ctx.stroke()
}

export const AGENT_ART: Record<AgentKind, AgentDraw> = {
  'wanderer-human': dot('#5ab0ff', '#0b2540', 0.32),
  'wanderer-myrr': dot('#e0533d', '#3a0d06', 0.36),
}
