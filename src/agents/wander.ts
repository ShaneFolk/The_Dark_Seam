// Test behaviour for Phase 2: rest, pick a random reachable spot (sometimes on
// another level), walk there, repeat. A tiny state machine: idle → moving → idle.

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import { canWalk, findPath, type PathNode } from '../world/pathfinding.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'

const TICKS_PER_SECOND = CONFIG.sim.ticksPerSecond

export function updateWanderer(agent: Agent, world: World, rng: Rng): void {
  const state = agent.state
  if (state.name === 'idle') {
    if (--state.ticksLeft > 0) return
    const target = randomDestination(agent, world, rng)
    const path = target && findPath(world, tileOf(agent), target, agent.side)
    if (path && path.length) {
      agent.path = path
      agent.state = { name: 'moving' }
    } else {
      agent.state = { name: 'idle', ticksLeft: TICKS_PER_SECOND } // try again in a second
    }
    return
  }

  if (followPath(agent, world)) {
    const [min, max] = CONFIG.wanderers.pauseSeconds
    agent.state = { name: 'idle', ticksLeft: Math.round((min + rng.next() * (max - min)) * TICKS_PER_SECOND) }
  }
}

/** A random walkable tile, on this level or (sometimes) another one. */
export function randomDestination(agent: Agent, world: World, rng: Rng): PathNode | null {
  const levelIndex = rng.chance(CONFIG.wanderers.otherLevelChance)
    ? rng.int(0, world.levels.length - 1)
    : agent.levelIndex
  return randomWalkableTile(world, levelIndex, agent.side, rng)
}

export function randomWalkableTile(world: World, levelIndex: number, side: Agent['side'], rng: Rng): PathNode | null {
  const level = world.levels[levelIndex]
  for (let tries = 0; tries < 200; tries++) {
    const x = rng.int(0, level.width - 1), y = rng.int(0, level.height - 1)
    if (canWalk(level, x, y, side)) return { levelIndex, x, y }
  }
  return null
}
