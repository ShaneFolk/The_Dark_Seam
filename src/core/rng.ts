// Seeded random number generator.
//
// Given the same seed, it always produces the same sequence of numbers,
// so a run can be replayed exactly. All sim code must use this instead
// of Math.random().
//
// Algorithm: mulberry32 — tiny, fast, and good enough for a game.

export class Rng {
  private state: number

  constructor(seed: number) {
    // Force to an unsigned 32-bit integer.
    this.state = seed >>> 0
  }

  /** Random float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Random integer in [min, max] (both inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** True with the given probability (0–1). */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }
}
