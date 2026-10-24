// The base agent: anything that moves around the map.

import type { PathNode, Side } from '../world/pathfinding.ts'

/** What an agent looks like. The renderer maps each kind to a drawing. */
export type AgentKind = 'wanderer-human' | 'wanderer-myrr'

export type AgentState =
  | { name: 'idle'; ticksLeft: number }
  | { name: 'moving' }
  /** Climbing / riding a link; arrives on the next level when ticksLeft hits 0. */
  | { name: 'crossing'; ticksLeft: number; to: PathNode }

export interface Agent {
  id: number
  kind: AgentKind
  side: Side
  /** Index into world.levels (0 = Level 1). */
  levelIndex: number
  /** Position in tiles. The tile is (floor(x), floor(y)); tile centres are at .5. */
  x: number
  y: number
  /** Base speed in tiles per second. */
  speed: number
  /** Remaining steps of the current path (first = next step). */
  path: PathNode[]
  state: AgentState
}

export function createAgent(id: number, kind: AgentKind, side: Side, at: PathNode, speed: number): Agent {
  return {
    id,
    kind,
    side,
    levelIndex: at.levelIndex,
    x: at.x + 0.5,
    y: at.y + 0.5,
    speed,
    path: [],
    state: { name: 'idle', ticksLeft: 0 },
  }
}

export function tileOf(agent: Agent): PathNode {
  return { levelIndex: agent.levelIndex, x: Math.floor(agent.x), y: Math.floor(agent.y) }
}
