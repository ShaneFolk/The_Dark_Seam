// Pheromones: scent maps the hive uses to share what it knows.
// Phase 4 has the trail scent: laid where prey is seen or caught and along the
// route home, followed by scouts, fading over time. Danger and alarm come in Phase 6.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import type { PathNode } from '../world/pathfinding.ts'

export interface Pheromones {
  /** Trail scent per level, one value per tile. */
  trail: Float32Array[]
}

export function createPheromones(world: World): Pheromones {
  return { trail: world.levels.map((l) => new Float32Array(l.width * l.height)) }
}

export function depositTrail(ph: Pheromones, world: World, levelIndex: number, x: number, y: number, amount: number): void {
  const level = world.levels[levelIndex]
  const tx = Math.floor(x), ty = Math.floor(y)
  if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return
  ph.trail[levelIndex][ty * level.width + tx] += amount
}

/** Fade all scent. Call once per second. */
export function decayPheromones(ph: Pheromones): void {
  const keep = Math.pow(0.5, 1 / CONFIG.pheromones.halfLifeSeconds)
  for (const map of ph.trail) {
    for (let i = 0; i < map.length; i++) {
      if (map[i] === 0) continue
      map[i] *= keep
      if (map[i] < 0.01) map[i] = 0
    }
  }
}

/** The strongest scent spots across all levels, strongest first. */
export function strongestTrail(ph: Pheromones, world: World, count: number): { at: PathNode; strength: number }[] {
  const best: { at: PathNode; strength: number }[] = []
  ph.trail.forEach((map, levelIndex) => {
    const w = world.levels[levelIndex].width
    for (let i = 0; i < map.length; i++) {
      const s = map[i]
      if (s < CONFIG.pheromones.minFollow) continue
      if (best.length === count && s <= best[best.length - 1].strength) continue
      best.push({ at: { levelIndex, x: i % w, y: Math.floor(i / w) }, strength: s })
      best.sort((a, b) => b.strength - a.strength)
      if (best.length > count) best.pop()
    }
  })
  return best
}
