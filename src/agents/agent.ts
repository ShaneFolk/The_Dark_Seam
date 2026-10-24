// The base agent: anything that moves around the map.

import type { PathNode, Side } from '../world/pathfinding.ts'
import type { CivilianData } from './civilian.ts'

/** What an agent looks like. The renderer maps each kind to a drawing. */
export type AgentKind = 'civilian' | 'wanderer-myrr'

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
  /** Current speed in tiles per second. */
  speed: number
  /** Normal walking speed; `speed` changes when running. */
  baseSpeed: number
  /** Remaining steps of the current path (first = next step). */
  path: PathNode[]
  state: AgentState
  /** Civilian-only data (job, routine, fear). */
  civ?: CivilianData
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
    baseSpeed: speed,
    path: [],
    state: { name: 'idle', ticksLeft: 0 },
  }
}

export function tileOf(agent: Agent): PathNode {
  return { levelIndex: agent.levelIndex, x: Math.floor(agent.x), y: Math.floor(agent.y) }
}
