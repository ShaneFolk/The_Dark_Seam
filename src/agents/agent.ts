// The base agent: anything that moves around the map.

import type { PathNode, Side } from '../world/pathfinding.ts'
import type { CivilianData } from './civilian.ts'
import type { MyrrData } from './myrr.ts'
import type { WeaponState } from './combat.ts'
import type { SoldierData } from './soldier.ts'

/** What an agent looks like. The renderer maps each kind to a drawing. */
export type AgentKind = 'civilian' | 'soldier' | 'medic' | 'turret' | 'taker' | 'spineback' | 'broodling' | 'brood-mother' | 'wanderer-myrr' | 'commander'

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
  health: number
  maxHealth: number
  /** Killed (or, for humans, hatched). Dead agents stay in the list but do nothing. */
  dead: boolean
  /** Ticks spent breaking the obstacle in front of it (for noise timing). */
  breakTicks?: number
  /** Id of the Myrr holding this agent in its claws, or -1. */
  heldBy: number
  /** What it fights with, if anything. */
  weapon?: WeaponState
  /** Remaining steps of the current path (first = next step). */
  path: PathNode[]
  state: AgentState
  /** Civilian-only data (job, routine, fear). */
  civ?: CivilianData
  /** Myrr-only data (role and current task). */
  myrr?: MyrrData
  /** Soldier-only data (squad and role). */
  soldier?: SoldierData
  /** Myrr: ticks spent holding still (see camouflage.ts). */
  stillTicks: number
  /** Myrr: ticks left in which an attack still counts as striking from hiding. */
  ambushTicks: number
}

export function createAgent(id: number, kind: AgentKind, side: Side, at: PathNode, speed: number, health = 100): Agent {
  return {
    id,
    kind,
    side,
    levelIndex: at.levelIndex,
    x: at.x + 0.5,
    y: at.y + 0.5,
    speed,
    baseSpeed: speed,
    health,
    maxHealth: health,
    dead: false,
    heldBy: -1,
    stillTicks: 0,
    ambushTicks: 0,
    path: [],
    state: { name: 'idle', ticksLeft: 0 },
  }
}

export function tileOf(agent: Agent): PathNode {
  return { levelIndex: agent.levelIndex, x: Math.floor(agent.x), y: Math.floor(agent.y) }
}
