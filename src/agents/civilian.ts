// Civilians: miners, techs and staff. They follow a daily routine and react to
// the Myrr with fear. Each civilian is in one mode at a time (a state machine):
//
//   routine ──fear rises, Myrr seen──▶ flee ──out of sight──▶ hide
//      ▲                                 │                      │
//      └──────── fear fades below "calm" ◀┴──────────────────────┘
//   any mode ──fear very high──▶ panic (runs erratically, screams)

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import { hourOfDay } from '../core/clock.ts'
import type { World } from '../world/loadWorld.ts'
import { canWalk, findPath, type PathNode } from '../world/pathfinding.ts'
import { cornerTiles, findRooms, randomTileIn, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { makeNoise, type Noise } from '../systems/noise.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canHear, canSee } from './perception.ts'

export type Job = keyof typeof CONFIG.civilians.jobs | 'soldier'
export type Activity = 'eat' | 'work' | 'free' | 'sleep'
/**
 * `paralyzed` = stung, can't act until it wears off; `captured` = being carried by a Taker;
 * `captive` = held in the hive waiting for the Brood Mother; `cocooned` = injected,
 * incubating; `dead` = a Broodling burst out.
 */
export type Mode = 'routine' | 'flee' | 'hide' | 'panic' | 'paralyzed' | 'captured' | 'captive' | 'cocooned' | 'dead'

export interface CivilianData {
  job: Job
  /** Hour this civilian's day starts (their shift). */
  shiftStart: number
  /** Small personal offset so a whole shift doesn't move on the same tick. */
  jitterHours: number
  home: RoomRef
  work: RoomRef
  activity: Activity
  /** Room the routine is heading for, or null to choose again. */
  target: RoomRef | null
  mode: Mode
  /** 0 = calm, 1 = terrified. */
  fear: number
  /** Where the last threat was sensed. */
  threat: { levelIndex: number; x: number; y: number } | null
  /** Tick a Myrr was last seen. */
  lastSeenTick: number
  /** Next tick a panicking civilian screams. */
  nextScreamTick: number
  /** Tick a sting wears off (only matters if nobody carries them off). */
  paralyzedUntilTick: number
  /**
   * Injected with a larva: hatches at hatchTick wherever they are. A medic's
   * stabilizer pauses it (pausedTicksLeft set). Null if not infected.
   */
  infection: { hatchTick: number; pausedTicksLeft: number | null } | null
  /** Cut free from a cocoon by soldiers. */
  rescued: boolean
  /** How they died, if they did. */
  deathCause: 'hatched' | 'killed' | null
}

/** What the world looks like to a civilian this tick. */
export interface CivilianContext {
  world: World
  rng: Rng
  tick: number
  agents: Agent[]
  noises: Noise[]
}

const TPS = CONFIG.sim.ticksPerSecond
const F = CONFIG.fear

// ---------------------------------------------------------------- creation

export function createCivilianData(world: World, rng: Rng, forceJob?: Job): CivilianData | null {
  const job = forceJob ?? pickJob(rng)
  const jobInfo = job === 'soldier' ? { level: 1, roomTypes: ['security'] as const } : CONFIG.civilians.jobs[job]
  const homes = findRooms(world, ['quarters'], 0)
  const works = findRooms(world, jobInfo.roomTypes, jobInfo.level - 1).filter((r) => r.room.type !== 'hive')
  if (!homes.length || !works.length) return null
  return {
    job,
    shiftStart: rng.pick(CONFIG.civilians.shiftStartHours),
    jitterHours: (rng.next() - 0.5) * 0.5,
    home: rng.pick(homes),
    work: rng.pick(works),
    activity: 'sleep',
    target: null,
    mode: 'routine',
    fear: 0,
    threat: null,
    lastSeenTick: -1e9,
    nextScreamTick: 0,
    paralyzedUntilTick: 0,
    infection: null,
    rescued: false,
    deathCause: null,
  }
}

function pickJob(rng: Rng): Job {
  const jobs = Object.entries(CONFIG.civilians.jobs) as [Job, { weight: number }][]

  let roll = rng.next() * jobs.reduce((s, [, j]) => s + j.weight, 0)
  for (const [name, j] of jobs) if ((roll -= j.weight) <= 0) return name
  return jobs[0][0]
}

/** What a civilian should be doing at this tick, from their shift schedule. */
export function activityAt(civ: CivilianData, tick: number): Activity {
  const rel = (((hourOfDay(tick) - civ.shiftStart - civ.jitterHours) % 24) + 24) % 24
  let t = 0
  for (const block of CONFIG.civilians.schedule) {
    t += block.hours
    if (rel < t) return block.activity as Activity
  }
  return 'sleep'
}

/** Where to spend the given activity. */
export function roomFor(civ: CivilianData, activity: Activity, levelIndex: number, world: World, rng: Rng): RoomRef {
  switch (activity) {
    case 'work': return civ.work
    case 'sleep': return civ.home
    case 'eat': {
      const here = findRooms(world, ['mess'], levelIndex)
      return here.length ? here[0] : findRooms(world, ['mess'], 0)[0] ?? civ.home
    }
    case 'free': {
      const mess = findRooms(world, ['mess'], 0)
      return rng.chance(0.5) && mess.length ? mess[0] : civ.home
    }
  }
}

// ---------------------------------------------------------------- update

export function updateCivilian(agent: Agent, ctx: CivilianContext): void {
  const civ = agent.civ!
  if (civ.mode === 'paralyzed') {
    if (ctx.tick < civ.paralyzedUntilTick) return
    // The sting wore off and nobody took them: terrified, they get away and hide.
    if (agent.soldier) { setMode(agent, civ, 'routine'); return }
    civ.fear = Math.max(civ.fear, F.flee)
    setMode(agent, civ, 'hide')
    return
  }
  if (!isFree(agent)) return // carried, held or cocooned: the hive moves them now
  if (agent.heldBy >= 0) {
    // In a Taker's claws: can't move, only fight back (done in the Taker's attack).
    const holder = ctx.agents[agent.heldBy]
    if (holder && !holder.dead && holder.myrr?.task === 'attack' && holder.myrr.targetId === agent.id) return
    agent.heldBy = -1
  }
  if (agent.soldier) return // soldiers are run by their squad (soldier.ts)
  if (civ.mode === 'routine' && agent.health < agent.maxHealth) {
    agent.health = Math.min(agent.maxHealth, agent.health + CONFIG.health.regenPerSecond / TPS)
  }
  // Senses run every few ticks, staggered by id so not everyone thinks on the same tick.
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0) sense(agent, civ, ctx)

  if (agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }

  switch (civ.mode) {
    case 'routine': return routine(agent, civ, ctx)
    case 'flee': return flee(agent, civ, ctx)
    case 'hide': return hide(agent, civ, ctx)
    case 'panic': return panic(agent, civ, ctx)
    default: return
  }
}

