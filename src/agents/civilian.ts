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
import { isHidden } from '../systems/camouflage.ts'
import { makeNoise } from '../systems/noise.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canHear, canSee } from './perception.ts'
import { isRanged, nearestVisible, tryAttack, type CombatContext } from './combat.ts'
import { roomsWith, stockIn, take, type Supplies } from '../systems/supplies.ts'
import { medBayFor, needsMedBay, type MedBay } from '../systems/medbay.ts'
import { buildSeconds, putBarrier, roomOpenings, type BarrierKind } from '../systems/barriers.ts'
import { Tile } from '../world/tiles.ts'
import { logEvent } from '../core/events.ts'
import { landingPad, type CommanderState } from '../systems/commander.ts'
import { who } from './describe.ts'
import { damagedGenerators, humanSight, repairGenerator, type Generator } from '../systems/power.ts'
import { makeWeapon } from './combat.ts'

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
    trait: job === 'soldier' || job === 'commander' ? null : pickTrait(rng),
    engineer: job === 'tech' && rng.chance(CONFIG.power.engineerShare),
    coverWaitTick: -1,
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
      return rng.chance(0.5) && mess.length ? mess[0] : civ.home
    }
    case 'treat':
      return findRooms(world, ['medbay'])[0] ?? civ.home
    case 'repair':
      return findRooms(world, ['generator'])[0] ?? civ.work
    case 'shelter':
      return civ.home
    case 'evacuate':
      return findRooms(world, ['other'], 0).find((r) => r.room.name === 'Landing Pad') ?? civ.home
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

function routine(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
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
  const close = agent.levelIndex === to.levelIndex && Math.hypot(agent.x - to.x - 0.5, agent.y - to.y - 0.5) <= 2
  if (close) {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    return
  }
  if (agent.state.name !== 'moving' || (ctx.tick + agent.id) % TPS === 0) walkTo(agent, ctx, to)
  followPath(agent, ctx.world)
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
      if (!canSee(agent, other, level, humanSight(ctx.power, agent.levelIndex))) continue
      const dist = Math.hypot(other.x - agent.x, other.y - agent.y)
      sightGain += F.sight * (1 - (0.5 * dist) / CONFIG.perception.sightRange)
      civ.threat = { levelIndex: other.levelIndex, x: other.x, y: other.y }
      civ.lastSeenTick = ctx.tick
      ctx.commander.lastSightingTick = ctx.tick
      if (!ctx.stats.contact) {
        ctx.stats.contact = true
        logEvent(ctx, 'contact', `First sighting: ${who(agent).toLowerCase()} saw a Myrr on Level ${agent.levelIndex + 1}`)
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
  if (civ.fear >= F.panic || (civ.mode === 'panic' && civ.fear >= F.panic - 0.15)) next = 'panic'
  else if (civ.fear >= F.flee && seenRecently) next = 'flee'
  else if (civ.fear >= F.hide && (civ.mode === 'routine' || civ.mode === 'panic')) next = 'hide'
  else if (civ.fear < F.calm) next = 'routine'
  // The Commander is a soldier at heart: never runs or hides, stands and shoots.
  if (civ.job === 'commander') next = 'routine'
  if (next !== civ.mode) setMode(agent, civ, next)
}

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

/**
 * Hold back from a knocked-out generator while Myrr are in sight in its room, or
 * while an escort squad is coming, until soldiers are close (or for maxSeconds).
 */
function waitForCover(agent: Agent, civ: CivilianData, gen: Generator, ctx: CivilianContext): boolean {
  const W = CONFIG.power.waitForCover
  const reset = () => { civ.coverWaitTick = -1; return false }
  if (!gen.broken) return reset()
  const level = ctx.world.levels[gen.at.levelIndex]
  const sight = humanSight(ctx.power, agent.levelIndex)
  const myrrThere = ctx.agents.some((a) => !a.dead && a.side === 'myrr' && a.levelIndex === gen.at.levelIndex &&
    !isHidden(a, level) && sameRoom(roomAt(ctx.world, tileOf(a)), gen.room) && canSee(agent, a, level, sight * 2))
  if (!myrrThere && gen.coverSquad < 0) return reset()
  const covered = ctx.agents.some((a) => !a.dead && a.soldier && isFree(a) && a.levelIndex === agent.levelIndex &&
    Math.hypot(a.x - agent.x, a.y - agent.y) <= W.coverNear)
  if (covered) return reset()
  if (civ.coverWaitTick < 0) civ.coverWaitTick = ctx.tick
  return ctx.tick - civ.coverWaitTick < W.maxSeconds * TPS
}

/** Work on a damaged generator. The first engineer at one the hive broke teaches the hive that they come. */
function repair(agent: Agent, gen: Generator, ctx: CivilianContext): void {
  if (gen.sabotaged) {
    gen.sabotaged = false
    const hive = ctx.hive
    if (++hive.repairsSeen >= CONFIG.power.ambush.learnAfter && !hive.ambushLearned) {
      hive.ambushLearned = true
      logEvent(ctx, 'hive', 'The hive has learned that engineers come to fix broken generators')
    }
  }
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 0 }
  repairGenerator(gen, CONFIG.power.repairPerSecond / TPS)
}

