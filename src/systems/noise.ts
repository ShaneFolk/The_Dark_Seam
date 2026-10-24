// Noises: short-lived sound events that nearby agents can hear.

import { CONFIG } from '../config.ts'

export type NoiseKind = keyof typeof CONFIG.noise.radius

export interface Noise {
  kind: NoiseKind
  levelIndex: number
  x: number
  y: number
  radius: number
  tick: number
  /** Agent that made it (so nobody is scared by their own scream), or -1. */
  sourceId: number
}

/** Noises are kept this many ticks, then dropped. */
const KEEP_TICKS = CONFIG.sim.ticksPerSecond

export function makeNoise(noises: Noise[], kind: NoiseKind, levelIndex: number, x: number, y: number, tick: number, sourceId = -1): void {
  noises.push({ kind, levelIndex, x, y, radius: CONFIG.noise.radius[kind], tick, sourceId })
}

export function pruneNoises(noises: Noise[], tick: number): void {
  let keep = 0
  for (const n of noises) if (tick - n.tick < KEEP_TICKS) noises[keep++] = n
  noises.length = keep
}
