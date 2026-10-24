// The Commander: colony-wide decisions, reviewed every few seconds.
//
//   alarm          first sighting or capture: civilians shelter at home; clears after a quiet spell
//   lockdown       Myrr on the surface: powered doors lock (humans pass, Myrr must break them)
//   assault        hive known and holding cocoons (or big, or nearly beaten): send healthy squads after the Brood
//                  Mother (they cut cocoons free and fight whatever they meet on the way)
//   reinforcements soldiers down to 60%: a fresh squad lands at the Landing Pad after a delay
//   burn resin     after a squad is ambushed: squads burn resin ahead of them (unless lives are at stake)
//   the Commander  is on the map (Command room, with a command squad); if killed or taken,
//                  a slower, more cautious second-in-command takes over
//   evacuation     few civilians left: a ship comes to the Landing Pad; whoever is on it leaves

import { CONFIG } from '../config.ts'
import type { Agent } from '../agents/agent.ts'
import { isFree } from '../agents/civilian.ts'
import type { CivilianContext } from '../agents/civilian.ts'
import { members, type Squad } from '../agents/soldier.ts'
import { logEvent } from '../core/events.ts'
import { findRooms, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { Tile } from '../world/tiles.ts'
import { tileOf } from '../agents/agent.ts'
import { Barrier, putBarrier } from './barriers.ts'
import { markChanged } from './resin.ts'
import { hasPower } from './power.ts'

export interface CommanderState {
  alarm: boolean
  lockdown: boolean
  /** Locks are actually on the doors (they drop when the power fails). */
  locked: boolean
  /** Humans know where the hive is (after the first capture). */
  hiveKnown: boolean
  /** Last tick any human saw a Myrr. */
  lastSightingTick: number
  reinforcementsLeft: number
  /** Tick the called squad lands, or null. */
  reinforcementsDue: number | null
  evacuation: 'none' | 'called' | 'landed' | 'gone'
  /** Tick the ship lands / leaves. */
  shipLands: number
  shipLeaves: number
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
    reinforcementsLeft: CONFIG.commander.reinforcements.calls, reinforcementsDue: null,
    evacuation: 'none', shipLands: 0, shipLeaves: 0,
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
  /** Spawn a fresh squad at the Landing Pad. */
  spawnReinforcements: () => void
}

export function updateCommander(cmd: CommanderState, squads: Squad[], ctx: CivilianContext, hooks: CommanderHooks): void {
  // Ship and reinforcement timers run every tick.
  if (cmd.reinforcementsDue !== null && ctx.tick >= cmd.reinforcementsDue) {
    cmd.reinforcementsDue = null
    hooks.spawnReinforcements()
    logEvent(ctx, 'command', 'Reinforcements landed at the Landing Pad')
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
    const minMorale = cmd.second ? C.second.assaultMinMorale : C.assault.minMorale
    const ready = squads.filter((s) => !s.mission && s.guardId < 0 && s.morale >= minMorale && members(s, ctx).length >= C.assault.minMembers)
    const sent = ready.slice(0, cmd.second ? C.second.assaultSquads : C.assault.squads)
    for (const s of sent) { s.mission = 'assault'; s.missionGoal = null }
    if (sent.length) logEvent(ctx, 'command', `Squad${sent.length > 1 ? 's' : ''} ${sent.map((s) => s.id + 1).join(' and ')} sent to assault the hive (${cocoons} cocooned)`)
  }

  // Reinforcements when soldiers run low.
  if (cmd.reinforcementsLeft > 0 && cmd.reinforcementsDue === null && soldiers < cmd.startSoldiers * C.reinforcements.belowShare) {
    cmd.reinforcementsLeft--
    cmd.reinforcementsDue = ctx.tick + Math.round(C.reinforcements.delaySeconds * TPS)
    logEvent(ctx, 'command', `Reinforcements called: a squad lands at the Landing Pad in ${Math.round(C.reinforcements.delaySeconds / 60)} minutes`)
  }

  // Evacuation when few civilians are left free.
  if (cmd.evacuation === 'none' && civilians > 0 && civilians < cmd.startCivilians * C.evacuation.civiliansBelow) {
    cmd.evacuation = 'called'
    cmd.shipLands = ctx.tick + Math.round(C.evacuation.shipDelaySeconds * TPS)
    for (const s of squads) { s.mission = 'escort'; s.missionGoal = null }
    logEvent(ctx, 'command', `Evacuation ordered: a ship reaches the Landing Pad in ${Math.round(C.evacuation.shipDelaySeconds / 60)} minutes`)
  }
}

/** Is the Commander still in charge? Killed or taken: the second-in-command takes over. */
function checkCommander(cmd: CommanderState, squads: Squad[], ctx: CivilianContext): void {
  if (cmd.second || cmd.commanderId < 0) return
  const boss = ctx.agents[cmd.commanderId]
  const lost = boss.dead || ['captured', 'captive', 'cocooned', 'dead'].includes(boss.civ?.mode ?? 'dead')
  if (!lost) return
  cmd.second = true
  cmd.reinforcementsLeft = Math.max(0, cmd.reinforcementsLeft - 1)
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
  if (cmd.evacuation === 'called' && ctx.tick >= cmd.shipLands) {
    cmd.evacuation = 'landed'
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
