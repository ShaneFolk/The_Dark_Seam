// How each agent kind is drawn with the sprite sheet (the Art Pass). The other
// mapping, agentArt.ts, draws them as coloured dots; press G to switch.
//
// People who are stung, carried or held are drawn lying down; a coloured pip
// over a civilian's head shows when they are hiding, fleeing or panicking.
// Moving Myrr swap between two frames, so their legs scuttle.

import type { Agent, AgentKind } from '../agents/agent.ts'
import type { SpriteName } from './spriteRects.ts'
import { drawSprite } from './sprites.ts'
import { isMoving } from '../agents/movement.ts'

/** Milliseconds per walk frame. */
const FRAME_MS = 140

/** The walk frame to show: the second one every other step while moving (ids offset so they don't all step together). */
function walkFrame(agent: Agent, name: 'taker' | 'spineback' | 'broodling'): SpriteName {
  if (!isMoving(agent) && agent.state.name !== 'crossing') return name
  return (Math.floor(performance.now() / FRAME_MS) + agent.id) % 2 ? `${name}_1` as SpriteName : name
}
import { CIVILIAN_MODE_COLORS, type AgentDraw } from './agentArt.ts'

/** A 16x16 sprite standing on the agent's spot (a little above centre, so feet sit on the tile). */
function stand(ctx: CanvasRenderingContext2D, name: SpriteName, cx: number, cy: number, tile: number): void {
  drawSprite(ctx, name, cx - tile / 2, cy - tile * 0.6, tile, tile)
}

/** Draw a person: their sprite, or lying down / a cocoon, plus a mode pip. */
function person(ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number, agent: Agent, upright: SpriteName): void {
  const mode = agent.civ?.mode ?? 'routine'
  if (mode === 'dead' || mode === 'evacuated') return
  if (mode === 'cocooned') return stand(ctx, 'cocoon', cx, cy, tile)
  if (mode === 'paralyzed' || mode === 'captured' || mode === 'captive') return drawSprite(ctx, 'human_down', cx - tile / 2, cy - tile / 2, tile, tile)
  stand(ctx, upright, cx, cy, tile)
  if (mode === 'hide' || mode === 'flee' || mode === 'panic') {
    ctx.beginPath()
    ctx.arc(cx, cy - tile * 0.75, Math.max(1.5, tile * 0.12), 0, Math.PI * 2)
    ctx.fillStyle = CIVILIAN_MODE_COLORS[mode]
    ctx.fill()
  }
}

function civilianSprite(agent: Agent): SpriteName {
  const job = agent.civ?.job
  const kind = job === 'miner' || job === 'tech' ? job : 'staff'
  if (agent.weapon?.kind === 'torch') return 'civ_miner_torch'
  return (agent.weapon?.kind === 'pistol' ? `civ_${kind}_armed` : `civ_${kind}`) as SpriteName
}

const myrr = (name: 'taker' | 'spineback' | 'broodling'): AgentDraw => (ctx, cx, cy, tile, agent) => stand(ctx, walkFrame(agent, name), cx, cy, tile)

export const AGENT_SPRITES: Record<AgentKind, AgentDraw> = {
  civilian: (ctx, cx, cy, tile, agent) => person(ctx, cx, cy, tile, agent, civilianSprite(agent)),
  soldier: (ctx, cx, cy, tile, agent) => person(ctx, cx, cy, tile, agent, 'soldier'),
  medic: (ctx, cx, cy, tile, agent) => person(ctx, cx, cy, tile, agent, 'medic'),
  commander: (ctx, cx, cy, tile, agent) => person(ctx, cx, cy, tile, agent, 'commander'),
  turret: (ctx, cx, cy, tile, agent) => {
    stand(ctx, 'turret', cx, cy, tile)
    // Ammo bar underneath.
    const w = agent.weapon
    if (w) {
      ctx.fillStyle = '#ffd24a'
      ctx.fillRect(cx - tile * 0.35, cy + tile * 0.42, tile * 0.7 * (w.inMag / 120), Math.max(1, tile * 0.08))
    }
  },
  taker: (ctx, cx, cy, tile, agent) => {
    stand(ctx, walkFrame(agent, 'taker'), cx, cy, tile)
    // A white ring while carrying someone (or a cocoon).
    if (agent.myrr?.task === 'carry' || agent.myrr?.task === 'haulCarry') {
      ctx.beginPath()
      ctx.arc(cx, cy, tile * 0.6, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(242, 242, 242, 0.8)'
      ctx.lineWidth = Math.max(1, tile * 0.08)
      ctx.stroke()
    }
  },
  spineback: myrr('spineback'),
  broodling: myrr('broodling'),
  'brood-mother': (ctx, cx, cy, tile) => drawSprite(ctx, 'brood_mother', cx - tile, cy - tile * 1.2, tile * 2, tile * 2),
  'wanderer-myrr': myrr('taker'),
}
