// The Commander: colony-wide decisions, reviewed every few seconds.
//
//   alarm          first sighting or capture: civilians shelter at home; clears after a quiet spell
//   lockdown       Myrr on the surface: powered doors lock (humans pass, Myrr must break them)
//   assault        hive known and holding cocoons (or big, or nearly beaten): the first time, one squad
//                  probes the hive. After that only an attack in force (several squads together), unless
//                  someone cocooned is about to hatch and the Commander deems it a must
//   reinforcements one call, once the Commander realizes people are being taken (seen, or missed at
//                  their shift): after half a day a drop ship brings two squads of four
//   burn resin     after a squad is ambushed: squads burn resin ahead of them (unless lives are at stake)
//   the Commander  is on the map (Command room, with a command squad); if killed or taken,
//                  a slower, more cautious second-in-command takes over
//   evacuation     few civilians left: everyone falls back to the Landing Pad, squads set up turrets
//                  around it, then the ship is called. The hive hears it coming and swarms the pad;
//                  whoever is on the pad when it leaves gets away

import { CONFIG } from '../config.ts'
import type { Agent } from '../agents/agent.ts'
import { isFree } from '../agents/civilian.ts'
import type { CivilianContext } from '../agents/civilian.ts'
import { members, type Squad } from '../agents/soldier.ts'
import { logEvent } from '../core/events.ts'
import { findRooms, randomTileIn, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { Tile } from '../world/tiles.ts'
import { tileOf } from '../agents/agent.ts'
import { Barrier, putBarrier } from './barriers.ts'
import { markChanged } from './resin.ts'
import { hasPower } from './power.ts'
import { callShipSwarm } from '../agents/swarm.ts'
import { makeNoise } from './noise.ts'

export interface CommanderState {
  alarm: boolean
  lockdown: boolean
  /** Locks are actually on the doors (they drop when the power fails). */
  locked: boolean
  /** Humans know where the hive is (after the first capture). */
  hiveKnown: boolean
  /** Last tick any human saw a Myrr. */
  lastSightingTick: number
  /** The one reinforcement call has been made. */
  reinforcementsCalled: boolean
  /** Tick the drop ship lands, or null. */
  reinforcementsDue: number | null
  /** People the Commander knows have been taken. */
  missingKnown: number
  /** The probing assault has gone in; from now on only attacks in force (or a must). */
  probed: boolean
  /** Last tick a single squad was sent in because it was a must. */
  lastMustTick: number
  /** fortify: falling back to the Landing Pad and setting up turrets before calling the ship. */
  evacuation: 'none' | 'fortify' | 'called' | 'landed' | 'gone'
  /** Tick the fortifying ends at the latest; ticks the ship lands / leaves. */
  fortifyUntil: number
  shipLands: number
  shipLeaves: number
  /** The hive has heard the ship and sent its swarm. */
  shipHeard: boolean
  startSoldiers: number
  startCivilians: number
  /** After a squad is ambushed: squads burn resin ahead of them before advancing. */
  burnResin: boolean
  /** The Commander on the map (-1 if none), and whether the second-in-command has taken over. */
  commanderId: number
  second: boolean
}

export function createCommander(agents: Agent[]): CommanderState {
  return {
    alarm: false, lockdown: false, locked: false, hiveKnown: false, lastSightingTick: -1e9,
    reinforcementsCalled: false, reinforcementsDue: null, missingKnown: 0, probed: false, lastMustTick: -1e9,
    evacuation: 'none', fortifyUntil: 0, shipLands: 0, shipLeaves: 0, shipHeard: false,
    burnResin: false,
    commanderId: agents.find((a) => a.kind === 'commander')?.id ?? -1,
    second: false,
    startSoldiers: agents.filter((a) => a.soldier).length,
    startCivilians: agents.filter((a) => a.civ && !a.soldier).length,
  }
}

const TPS = CONFIG.sim.ticksPerSecond
const C = CONFIG.commander

export interface CommanderHooks {
  /** Land the reinforcements (all their squads) at the Landing Pad. */
  spawnReinforcements: () => void
}

export function updateCommander(cmd: CommanderState, squads: Squad[], ctx: CivilianContext, hooks: CommanderHooks): void {
  // Ship and reinforcement timers run every tick.
  if (cmd.reinforcementsDue !== null && ctx.tick >= cmd.reinforcementsDue) {
    cmd.reinforcementsDue = null
    hooks.spawnReinforcements()
    const R = C.reinforcements
    logEvent(ctx, 'command', `The drop ship landed ${R.squads * R.squadSize} soldiers at the Landing Pad`)
  }
  updateShip(cmd, ctx)
  keepLocks(cmd, ctx)
  checkCommander(cmd, squads, ctx)
  // The second-in-command takes longer to make up their mind.
  const every = Math.round(C.intervalSeconds * (cmd.second ? C.second.slowerBy : 1) * TPS)
  if (ctx.tick % every !== 0) return

  const soldiers = ctx.agents.filter((a) => !a.dead && a.soldier && isFree(a)).length
  const civilians = ctx.agents.filter((a) => !a.dead && a.civ && !a.soldier && isFree(a)).length

  // Alarm: on the first sighting or capture; clears after a quiet spell.
  const recent = ctx.tick - cmd.lastSightingTick < C.alarmClearSeconds * TPS
  if (!cmd.alarm && recent) {
    cmd.alarm = true
    logEvent(ctx, 'command', 'The Commander sounded the alarm: everyone to shelter')
  } else if (cmd.alarm && !recent) {
    cmd.alarm = false
    logEvent(ctx, 'command', 'All clear: the alarm is off')
    if (cmd.lockdown) { cmd.lockdown = false; logEvent(ctx, 'command', 'Lockdown lifted') }
    cmd.burnResin = false
  }

  // A squad walked into an ambush: from now on, burn the resin before going in.
  if (!cmd.burnResin && ctx.stats.squadAmbushes > 0 && cmd.alarm) {
    cmd.burnResin = true
    logEvent(ctx, 'command', 'After the ambush, the Commander orders squads to burn the resin before advancing')
  }

  // Lockdown: Myrr have been seen on the surface.
  if (cmd.alarm && !cmd.lockdown && recentSurfaceSighting(ctx)) {
    cmd.lockdown = true
    logEvent(ctx, 'command', 'Lockdown: the colony doors are locked')
  }

  // The hive's location becomes known after the first capture (they follow the trail).
  if (!cmd.hiveKnown && ctx.stats.captures > 0) {
    cmd.hiveKnown = true
    logEvent(ctx, 'command', 'The hive has been tracked to the Deep Mine')
  }

  // Assault the hive with healthy squads.
  const cocoons = ctx.agents.filter((a) => a.civ?.mode === 'cocooned').length
  const hiveSize = ctx.agents.filter((a) => !a.dead && a.side === 'myrr').length
  const assaulting = squads.filter((s) => s.mission === 'assault')
  if (cmd.hiveKnown && cmd.evacuation === 'none' && !assaulting.length && (cocoons >= C.assault.minCocoons || hiveSize >= C.assault.hiveSize || hiveSize <= C.assault.finishHiveAtOrBelow)) {
    planAssault(cmd, squads, cocoons, ctx)
  }

  // Reinforcements: once he realizes people are being taken (or his soldiers run low).
  const R = C.reinforcements
  cmd.missingKnown = ctx.agents.filter((a) => a.civ && a.civ.takenTick >= 0 &&
    (a.civ.takenSeen || ctx.tick - a.civ.takenTick >= R.noticeSeconds * TPS)).length
  if (!cmd.reinforcementsCalled && (cmd.missingKnown >= R.missingToCall || soldiers < cmd.startSoldiers * R.belowShare)) {
    cmd.reinforcementsCalled = true
    cmd.reinforcementsDue = ctx.tick + Math.round(R.delaySeconds * TPS)
    const why = cmd.missingKnown >= R.missingToCall ? `${cmd.missingKnown} people are missing` : 'too many soldiers are down'
    logEvent(ctx, 'command', `The Commander realizes ${why} and radios for help: a drop ship with ${R.squads} squads lands in ${Math.round(R.delaySeconds / 60)} minutes`)
  }

  // Evacuation when few civilians are left free.
  if (cmd.evacuation === 'none' && civilians > 0 && civilians < cmd.startCivilians * C.evacuation.civiliansBelow) {
    cmd.evacuation = 'fortify'
    cmd.fortifyUntil = ctx.tick + Math.round(C.evacuation.fortifySeconds * TPS)
    for (const s of squads) { s.mission = 'escort'; s.missionGoal = null; s.missionReached = false }
    logEvent(ctx, 'command', 'Evacuation: everyone falls back to the Landing Pad; the squads fortify it before the ship is called')
  }
  // Fortified (or out of time): call the ship.
  if (cmd.evacuation === 'fortify' && (padReady(squads, ctx) || ctx.tick >= cmd.fortifyUntil)) {
    cmd.evacuation = 'called'
    cmd.shipLands = ctx.tick + Math.round(C.evacuation.shipDelaySeconds * TPS)
    const turrets = padTurrets(ctx)
    const state = turrets >= C.evacuation.padTurrets ? `fortified with ${turrets} turrets` : turrets ? `only ${turrets} turret${turrets === 1 ? '' : 's'} could be set up` : 'no turrets left to set up; the squads hold the pad'
    logEvent(ctx, 'command', `Landing Pad: ${state}. The ship is called, landing in ${Math.round(C.evacuation.shipDelaySeconds / 60)} minutes`)
  }
}

/**
 * Send squads against the hive. The first time, one squad probes it. After that,
 * only an attack in force (every ready squad, enough soldiers together), unless
 * someone cocooned is about to hatch: then he deems it a must and sends one squad.
 */
function planAssault(cmd: CommanderState, squads: Squad[], cocoons: number, ctx: CivilianContext): void {
  const A = C.assault
  const minMorale = cmd.second ? C.second.assaultMinMorale : A.minMorale
  const ready = squads.filter((s) => !s.mission && s.guardId < 0 && s.morale >= minMorale && members(s, ctx).length >= A.minMembers)
  if (!ready.length) return
  const names = (list: Squad[]) => `Squad${list.length > 1 ? 's' : ''} ${list.map((s) => s.id + 1).join(', ')}`
  const send = (list: Squad[]) => { for (const s of list) { s.mission = 'assault'; s.missionGoal = null; s.missionReached = false } }
  if (!cmd.probed) {
    cmd.probed = true
    send(ready.slice(0, 1))
    logEvent(ctx, 'command', `${names(ready.slice(0, 1))} sent to probe the hive (${cocoons} cocooned)`)
    return
  }
  const force = ready.reduce((n, s) => n + members(s, ctx).length, 0)
  if (force >= A.forceMinSoldiers) {
    send(ready)
    logEvent(ctx, 'command', `The Commander attacks the hive in force: ${names(ready)}, ${force} soldiers (${cocoons} cocooned)`)
    return
  }
  // Not while the drop ship is on its way: help is coming, they hold on.
  if (cmd.reinforcementsDue === null && hatchingSoon(ctx) >= A.mustHatching && ctx.tick - cmd.lastMustTick >= A.mustCooldownSeconds * TPS) {
    cmd.lastMustTick = ctx.tick
    send(ready.slice(0, 1))
    logEvent(ctx, 'command', `The Commander deems it a must: ${names(ready.slice(0, 1))} goes in alone to save someone about to hatch`)
  }
}

/** How many people in cocoons are close to hatching. */
export function hatchingSoon(ctx: CivilianContext): number {
  const soon = ctx.tick + C.riskHatchSeconds * TPS
  return ctx.agents.filter((a) => a.civ?.mode === 'cocooned' && a.civ.infection && a.civ.infection.hatchTick < soon).length
}

/** Turrets standing on the Landing Pad. */
export function padTurrets(ctx: CivilianContext): number {
  const pad = landingPad(ctx)
  return pad ? ctx.agents.filter((a) => a.kind === 'turret' && !a.dead && sameRoom(roomAt(ctx.world, tileOf(a)), pad)).length : 0
}

/** Enough turrets around the pad; or none left anywhere to bring and every squad has made it to the pad. */
function padReady(squads: Squad[], ctx: CivilianContext): boolean {
  if (padTurrets(ctx) >= C.evacuation.padTurrets) return true
  const stocked = [...ctx.supplies.values()].some((s) => s.stock.turrets > 0)
  const active = squads.filter((s) => members(s, ctx).length)
  return !stocked && !active.some((s) => s.carryingTurret) && active.every((s) => s.mission !== 'escort' || s.missionReached)
}

/** Is the Commander still in charge? Killed or taken: the second-in-command takes over. */
function checkCommander(cmd: CommanderState, squads: Squad[], ctx: CivilianContext): void {
  if (cmd.second || cmd.commanderId < 0) return
  const boss = ctx.agents[cmd.commanderId]
  const lost = boss.dead || ['captured', 'captive', 'cocooned', 'dead'].includes(boss.civ?.mode ?? 'dead')
  if (!lost) return
  cmd.second = true
  for (const s of squads) s.morale = Math.max(0, s.morale - C.second.moraleHit)
  logEvent(ctx, 'command', `The Commander has been ${boss.dead ? 'killed' : 'taken'}! The second-in-command takes over`)
}

/** Has a human seen a Myrr on Level 1 recently? */
function recentSurfaceSighting(ctx: CivilianContext): boolean {
  return ctx.agents.some((a) => !a.dead && a.side === 'myrr' && a.levelIndex === 0 && a.myrr?.task !== 'carry') &&
    ctx.agents.some((a) => a.civ && !a.dead && a.civ.lastSeenTick > ctx.tick - 10 * TPS && a.levelIndex === 0)
}

/** Lock or unlock the surface doors to match the lockdown (locks need power). */
function keepLocks(cmd: CommanderState, ctx: CivilianContext): void {
  const want = cmd.lockdown && hasPower(ctx.power)
  if (want === cmd.locked) return
  cmd.locked = want
  const level = ctx.world.levels[0]
  for (let i = 0; i < level.tiles.length; i++) {
    if (level.tiles[i] !== Tile.Door) continue
    if (want && level.barrier[i] <= 0) putBarrier(level, i, Barrier.Lock)
    else if (!want && level.barrierKind[i] === Barrier.Lock) {
      level.barrier[i] = 0
      level.barrierKind[i] = Barrier.None
      markChanged(level, i)
    }
  }
  if (!want && cmd.lockdown) logEvent(ctx, 'power', 'The door locks failed without power')
}

/** The evacuation ship lands, waits, and leaves with everyone on the pad. */
function updateShip(cmd: CommanderState, ctx: CivilianContext): void {
  // The hive hears the ship coming down and goes for the pad.
  if (cmd.evacuation === 'called' && !cmd.shipHeard && ctx.tick >= cmd.shipLands - C.evacuation.swarmLeadSeconds * TPS) {
    cmd.shipHeard = true
    const pad = landingPad(ctx)
    const n = pad ? callShipSwarm(randomTileIn(ctx.world, pad, ctx.rng), ctx) : 0
    if (n) logEvent(ctx, 'hive', `The roar of the descending ship carries down the shafts: ${n} Myrr swarm toward the Landing Pad`)
  }
  if (cmd.evacuation === 'called' && ctx.tick >= cmd.shipLands) {
    cmd.evacuation = 'landed'
    const pad = landingPad(ctx)
    if (pad) makeNoise(ctx.noises, 'blast', 0, pad.room.centerX, pad.room.centerY, ctx.tick, -1)
    cmd.shipLeaves = ctx.tick + Math.round(C.evacuation.shipWaitSeconds * TPS)
    logEvent(ctx, 'command', 'The evacuation ship has landed at the Landing Pad')
  }
  if (cmd.evacuation === 'landed' && ctx.tick >= cmd.shipLeaves) {
    cmd.evacuation = 'gone'
    const pad = landingPad(ctx)
    let aboard = 0
    for (const a of ctx.agents) {
      if (a.dead || !a.civ || !isFree(a) || !pad || !sameRoom(roomAt(ctx.world, tileOf(a)), pad)) continue
      a.civ.mode = 'evacuated'
      a.path = []
      a.state = { name: 'idle', ticksLeft: 1e9 }
      aboard++
    }
    ctx.stats.evacuated += aboard
    logEvent(ctx, 'command', `The ship took off with ${aboard} survivor${aboard === 1 ? '' : 's'}`)
  }
}

export function landingPad(ctx: CivilianContext): RoomRef | null {
  return findRooms(ctx.world, ['other'], 0).find((r) => r.room.name === 'Landing Pad') ?? null
}
