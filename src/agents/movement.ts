// Moves an agent one tick along its path, including crossing links between levels.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import { speedFactor } from '../world/pathfinding.ts'
import { otherEnd } from '../world/links.ts'
import type { Agent } from './agent.ts'

const SECONDS_PER_TICK = 1 / CONFIG.sim.ticksPerSecond

/** Advance one tick. Returns true when the path is finished. */
export function followPath(agent: Agent, world: World): boolean {
  if (agent.state.name === 'crossing') {
    agent.state.ticksLeft--
    if (agent.state.ticksLeft > 0) return false
    const to = agent.state.to
    agent.levelIndex = to.levelIndex
    agent.x = to.x + 0.5
    agent.y = to.y + 0.5
    agent.state = { name: 'moving' }
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
      agent.state = { name: 'crossing', ticksLeft: Math.max(1, Math.round(seconds / SECONDS_PER_TICK)), to: next }
      return false
    }

    const level = world.levels[agent.levelIndex]
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
