// Pheromones: scent maps the hive uses to share what it knows.
//
//   trail  laid where prey is seen or caught and along the route home; scouts follow it
//   alarm  laid where a Myrr is hurt or killed; Spinebacks answer it
//
// Each kind fades on its own clock. (Danger scent comes in Phase 6, Round C.)

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import type { PathNode } from '../world/pathfinding.ts'

export type ScentKind = 'trail' | 'alarm'

export type Pheromones = Record<ScentKind, Float32Array[]>

const HALF_LIFE: Record<ScentKind, number> = {
  trail: CONFIG.pheromones.halfLifeSeconds,
  alarm: CONFIG.pheromones.alarmHalfLifeSeconds,
}

export function createPheromones(world: World): Pheromones {
  const maps = () => world.levels.map((l) => new Float32Array(l.width * l.height))
  return { trail: maps(), alarm: maps() }
}

export function deposit(ph: Pheromones, kind: ScentKind, world: World, levelIndex: number, x: number, y: number, amount: number): void {
  const level = world.levels[levelIndex]
  const tx = Math.floor(x), ty = Math.floor(y)
  if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return
  ph[kind][levelIndex][ty * level.width + tx] += amount
}

export function depositTrail(ph: Pheromones, world: World, levelIndex: number, x: number, y: number, amount: number): void {
  deposit(ph, 'trail', world, levelIndex, x, y, amount)
}

/** Fade all scent. Call once per second. */
export function decayPheromones(ph: Pheromones): void {
  for (const kind of Object.keys(HALF_LIFE) as ScentKind[]) {
    const keep = Math.pow(0.5, 1 / HALF_LIFE[kind])
    for (const map of ph[kind]) {
      for (let i = 0; i < map.length; i++) {
        if (map[i] === 0) continue
        map[i] *= keep
        if (map[i] < 0.01) map[i] = 0
      }
    }
  }
}

/** The strongest spots of one scent across all levels, strongest first. */
export function strongest(ph: Pheromones, kind: ScentKind, world: World, count: number, min: number): { at: PathNode; strength: number }[] {
  const best: { at: PathNode; strength: number }[] = []
  ph[kind].forEach((map, levelIndex) => {
    const w = world.levels[levelIndex].width
    for (let i = 0; i < map.length; i++) {
      const s = map[i]
      if (s < min) continue
      if (best.length === count && s <= best[best.length - 1].strength) continue
      best.push({ at: { levelIndex, x: i % w, y: Math.floor(i / w) }, strength: s })
      best.sort((a, b) => b.strength - a.strength)
      if (best.length > count) best.pop()
    }
  })
  return best
}

/** The strongest trail spots (what scouts follow). */
export function strongestTrail(ph: Pheromones, world: World, count: number): { at: PathNode; strength: number }[] {
  return strongest(ph, 'trail', world, count, CONFIG.pheromones.minFollow)
}
