// Camouflage: Myrr holding still on resin blend into it.
//
// After holding still on resin for a while (CONFIG.camouflage.hideSeconds) a Myrr is
// hidden: humans only spot it from very close. Moving, attacking or getting hurt
// starts the count again. A Myrr that strikes from hiding gets an ambush bonus on
// that first blow. The Brood Mother is too big to hide; her chamber walls do that.
// A lit flare (soldiers carry a few) shows up anything hiding near it.

import { CONFIG } from '../config.ts'
import type { Agent } from '../agents/agent.ts'
import type { Level } from '../world/level.ts'
import { isMoving } from '../agents/movement.ts'

const TPS = CONFIG.sim.ticksPerSecond
const HIDE_TICKS = Math.round(CONFIG.camouflage.hideSeconds * TPS)
const AMBUSH_TICKS = Math.round(CONFIG.camouflage.ambushWindowSeconds * TPS)

/** Is this Myrr hidden right now (held still on resin long enough)? */
export function isHidden(agent: Agent, level: Level): boolean {
  if (agent.side !== 'myrr' || agent.kind === 'brood-mother' || agent.stillTicks < HIDE_TICKS) return false
  if (level.resin[Math.floor(agent.y) * level.width + Math.floor(agent.x)] <= 0) return false
  return !level.flares.some((f) => Math.hypot(f.x - agent.x, f.y - agent.y) <= CONFIG.flares.radius)
}

/** Light a flare at a spot. */
export function lightFlare(level: Level, x: number, y: number, tick: number): void {
  level.flares.push({ x, y, untilTick: tick + Math.round(CONFIG.flares.burnSeconds * TPS) })
}

/** Drop flares that have burned out. Once a tick. */
export function pruneFlares(level: Level, tick: number): void {
  if (level.flares.length) level.flares = level.flares.filter((f) => f.untilTick > tick)
}

/** Give a Myrr away: it has to hold still all over again to hide. */
export function reveal(agent: Agent): void {
  if (agent.side === 'myrr') agent.stillTicks = 0
}

/** Called every tick for each Myrr. */
export function updateCamouflage(agent: Agent, level: Level): void {
  if (isHidden(agent, level)) agent.ambushTicks = AMBUSH_TICKS
  else if (agent.ambushTicks > 0) agent.ambushTicks--
  if (isMoving(agent)) agent.stillTicks = 0
  else if (agent.stillTicks < HIDE_TICKS) agent.stillTicks++
}

/** Is this attack an ambush? Uses it up: only the first blow counts. */
export function takeAmbush(agent: Agent): boolean {
  const ready = agent.ambushTicks > 0
  agent.ambushTicks = 0
  return ready
}
