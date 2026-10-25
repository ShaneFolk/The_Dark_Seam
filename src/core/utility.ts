// Utility scoring: pick an action by giving every option a score from 0 to 1.
//
// Instead of a fixed if/else list ("if cocoons >= 5, attack"), each option adds up
// what the agent knows into one number. A Taker scores "scout" high when the hive
// is hungry, "sabotage" higher the more Myrr the guns have killed, and so on.
// Changing one factor shifts the choice a little instead of flipping it.
//
// choose() picks the best option outright; pickWeighted() picks at random, with
// better options more likely (score ^ sharpness), so runs don't all go the same way.

import type { Rng } from './rng.ts'

export interface Option<T> {
  action: T
  score: number
  /** Short reason, shown in the agent's description. */
  why?: string
}

/** 0 at or below `lo`, 1 at or above `hi`, a straight line between. */
export function ramp(x: number, lo: number, hi: number): number {
  if (hi === lo) return x >= hi ? 1 : 0
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
}

/** The highest-scoring option (the first one on a tie), or null if none score above 0. */
export function choose<T>(options: Option<T>[]): Option<T> | null {
  let best: Option<T> | null = null
  for (const o of options) if (o.score > 0 && (!best || o.score > best.score)) best = o
  return best
}

/** A random option, weighted by score ^ sharpness (higher sharpness = the best wins more often). */
export function pickWeighted<T>(options: Option<T>[], rng: Rng, sharpness: number): Option<T> | null {
  const weights = options.map((o) => (o.score > 0 ? Math.pow(o.score, sharpness) : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  let roll = rng.next() * total
  for (let i = 0; i < options.length; i++) if ((roll -= weights[i]) <= 0 && weights[i] > 0) return options[i]
  for (let i = options.length - 1; i >= 0; i--) if (weights[i] > 0) return options[i] // rounding left a sliver
  return null
}

/** "scout 0.71, spread 0.40" for logs and descriptions. */
export function scoreList<T extends string>(options: Option<T>[]): string {
  return options.filter((o) => o.score > 0).map((o) => `${o.action} ${o.score.toFixed(2)}`).join(', ')
}
