// Batch mode: run many seeds headless (no screen) and report how they ended.
//
//   npm run batch                          seeds 1-20, up to 6 colony days each
//   npm run batch -- --seeds 1-50          a range of seeds
//   npm run batch -- --seeds 3,7,12        a list of seeds
//   npm run batch -- --days 3              stop runs that haven't ended after 3 days
//   npm run batch -- --set hive.spinebacks=6 --set commander.assault.minCocoons=3
//                                          try different tuning without editing config.ts
//   npm run batch -- --json results.json   also save every run's numbers to a file
//
// The sim never touches the screen, so it runs here exactly as it does in the
// browser: the same seed gives the same run.

import { writeFileSync } from 'node:fs'
import { CONFIG } from '../src/config.ts'
import { createSim, step } from '../src/sim.ts'
import { formatClock } from '../src/core/clock.ts'
import type { RunStats } from '../src/core/events.ts'

interface RunResult {
  seed: number
  ending: string
  /** Tick of the ending (or the cutoff). */
  tick: number
  stats: RunStats
  ms: number
}

// ---------- read the command line
const args = process.argv.slice(2)
let seeds: number[] = range(1, 20)
let maxDays = 6
let jsonPath: string | null = null
for (let i = 0; i < args.length; i++) {
  const a = args[i], v = args[i + 1]
  if (a === '--seeds') { seeds = parseSeeds(v); i++ }
  else if (a === '--days') { maxDays = Number(v); i++ }
  else if (a === '--json') { jsonPath = v; i++ }
  else if (a === '--set') { setConfig(v); i++ }
  else throw new Error(`Unknown option ${a}`)
}

// ---------- run
const tps = CONFIG.sim.ticksPerSecond
const ticksPerDay = CONFIG.clock.dayLengthMinutes * 60 * tps
const results: RunResult[] = []
console.log(`Running ${seeds.length} seeds, up to ${maxDays} days each\n`)
for (const seed of seeds) {
  const started = performance.now()
  const sim = createSim(seed)
  while (!sim.ending && sim.tick < maxDays * ticksPerDay) step(sim)
  const r: RunResult = {
    seed,
    ending: sim.ending?.kind ?? 'unfinished',
    tick: sim.tick,
    stats: sim.stats,
    ms: performance.now() - started,
  }
  results.push(r)
  const when = sim.ending ? formatClock(sim.ending.tick) : `still going after ${maxDays} days`
  console.log(`seed ${String(seed).padStart(4)}  ${r.ending.padEnd(13)} ${when.padEnd(26)} taken ${pad(r.stats.captures)}  killed ${pad(myrrKilled(r.stats))} Myrr / ${pad(r.stats.civiliansKilled + r.stats.soldiersKilled)} humans  (${(r.ms / 1000).toFixed(1)}s)`)
}

// ---------- report
console.log('\nEndings')
const kinds = ['overrun', 'extermination', 'escape', 'evacuation', 'unfinished']
for (const kind of kinds) {
  const runs = results.filter((r) => r.ending === kind)
  if (!runs.length) continue
  const share = Math.round((runs.length / results.length) * 100)
  const bar = '#'.repeat(Math.round(share / 4))
  const avg = kind === 'unfinished' ? '' : `  on average ${formatClock(Math.round(average(runs.map((r) => r.tick))))}`
  console.log(`  ${kind.padEnd(13)} ${String(runs.length).padStart(3)} (${String(share).padStart(3)}%) ${bar.padEnd(26)}${avg}`)
}
console.log('\nAverages per run')
const avgOf = (f: (s: RunStats) => number) => average(results.map((r) => f(r.stats))).toFixed(1)
console.log(`  people taken ${avgOf((s) => s.captures)} · cut free ${avgOf((s) => s.cutFree)} · hatched ${avgOf((s) => s.hatched)} · cured ${avgOf((s) => s.cures)} · evacuated ${avgOf((s) => s.evacuated)}`)
console.log(`  civilians killed ${avgOf((s) => s.civiliansKilled)} · soldiers killed ${avgOf((s) => s.soldiersKilled)} · Myrr killed ${avgOf(myrrKilled)}`)
console.log(`\nTotal time ${(results.reduce((t, r) => t + r.ms, 0) / 1000).toFixed(1)}s`)

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  console.log(`Saved to ${jsonPath}`)
}

// ---------- helpers
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** "1-20" or "3,7,12" (or a mix: "1-5,9"). */
function parseSeeds(text: string): number[] {
  return text.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number)
    return b === undefined ? [a] : range(a, b)
  })
}

/** --set hive.spinebacks=6 changes CONFIG.hive.spinebacks for this batch only. */
function setConfig(text: string): void {
  const [path, value] = text.split('=')
  const keys = path.split('.')
  let obj: Record<string, unknown> = CONFIG as unknown as Record<string, unknown>
  for (const k of keys.slice(0, -1)) {
    if (typeof obj[k] !== 'object') throw new Error(`No config section ${path}`)
    obj = obj[k] as Record<string, unknown>
  }
  const last = keys[keys.length - 1]
  if (!(last in obj)) throw new Error(`No config value ${path}`)
  obj[last] = JSON.parse(value)
  console.log(`Using ${path} = ${value}`)
}

function myrrKilled(s: RunStats): number {
  const k = s.myrrKilled
  return k.taker + k.spineback + k.broodling + k.mother
}

function average(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function pad(n: number): string {
  return String(n).padStart(3)
}
