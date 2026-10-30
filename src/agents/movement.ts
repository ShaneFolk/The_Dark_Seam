// Moves an agent one tick along its path, including crossing links between levels.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import { speedFactor } from '../world/pathfinding.ts'
import { otherEnd, type LinkKind } from '../world/links.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { Tile } from '../world/tiles.ts'
import { breakRate, hitObstacle, isObstacle } from '../systems/barriers.ts'
import type { Agent } from './agent.ts'

const SECONDS_PER_TICK = 1 / CONFIG.sim.ticksPerSecond
const TPS = CONFIG.sim.ticksPerSecond

/** Hooks the sim sets each tick so movement can make noise (breaking things, riding the elevator) and the hive can notice arrivals. */
export const movementHooks: {
  onBreak?: (agent: Agent, kind: 'smash' | 'chew') => void
  /** Every tick of a ride or climb between levels. */
  onRide?: (agent: Agent, kind: LinkKind | null, from: PathNode, to: PathNode, ticksLeft: number) => void
  /** Just arrived on the new level. */
  onArrive?: (agent: Agent, kind: LinkKind | null, from: PathNode, to: PathNode) => void
} = {}

/** Advance one tick. Returns true when the path is finished. */
/** Actually on the move (some agents keep the 'moving' state after arriving). */
export function isMoving(agent: Agent): boolean {
  return agent.state.name === 'crossing' || (agent.state.name === 'moving' && agent.path.length > 0)
}

export function followPath(agent: Agent, world: World): boolean {
  if (agent.state.name === 'crossing') {
    const ride = agent.state
    ride.ticksLeft--
    movementHooks.onRide?.(agent, ride.kind, ride.from, ride.to, ride.ticksLeft)
    if (ride.ticksLeft > 0) return false
    const to = ride.to
    agent.levelIndex = to.levelIndex
    agent.x = to.x + 0.5
    agent.y = to.y + 0.5
    agent.state = { name: 'moving' }
    movementHooks.onArrive?.(agent, ride.kind, ride.from, to)
    return agent.path.length === 0
  }

  let budget = agent.speed * SECONDS_PER_TICK // tiles we may move this tick
  while (budget > 0 && agent.path.length) {
    const next = agent.path[0]

    // A step onto another level means taking the link we're standing on.
    if (next.levelIndex !== agent.levelIndex) {
      agent.path.shift()
      const level = world.levels[agent.levelIndex]
      const link = level.linksAt.get(next.y * level.width + next.x)?.find((l) => {
        const end = otherEnd(l, level.id)
        return world.levels[next.levelIndex].id === end.level
      })
      const seconds = link ? CONFIG.movement.linkSeconds[link.kind] : 0
      const from = { levelIndex: agent.levelIndex, x: next.x, y: next.y }
      agent.state = { name: 'crossing', ticksLeft: Math.max(1, Math.round(seconds / SECONDS_PER_TICK)), to: next, from, kind: link?.kind ?? null }
      return false
    }

    const level = world.levels[agent.levelIndex]
    // Something in the way (barricade, weld, window, wall): break it, or take it down.
    const ni = next.y * level.width + next.x
    if (isObstacle(level, ni, agent.side, true)) {
      const kind = level.tiles[ni] === Tile.BuildingWall && level.barrier[ni] <= 0 ? 'chew' : 'smash'
      if (agent.side === 'myrr') agent.breakTicks = (agent.breakTicks ?? 0) + 1
      if (agent.side === 'myrr' && agent.breakTicks! % Math.round(CONFIG.barriers.noiseEverySeconds * TPS) === 1) movementHooks.onBreak?.(agent, kind)
      hitObstacle(level, ni, breakRate(level, ni, agent.side) / TPS)
      return false
    }
    agent.breakTicks = 0
    const factor = speedFactor(level, Math.floor(agent.y) * level.width + Math.floor(agent.x), agent.side)
    const tx = next.x + 0.5, ty = next.y + 0.5
    const dx = tx - agent.x, dy = ty - agent.y
    const dist = Math.hypot(dx, dy)
    const reach = budget * factor
    if (dist <= reach) {
      agent.x = tx
      agent.y = ty
      agent.path.shift()
      budget -= dist / factor
    } else {
      agent.x += (dx / dist) * reach
      agent.y += (dy / dist) * reach
      budget = 0
    }
  }
  return agent.path.length === 0
}
