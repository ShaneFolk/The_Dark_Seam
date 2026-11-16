// Power: the surface generators. While at least one works, the colony has power:
// turrets fire, the med bay cures, and Levels 1 and 2 are lit. Takers can
// sabotage generators. A generator knocked out stays down until it is fully
// repaired, by the colony's engineers (a few of the techs), a small crew at a time.
// Darkness halves human sight.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import { centreTile, findRooms, type RoomRef } from '../world/rooms.ts'
import type { PathNode } from '../world/pathfinding.ts'

export interface Generator {
  room: RoomRef
  /** The machine itself: the tile at the room's centre. */
  at: PathNode
  health: number
  maxHealth: number
  /** Knocked out: no power from it until it's repaired to full health. */
  broken: boolean
  /** Knocked out by the hive, and no engineer has come to fix it yet (the hive learns from this). */
  sabotaged: boolean
  /** The squad covering its repair, or -1. */
  coverSquad: number
  /** Switched off by the player (not damage: engineers leave it alone). */
  switchedOff: boolean
}

export interface PowerState {
  generators: Generator[]
}

export function createPower(world: World): PowerState {
  const generators = findRooms(world, ['generator']).map((room) => {
    const at = centreTile(world, room)
    return { room, at, health: CONFIG.power.generatorHp, maxHealth: CONFIG.power.generatorHp, broken: false, sabotaged: false, coverSquad: -1, switchedOff: false }
  })
  return { generators }
}

export function hasPower(power: PowerState): boolean {
  return power.generators.some((g) => !g.broken && !g.switchedOff)
}

/** Damage a generator; at zero it's knocked out until fully repaired. */
export function damageGenerator(gen: Generator, amount: number): void {
  gen.health = Math.max(0, gen.health - amount)
  if (gen.health <= 0 && !gen.broken) { gen.broken = true; gen.sabotaged = true }
}

/** Repair a generator a little; back to full, it works again. */
export function repairGenerator(gen: Generator, amount: number): void {
  gen.health = Math.min(gen.maxHealth, gen.health + amount)
  if (gen.health >= gen.maxHealth) { gen.broken = false; gen.coverSquad = -1 }
}

/** Is this level lit right now? */
export function isLit(power: PowerState, levelIndex: number): boolean {
  return (CONFIG.power.litLevels as readonly number[]).includes(levelIndex) && hasPower(power)
}

/** How far humans see on this level (halved in the dark). */
export function humanSight(power: PowerState, levelIndex: number): number {
  const base = CONFIG.perception.sightRange
  return isLit(power, levelIndex) ? base : base * CONFIG.power.darkSightMultiplier
}

/** A generator that's damaged (for techs to repair), nearest first. */
export function damagedGenerators(power: PowerState): Generator[] {
  return power.generators.filter((g) => g.health < g.maxHealth)
}
