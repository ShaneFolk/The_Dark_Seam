// Civilian senses and fear: seeing and hearing the Myrr, how fear rises and fades, and fleeing, hiding or panicking.

import { CONFIG } from '../config.ts'
import { canWalk, type PathNode } from '../world/pathfinding.ts'
import { cornerTiles, findRooms, randomTileIn } from '../world/rooms.ts'
import { makeNoise } from '../systems/noise.ts'
import { type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canHear, canSee } from './perception.ts'
import { isRanged } from './combat.ts'
import { roomsWith } from '../systems/supplies.ts'
import { logEvent } from '../core/events.ts'
import { who } from './describe.ts'
import { humanSight } from '../systems/power.ts'
import { type Mode, type CivilianData, type CivilianContext, setMode, isFree, walkTo } from './civilian.ts'
import { planFortify, fortifyStep, tryArm } from './civilianJobs.ts'

const TPS = CONFIG.sim.ticksPerSecond
const F = CONFIG.fear

export function sense(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  if (agent.state.name === 'crossing') return
  const level = ctx.world.levels[agent.levelIndex]
  let sightGain = 0
  let noiseGain = 0
  let company = 0

  for (const other of ctx.agents) {
    // Corpses stay in the agent list; a dead Myrr is no threat.
    if (other === agent || other.dead || other.levelIndex !== agent.levelIndex) continue
    if (other.side === 'myrr') {
      if (!canSee(agent, other, level, humanSight(ctx.power, agent.levelIndex))) continue
      const dist = Math.hypot(other.x - agent.x, other.y - agent.y)
      sightGain += F.sight * (1 - (F.distanceFade * dist) / CONFIG.perception.sightRange)
      civ.threat = { levelIndex: other.levelIndex, x: other.x, y: other.y }
      civ.lastSeenTick = ctx.tick
      ctx.commander.lastSightingTick = ctx.tick
      if (!ctx.stats.contact) {
        ctx.stats.contact = true
        logEvent(ctx, 'contact', `First sighting: ${who(agent, true)} saw a Myrr on Level ${agent.levelIndex + 1}`, agent)
      }
    } else if (isFree(other) && Math.hypot(other.x - agent.x, other.y - agent.y) <= F.companyRadius) {
      company++
    }
  }

  const since = ctx.tick - CONFIG.perception.intervalTicks
  for (const noise of ctx.noises) {
    if (noise.tick <= since || noise.sourceId === agent.id || !canHear(agent, noise, level)) continue
    noiseGain += F[noise.kind]
    if (ctx.tick - civ.lastSeenTick > TPS) civ.threat = { levelIndex: noise.levelIndex, x: noise.x, y: noise.y }
  }

  // Fear always fades a little. Sounds alone can make someone nervous (up to the
  // "hear" cap) but only seeing a Myrr pushes them to flee or panic.
  const trait = civ.trait === 'brave' ? CONFIG.civilians.braveFear : civ.trait === 'panicky' ? CONFIG.civilians.panickyFear : 1
  const mult = (company === 0 ? F.aloneMultiplier : company >= 2 ? F.groupMultiplier : 1) * trait
  let fear = civ.fear - (F.decayPerSecond * CONFIG.perception.intervalTicks) / TPS
  if (noiseGain > 0 && fear < F.hearingCap) fear = Math.min(F.hearingCap, fear + noiseGain * mult)
  fear += sightGain * mult
  civ.fear = Math.min(1, Math.max(0, fear))

  // Choose the mode from the fear level (with a gap between "calm" and "hide" so it doesn't flicker).
  const seenRecently = ctx.tick - civ.lastSeenTick <= F.fleeMemorySeconds * TPS
  let next: Mode = civ.mode
  if (civ.fear >= F.panic || (civ.mode === 'panic' && civ.fear >= F.panic - F.panicHysteresis)) next = 'panic'
  else if (civ.fear >= F.flee && seenRecently) next = 'flee'
  else if (civ.fear >= F.hide && (civ.mode === 'routine' || civ.mode === 'panic')) next = 'hide'
  else if (civ.fear < F.calm) next = 'routine'
  // The Commander is a soldier at heart: never runs or hides, stands and shoots.
  if (civ.job === 'commander') next = 'routine'
  if (next !== civ.mode) setMode(agent, civ, next)
}

export function flee(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  if (agent.state.name === 'moving') {
    if (!followPath(agent, ctx.world)) return
  }
  // Arrived (or just started fleeing): run again if the threat is still close, else hide.
  const seenRecently = ctx.tick - civ.lastSeenTick <= F.fleeMemorySeconds * TPS
  if (seenRecently || agent.state.name === 'idle') {
    const dest = fleeDestination(agent, civ, ctx)
    if (dest && walkTo(agent, ctx, dest)) return
  }
  setMode(agent, civ, 'hide')
}