/** A damaged generator this engineer should work on: one they're already on, or one with room in its crew. */
function generatorToRepair(agent: Agent, ctx: CivilianContext): Generator | null {
  for (const gen of damagedGenerators(ctx.power)) {
    if (agent.civ!.activity === 'repair' && sameRoom(agent.civ!.target, gen.room)) return gen
    const crew = ctx.agents.filter((a) => a !== agent && !a.dead && a.civ?.activity === 'repair' && isFree(a) && sameRoom(a.civ.target, gen.room)).length
    if (crew < CONFIG.power.repairCrew) return gen
  }
  return null
}

// ---------------------------------------------------------------- fortifying

/** Openings of the room they're hiding in that have no barrier yet (indoor rooms only). */
function planFortify(agent: Agent, ctx: CivilianContext): NonNullable<CivilianData['fortify']> {
  const room = roomAt(ctx.world, tileOf(agent))
  if (!room || room.room.outdoor || room.room.type === 'hive') return []
  const level = ctx.world.levels[agent.levelIndex]
  return roomOpenings(ctx.world, room).filter((o) => level.barrier[o.tile] <= 0)
}

/** Walk to the next opening and put up a barricade (doors) or boards (windows). */
function fortifyStep(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
  const level = ctx.world.levels[agent.levelIndex]
  const job = civ.fortify![0]
  const tile = level.tiles[job.tile]
  const stillOpen = level.barrier[job.tile] <= 0 && (tile === Tile.Door || tile === Tile.Doorway || tile === Tile.Window)
  if (!stillOpen) { civ.fortify!.shift(); civ.fortifyTicks = 0; return }
  if (Math.floor(agent.x) !== job.standX || Math.floor(agent.y) !== job.standY) {
    if (agent.state.name !== 'moving' && !walkTo(agent, ctx, { levelIndex: agent.levelIndex, x: job.standX, y: job.standY })) {
      civ.fortify!.shift()
      return
    }
    followPath(agent, ctx.world)
    return
  }
  agent.state = { name: 'idle', ticksLeft: 0 }
  if (++civ.fortifyTicks < buildSeconds(job.kind) * TPS) return
  putBarrier(level, job.tile, job.kind)
  civ.fortify!.shift()
  civ.fortifyTicks = 0
}

// ---------------------------------------------------------------- arming

/** Take a pistol (and a couple of magazines) from the room, if it has one. Low skill. */
function tryArm(agent: Agent, ctx: CivilianContext): void {
  if (agent.weapon && isRanged(agent.weapon)) return
  const stock = stockIn(ctx.supplies, roomAt(ctx.world, tileOf(agent)))
  if (!stock || take(stock, 'pistols', 1) === 0) return
  agent.weapon = makeWeapon('pistol', CONFIG.combat.skill.civilian)
  agent.weapon.spare = take(stock, 'pistolMags', CONFIG.supplies.civilianMags)
}

function shootBack(agent: Agent, ctx: CivilianContext): void {
  const range = CONFIG.combat.weapons[agent.weapon!.kind].range
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks !== 0 && agent.weapon!.cooldown > 0) return
  const target = nearestVisible(agent, ctx, range, (a) => a.side === 'myrr')
  if (target) tryAttack(agent, target, ctx)
}

// ---------------------------------------------------------------- helpers

/** A human who isn't captured or held by the hive. */
const NOT_FREE: readonly Mode[] = ['paralyzed', 'captured', 'captive', 'cocooned', 'dead', 'evacuated']
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