function routine(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  const activity = activityAt(civ, ctx.tick)
  if (activity !== civ.activity || !civ.target) {
    civ.activity = activity
    civ.target = roomFor(civ, activity, agent.levelIndex, ctx.world, ctx.rng)
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
  }

  if (agent.state.name === 'moving') {
    if (followPath(agent, ctx.world)) rest(agent, ctx.rng, civ.activity === 'sleep')
    return
  }
  if (agent.state.name === 'idle' && --agent.state.ticksLeft > 0) return

  // Not there yet: head for the target room. There already: move to another spot (unless asleep).
  const here = roomAt(ctx.world, tileOf(agent))
  if (!sameRoom(here, civ.target) || civ.activity !== 'sleep') {
    if (!walkTo(agent, ctx, randomTileIn(ctx.world, civ.target!, ctx.rng))) rest(agent, ctx.rng, false)
  } else {
    rest(agent, ctx.rng, true)
  }
}

function flee(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
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

function hide(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  if (agent.state.name === 'moving') {
    // Arrived: settle in and stay still and quiet.
    if (followPath(agent, ctx.world)) agent.state = { name: 'idle', ticksLeft: 1e9 }
    return
  }
  // A long idle state means "already hiding here".
  if (agent.state.name === 'idle' && agent.state.ticksLeft > 0) return
  const spot = hidingSpot(agent, civ, ctx)
  if (spot && walkTo(agent, ctx, spot)) return
  agent.state = { name: 'idle', ticksLeft: 1e9 }
}

function panic(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  if (ctx.tick >= civ.nextScreamTick) {
    makeNoise(ctx.noises, 'scream', agent.levelIndex, agent.x, agent.y, ctx.tick, agent.id)
    civ.nextScreamTick = ctx.tick + Math.round(CONFIG.noise.screamEverySeconds * TPS)
  }
  if (agent.state.name === 'moving' && !followPath(agent, ctx.world)) return
  // Dash somewhere nearby at random.
  const level = ctx.world.levels[agent.levelIndex]
  for (let tries = 0; tries < 20; tries++) {
    const x = Math.floor(agent.x) + ctx.rng.int(-6, 6), y = Math.floor(agent.y) + ctx.rng.int(-6, 6)
    if (canWalk(level, x, y, 'human') && walkTo(agent, ctx, { levelIndex: agent.levelIndex, x, y })) return
  }
  agent.state = { name: 'idle', ticksLeft: TPS }
}

// ---------------------------------------------------------------- senses and fear

function sense(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  if (agent.state.name === 'crossing') return
  const level = ctx.world.levels[agent.levelIndex]
  let sightGain = 0
  let noiseGain = 0
  let company = 0

  for (const other of ctx.agents) {
    if (other === agent || other.levelIndex !== agent.levelIndex) continue
    if (other.side === 'myrr') {
      if (!canSee(agent, other, level)) continue
      const dist = Math.hypot(other.x - agent.x, other.y - agent.y)
      sightGain += F.sight * (1 - (0.5 * dist) / CONFIG.perception.sightRange)
      civ.threat = { levelIndex: other.levelIndex, x: other.x, y: other.y }
      civ.lastSeenTick = ctx.tick
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
  const mult = company === 0 ? F.aloneMultiplier : company >= 2 ? F.groupMultiplier : 1
  let fear = civ.fear - (F.decayPerSecond * CONFIG.perception.intervalTicks) / TPS
  if (noiseGain > 0 && fear < F.hearingCap) fear = Math.min(F.hearingCap, fear + noiseGain * mult)
  fear += sightGain * mult
  civ.fear = Math.min(1, Math.max(0, fear))

  // Choose the mode from the fear level (with a gap between "calm" and "hide" so it doesn't flicker).
  const seenRecently = ctx.tick - civ.lastSeenTick <= F.fleeMemorySeconds * TPS
  let next: Mode = civ.mode
  if (civ.fear >= F.panic || (civ.mode === 'panic' && civ.fear >= F.panic - 0.15)) next = 'panic'
  else if (civ.fear >= F.flee && seenRecently) next = 'flee'
  else if (civ.fear >= F.hide && (civ.mode === 'routine' || civ.mode === 'panic')) next = 'hide'
  else if (civ.fear < F.calm) next = 'routine'
  if (next !== civ.mode) setMode(agent, civ, next)
}

export function setMode(agent: Agent, civ: CivilianData, mode: Mode): void {
  civ.mode = mode
  civ.target = null
  agent.speed = mode === 'flee' || mode === 'panic' ? agent.baseSpeed * CONFIG.civilians.runMultiplier : agent.baseSpeed
  if (agent.state.name !== 'crossing') {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
  }
}

// ---------------------------------------------------------------- helpers

/** A human who isn't captured or held by the hive. */
const NOT_FREE: readonly Mode[] = ['paralyzed', 'captured', 'captive', 'cocooned', 'dead']
export function isFree(agent: Agent): boolean {
  return agent.side === 'human' && !!agent.civ && !NOT_FREE.includes(agent.civ.mode)
}

function walkTo(agent: Agent, ctx: CivilianContext, to: PathNode): boolean {
  const path = findPath(ctx.world, tileOf(agent), to, 'human')
  if (!path || !path.length) return false
  agent.path = path
  agent.state = { name: 'moving' }
  return true
}

function rest(agent: Agent, rng: Rng, long: boolean): void {
  const [min, max] = CONFIG.civilians.millSeconds
  const seconds = long ? max * 5 : min + rng.next() * (max - min)
  agent.state = { name: 'idle', ticksLeft: Math.round(seconds * TPS) }
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
  const rooms = findRooms(ctx.world, ['quarters', 'command', 'armory', 'medbay', 'mess', 'supply', 'workshop', 'security', 'other', 'generator'], agent.levelIndex)
    .filter((r) => !r.room.outdoor)
    .filter((r) => !threat || Math.hypot(r.room.centerX - threat.x, r.room.centerY - threat.y) > F.fleeDistance[0])
    .sort((a, b) => Math.hypot(a.room.centerX - agent.x, a.room.centerY - agent.y) - Math.hypot(b.room.centerX - agent.x, b.room.centerY - agent.y))
  const room = rooms[0]
  if (!room) return null
  const corners = cornerTiles(ctx.world, room)
  return corners.length ? ctx.rng.pick(corners) : randomTileIn(ctx.world, room, ctx.rng)
}