export function hide(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  // Barricading the doors and boarding the windows of the hiding room.
  if (civ.fortify?.length) return fortifyStep(agent, civ, ctx)
  if (agent.state.name === 'moving') {
    // Arrived: grab a pistol if this room has one, then fortify the room.
    if (followPath(agent, ctx.world)) {
      tryArm(agent, ctx)
      civ.fortify = planFortify(agent, ctx)
      agent.state = { name: 'idle', ticksLeft: civ.fortify.length ? 0 : 1e9 }
    }
    return
  }
  // A long idle state means "already hiding here".
  if (agent.state.name === 'idle' && agent.state.ticksLeft > 0) return
  if (civ.fortify) { agent.state = { name: 'idle', ticksLeft: 1e9 }; return } // done fortifying: stay put
  const spot = hidingSpot(agent, civ, ctx)
  if (spot && walkTo(agent, ctx, spot)) return
  agent.state = { name: 'idle', ticksLeft: 1e9 }
}

export function panic(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  if (ctx.tick >= civ.nextScreamTick) {
    makeNoise(ctx.noises, 'scream', agent.levelIndex, agent.x, agent.y, ctx.tick, agent.id)
    civ.nextScreamTick = ctx.tick + Math.round(CONFIG.noise.screamEverySeconds * TPS)
  }
  if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
  // Dash somewhere nearby at random.
  const level = ctx.world.levels[agent.levelIndex]
  for (let tries = 0; tries < 20; tries++) {
    const x = Math.floor(agent.x) + ctx.rng.int(-F.panicDash, F.panicDash), y = Math.floor(agent.y) + ctx.rng.int(-F.panicDash, F.panicDash)
    if (canWalk(level, x, y, 'human') && walkTo(agent, ctx, { levelIndex: agent.levelIndex, x, y })) return
  }
  agent.state = { name: 'idle', ticksLeft: TPS }
}

/** A reachable spot well away from the threat, on this level. */
function fleeDestination(agent: Agent, civ: CivilianData, ctx: CivilianContext): PathNode | null {
  const level = ctx.world.levels[agent.levelIndex]
  const threat = civ.threat && civ.threat.levelIndex === agent.levelIndex ? civ.threat : null
  const [minD, maxD] = F.fleeDistance
  let best: PathNode | null = null
  let bestScore = -Infinity
  for (let tries = 0; tries < 40; tries++) {
    const angle = ctx.rng.next() * Math.PI * 2
    const d = minD + ctx.rng.next() * (maxD - minD)
    const x = Math.floor(agent.x + Math.cos(angle) * d), y = Math.floor(agent.y + Math.sin(angle) * d)
    if (!canWalk(level, x, y, 'human')) continue
    const score = threat ? Math.hypot(x - threat.x, y - threat.y) : d
    if (score > bestScore) { bestScore = score; best = { levelIndex: agent.levelIndex, x, y } }
  }
  return best
}

/** A corner of the nearest indoor room that isn't next to the threat. */
function hidingSpot(agent: Agent, civ: CivilianData, ctx: CivilianContext): PathNode | null {
  const threat = civ.threat && civ.threat.levelIndex === agent.levelIndex ? civ.threat : null
  // Unarmed? Hide somewhere with a pistol to grab, if one is close and away from the threat.
  if (!agent.weapon || !isRanged(agent.weapon)) {
    const armed = roomsWith(ctx.supplies, 'pistols', agent).find((r) =>
      r.levelIndex === agent.levelIndex && Math.hypot(r.room.centerX - agent.x, r.room.centerY - agent.y) <= CONFIG.supplies.armRange &&
      (!threat || Math.hypot(r.room.centerX - threat.x, r.room.centerY - threat.y) > F.fleeDistance[0]))
    if (armed) return randomTileIn(ctx.world, armed, ctx.rng)
  }
  const rooms = findRooms(ctx.world, ['quarters', 'command', 'armory', 'medbay', 'mess', 'supply', 'workshop', 'security', 'other', 'generator'], agent.levelIndex)
    .filter((r) => !r.room.outdoor)
    .filter((r) => !threat || Math.hypot(r.room.centerX - threat.x, r.room.centerY - threat.y) > F.fleeDistance[0])
    .sort((a, b) => Math.hypot(a.room.centerX - agent.x, a.room.centerY - agent.y) - Math.hypot(b.room.centerX - agent.x, b.room.centerY - agent.y))
  const room = rooms[0]
  if (!room) return null
  const corners = cornerTiles(ctx.world, room)
  return corners.length ? ctx.rng.pick(corners) : randomTileIn(ctx.world, room, ctx.rng)
}
