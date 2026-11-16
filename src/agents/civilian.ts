// Civilians: miners, techs and staff. They follow a daily routine and react to
// the Myrr with fear (senses and fear are in fear.ts; repairs, barricades and
// grabbing a pistol in civilianJobs.ts). Each civilian is in one mode at a time (a state machine):
//
//   routine ──fear rises, Myrr seen──▶ flee ──out of sight──▶ hide
//      ▲                                 │                      │
//      └──────── fear fades below "calm" ◀┴──────────────────────┘
//   any mode ──fear very high──▶ panic (runs erratically, screams)

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import { hourOfDay } from '../core/clock.ts'
import type { World } from '../world/loadWorld.ts'
import { findPath, type PathNode } from '../world/pathfinding.ts'
import { findLandingPad, findRooms, randomTileIn, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { isRanged, type CombatContext } from './combat.ts'
import { type Supplies } from '../systems/supplies.ts'
import { medBayFor, needsMedBay, type MedBay } from '../systems/medbay.ts'
import { type BarrierKind } from '../systems/barriers.ts'
import { landingPad, type CommanderState } from '../systems/commander.ts'
import { sense, flee, hide, panic } from './fear.ts'
import { waitForCover, repair, generatorToRepair, shootBack } from './civilianJobs.ts'

export type Job = keyof typeof CONFIG.civilians.jobs | 'soldier' | 'commander'
export type Trait = keyof typeof CONFIG.civilians.traits
/** 'treat' = heading to or staying in the med bay (hurt, or knows they're infected). */
export type Activity = 'eat' | 'work' | 'free' | 'sleep' | 'treat' | 'repair' | 'shelter' | 'evacuate'
/**
 * `paralyzed` = stung, can't act until it wears off; `captured` = being carried by a Taker;
 * `captive` = held in the hive waiting for the Brood Mother; `cocooned` = injected,
 * incubating; `dead` = a Broodling burst out.
 */
export type Mode = 'routine' | 'flee' | 'hide' | 'panic' | 'paralyzed' | 'captured' | 'captive' | 'cocooned' | 'dead' | 'evacuated'

export interface CivilianData {
  job: Job
  /** Their name, e.g. "Edda Rusk" (set when they're placed in the world; see data/names.ts). */
  name: string
  /** Personality (civilians only; see CONFIG.civilians.traits), or null. */
  trait: Trait | null
  /** Techs only: an engineer, one of the few who repair generators. */
  engineer: boolean
  /** Tick this engineer started waiting for an escort to a generator, or -1. */
  coverWaitTick: number
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
   * stabilizer pauses it until stabilizedUntilTick (and pushes hatchTick back by the
   * same amount). Null if not infected.
   */
  infection: { hatchTick: number; stabilizedUntilTick: number } | null
  /** Cut free from a cocoon by soldiers. */
  rescued: boolean
  /** How they died, if they did. */
  deathCause: 'hatched' | 'killed' | null
  /** Ticks spent in a med bay bed curing the current infection. */
  cureTicks: number
  /** Was cured of an infection in the med bay. */
  cured: boolean
  /** While hiding: openings of the room still to barricade or board up (null = not started). */
  fortify: { tile: number; standX: number; standY: number; kind: BarrierKind }[] | null
  fortifyTicks: number
  /** Tick they were taken by the hive (-1 = never), and whether anyone saw it happen. */
  takenTick: number
  takenSeen: boolean
}

/** What the world looks like to a civilian this tick. */
export interface CivilianContext extends CombatContext {
  supplies: Supplies
  medbays: MedBay[]
  commander: CommanderState
}

const TPS = CONFIG.sim.ticksPerSecond
const F = CONFIG.fear

// ---------------------------------------------------------------- creation

export function createCivilianData(world: World, rng: Rng, forceJob?: Job): CivilianData | null {
  const job = forceJob ?? pickJob(rng)
  const jobInfo = job === 'soldier' ? { level: 1, roomTypes: ['security'] as const }
    : job === 'commander' ? { level: 1, roomTypes: ['command'] as const }
    : CONFIG.civilians.jobs[job]
  const homes = findRooms(world, ['quarters'], 0)
  const works = findRooms(world, jobInfo.roomTypes, jobInfo.level - 1).filter((r) => r.room.type !== 'hive')
  if (!homes.length || !works.length) return null
  return {
    job,
    name: '',
    trait: job === 'soldier' || job === 'commander' ? null : pickTrait(rng),
    engineer: job === 'tech' && rng.chance(CONFIG.power.engineerShare),
    coverWaitTick: -1,
    shiftStart: rng.pick(CONFIG.civilians.shiftStartHours),
    jitterHours: (rng.next() - 0.5) * CONFIG.civilians.shiftJitterHours,
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
    cureTicks: 0,
    cured: false,
    fortify: null,
    fortifyTicks: 0,
    takenTick: -1,
    takenSeen: false,
  }
}

function pickTrait(rng: Rng): Trait | null {
  let roll = rng.next()
  for (const [name, chance] of Object.entries(CONFIG.civilians.traits) as [Trait, number][]) if ((roll -= chance) < 0) return name
  return null
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
      return rng.chance(CONFIG.civilians.messChance) && mess.length ? mess[0] : civ.home
    }
    case 'treat':
      return findRooms(world, ['medbay'])[0] ?? civ.home
    case 'repair':
      return findRooms(world, ['generator'])[0] ?? civ.work
    case 'shelter':
      return civ.home
    case 'evacuate':
      return findLandingPad(world) ?? civ.home
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
  // Armed civilians shoot back unless they're running for their lives.
  if (agent.weapon && isRanged(agent.weapon) && (civ.mode === 'routine' || civ.mode === 'hide')) shootBack(agent, ctx)

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

export function routine(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  // The Commander goes along with the command squad when it has to go somewhere.
  if (civ.job === 'commander' && ctx.commander.escortTo) return followEscort(agent, ctx.commander.escortTo, ctx)
  // Hurt, or knowingly infected: the med bay comes before the schedule.
  // Techs drop everything to fix a damaged generator.
  const medbay = needsMedBay(agent) ? medBayFor(ctx.medbays) : null
  const generator = !medbay && civ.engineer ? generatorToRepair(agent, ctx) : null
  // Commander's orders: head for the evacuation ship, or shelter at home during an alarm.
  const cmd = ctx.commander
  // Stubborn people ignore the alarm, and only head for the ship once it's on the pad.
  const stubborn = civ.trait === 'stubborn'
  const evac = (stubborn ? cmd.evacuation === 'landed' : cmd.evacuation === 'fortify' || cmd.evacuation === 'called' || cmd.evacuation === 'landed') ? landingPad(ctx) : null
  // The Commander stays at their post in the Command room (until the evacuation).
  const activity: Activity = medbay ? 'treat' : generator ? 'repair' : evac ? 'evacuate'
    : civ.job === 'commander' ? 'work' : cmd.alarm && !stubborn ? 'shelter' : activityAt(civ, ctx.tick)
  if (generator && Math.hypot(agent.x - (generator.at.x + 0.5), agent.y - (generator.at.y + 0.5)) <= 1.6 && agent.levelIndex === generator.at.levelIndex) {
    civ.coverWaitTick = -1
    repair(agent, generator, ctx)
    return
  }
  if (generator && waitForCover(agent, civ, generator, ctx)) {
    civ.activity = 'repair'
    civ.target = generator.room
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    return
  }
  if (activity !== civ.activity || !civ.target) {
    civ.activity = activity
    civ.target = medbay ?? generator?.room ?? evac ?? roomFor(civ, activity, agent.levelIndex, ctx.world, ctx.rng)
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
  }

  if (agent.state.name === 'moving') {
    if (followPath(agent, ctx.world)) rest(agent, ctx.rng, civ.activity === 'sleep' || civ.activity === 'treat' || civ.activity === 'shelter' || civ.activity === 'evacuate')
    return
  }
  if (agent.state.name === 'idle' && --agent.state.ticksLeft > 0) return

  // Not there yet: head for the target room. There already: move to another spot (unless asleep).
  const here = roomAt(ctx.world, tileOf(agent))
  if (generator) {
    if (!walkTo(agent, ctx, generator.at)) rest(agent, ctx.rng, false)
  } else if (!sameRoom(here, civ.target) || !['sleep', 'treat', 'shelter', 'evacuate'].includes(civ.activity)) {
    if (!walkTo(agent, ctx, randomTileIn(ctx.world, civ.target!, ctx.rng))) rest(agent, ctx.rng, false)
  } else {
    rest(agent, ctx.rng, true)
  }
}

/** Walk with the command squad's leader (re-planning once a second), stopping close to them. */
function followEscort(agent: Agent, to: PathNode, ctx: CivilianContext): void {
  const close = agent.levelIndex === to.levelIndex && Math.hypot(agent.x - to.x - 0.5, agent.y - to.y - 0.5) <= CONFIG.civilians.escortCloseDistance
  if (close) {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    return
  }
  if (agent.state.name !== 'moving' || (ctx.tick + agent.id) % TPS === 0) walkTo(agent, ctx, to)
  followPath(agent, ctx.world)
}

// ---------------------------------------------------------------- senses and fear
export function setMode(agent: Agent, civ: CivilianData, mode: Mode): void {
  civ.mode = mode
  civ.target = null
  civ.fortify = null
  agent.speed = mode === 'flee' || mode === 'panic' ? agent.baseSpeed * CONFIG.civilians.runMultiplier : agent.baseSpeed
  if (agent.state.name !== 'crossing') {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
  }
}

// ---------------------------------------------------------------- fortifying
// ---------------------------------------------------------------- arming
// ---------------------------------------------------------------- helpers

/** A human who isn't captured or held by the hive. */
const NOT_FREE: readonly Mode[] = ['paralyzed', 'captured', 'captive', 'cocooned', 'dead', 'evacuated']
const OUT: readonly Mode[] = ['captured', 'captive', 'cocooned', 'dead', 'evacuated']
const LOST: readonly Mode[] = ['captive', 'cocooned', 'dead', 'evacuated']

/** Out of the colony's hands: dead, evacuated, or taken (even while still being carried off). */
export function isOut(agent: Agent): boolean {
  return agent.dead || !agent.civ || OUT.includes(agent.civ.mode)
}

/** Lost to their squad: dead, evacuated, or already in the hive (someone still being carried can be saved). */
export function isLost(agent: Agent): boolean {
  return agent.dead || !agent.civ || LOST.includes(agent.civ.mode)
}
export function isFree(agent: Agent): boolean {
  return agent.side === 'human' && !!agent.civ && !NOT_FREE.includes(agent.civ.mode)
}

export function walkTo(agent: Agent, ctx: CivilianContext, to: PathNode): boolean {
  const path = findPath(ctx.world, tileOf(agent), to, 'human')
  if (!path || !path.length) return false
  agent.path = path
  agent.state = { name: 'moving' }
  return true
}

export function rest(agent: Agent, rng: Rng, long: boolean): void {
  const [min, max] = CONFIG.civilians.millSeconds
  const seconds = long ? max * 5 : min + rng.next() * (max - min)
  agent.state = { name: 'idle', ticksLeft: Math.round(seconds * TPS) }
}
