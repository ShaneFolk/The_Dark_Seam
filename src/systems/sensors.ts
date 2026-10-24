// Motion sensors: placed near the Upper Mine's vent shafts and ladders. A Myrr
// moving close by sets one off, which raises an alert squads respond to.

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import type { Agent } from '../agents/agent.ts'
import { makeNoise, type Noise } from './noise.ts'

export interface Sensor {
  levelIndex: number
  x: number
  y: number
  /** Tick it last went off (it can't alert again until the cooldown passes). */
  lastAlert: number
}

export function createSensors(world: World, rng: Rng): Sensor[] {
  const level = world.levels[1]
  const spots = [...level.linksAt.entries()]
    .filter(([, links]) => links.some((l) => l.kind === 'vent' || l.kind === 'ladder'))
    .map(([i]) => ({ x: i % level.width, y: Math.floor(i / level.width) }))
  const out: Sensor[] = []
  for (let n = 0; n < CONFIG.sensors.count && spots.length; n++) {
    const i = rng.int(0, spots.length - 1)
    const s = spots.splice(i, 1)[0]
    out.push({ levelIndex: 1, x: s.x + 0.5, y: s.y + 0.5, lastAlert: -1e9 })
  }
  return out
}

/** Check sensors; an alert is a 'sensor' noise that squads respond to wherever they are. */
export function updateSensors(sensors: Sensor[], agents: Agent[], noises: Noise[], tick: number): number {
  if (tick % CONFIG.perception.intervalTicks !== 0) return 0
  let alerts = 0
  const cooldown = CONFIG.sensors.cooldownSeconds * CONFIG.sim.ticksPerSecond
  for (const s of sensors) {
    if (tick - s.lastAlert < cooldown) continue
    const tripped = agents.some((a) => !a.dead && a.side === 'myrr' && a.levelIndex === s.levelIndex &&
      a.state.name === 'moving' && Math.hypot(a.x - s.x, a.y - s.y) <= CONFIG.sensors.range)
    if (!tripped) continue
    s.lastAlert = tick
    makeNoise(noises, 'sensor', s.levelIndex, s.x, s.y, tick, -2)
    alerts++
  }
  return alerts
}
