// Colony time of day, worked out from the sim tick.

import { CONFIG } from '../config.ts'

const TICKS_PER_HOUR = (CONFIG.clock.dayLengthMinutes * 60 * CONFIG.sim.ticksPerSecond) / 24

/** Hours since day 1 00:00 (fractional). */
export function colonyHours(tick: number): number {
  return CONFIG.clock.startHour + tick / TICKS_PER_HOUR
}

/** Hour of the day, 0 to 24 (fractional). */
export function hourOfDay(tick: number): number {
  return colonyHours(tick) % 24
}

/** e.g. "Day 1 · 07:30" */
export function formatClock(tick: number): string {
  const total = colonyHours(tick)
  const day = Math.floor(total / 24) + 1
  const h = Math.floor(total % 24)
  const m = Math.floor((total % 1) * 60)
  return `Day ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
