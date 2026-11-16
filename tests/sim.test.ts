// Quick checks that the sim still behaves: run with `npm test`.
// Node runs these TypeScript files directly (no extra packages), like the batch script.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONFIG } from '../src/config.ts'
import { createSim, step } from '../src/sim.ts'
import { createWorld } from '../src/world/world.ts'
import { canWalk } from '../src/world/pathfinding.ts'
import { Tile } from '../src/world/tiles.ts'
import { Barrier } from '../src/systems/barriers.ts'

const TPS = CONFIG.sim.ticksPerSecond
const TICKS_PER_HOUR = (CONFIG.clock.dayLengthMinutes * 60 * TPS) / 24

/** Run a seed for some colony hours (or until it ends), calling `each` after every tick. */
function run(seed: number, hours: number, each?: (sim: ReturnType<typeof createSim>) => void) {
  const sim = createSim(seed)
  while (!sim.ending && sim.tick < hours * TICKS_PER_HOUR) {
    step(sim)
    each?.(sim)
  }
  return sim
}

test('the same seed gives the same run', () => {
  const a = run(3, 8)
  const b = run(3, 8)
  assert.ok(a.events.length > 0, 'something should have happened in 8 colony hours')
  assert.deepEqual(b.events, a.events)
})

test('maps load: every level the same size, every link has a walkable end on each of two levels', () => {
  const world = createWorld()
  const { width, height } = world.levels[0]
  for (const level of world.levels) assert.deepEqual([level.width, level.height], [width, height], `${level.name} size`)
  assert.ok(world.links.length > 0)
  for (const link of world.links) {
    const [top, bottom] = link.ends
    assert.equal(bottom.level, top.level + 1, `a ${link.kind} at ${top.x},${top.y} should join neighbouring levels`)
    for (const end of link.ends) {
      const side = link.myrrOnly ? 'myrr' : 'human'
      // Link ends hold the level's number (1-3), not its index.
      assert.ok(canWalk(world.levels[end.level - 1], end.x, end.y, side), `a ${link.kind} end on Level ${end.level} (${end.x},${end.y}) should be walkable`)
    }
  }
})

test('no Myrr carries a captive forever (they get delivered or dropped)', () => {
  const limit = 6 * TICKS_PER_HOUR // a long walk home is a couple of colony hours at most
  const carrying = new Map<number, number>()
  let longest = 0
  run(2, 30, (sim) => {
    for (const a of sim.agents) {
      if (a.dead || a.myrr?.task !== 'carry') { carrying.delete(a.id); continue }
      const since = carrying.get(a.id) ?? sim.tick
      carrying.set(a.id, since)
      longest = Math.max(longest, sim.tick - since)
    }
  })
  assert.ok(longest < limit, `a Myrr carried someone for ${(longest / TICKS_PER_HOUR).toFixed(1)} colony hours`)
})

test('dead Myrr scare nobody: no sightings logged after every Myrr is dead', () => {
  const sim = run(4, 60)
  const lastMyrrDeath = sim.ending?.kind === 'extermination' ? sim.ending.tick : null
  if (lastMyrrDeath === null) return // this seed didn't end in extermination; nothing to check
  assert.ok(sim.commander.lastSightingTick <= lastMyrrDeath, 'the Commander kept "seeing" Myrr after they were all dead')
})

test('player tools: actions apply on the next tick and are logged; an alarm the player sounds holds', () => {
  const sim = createSim(4)
  const level = sim.world.levels[0]
  const door = level.tiles.findIndex((t, i) => t === Tile.Door && level.barrier[i] <= 0)
  sim.player.queue.push({ kind: 'door', levelIndex: 0, i: door }, { kind: 'power', generator: 0 }, { kind: 'alarm' })
  step(sim)
  assert.equal(level.barrierKind[door], Barrier.Lock, 'the door is locked')
  assert.equal(sim.power.generators[0].switchedOff, true)
  assert.equal(sim.commander.alarm, true)
  assert.equal(sim.player.log.length, 3)
  // The player's alarm holds even with no Myrr seen for a long while.
  for (let i = 0; i < 600 * TPS && !sim.ending; i++) step(sim)
  assert.equal(sim.commander.alarm, true, 'the alarm the player sounded stays on')
  assert.ok(sim.events.some((e) => e.kind === 'player'))
})
