// Player interference (Phase 11): the watcher can lock or unlock doors, board up
// windows, light flares, switch generators off and on, sound or stop the alarm,
// send a squad somewhere, call the drop ship and order the evacuation.
//
// The screen never changes the sim directly: a tool puts an action in
// sim.player.queue, and the sim applies the queue (at the start of the next tick,
// or right away while paused: see applyPlayerActions in sim.ts) and logs each
// action. Every action also leaves a short message in sim.player.feedback, which
// the screen shows, so a tap that can't be done says why.

import { CONFIG } from '../config.ts'
import { logEvent, type Log } from '../core/events.ts'
import type { PathNode } from '../world/pathfinding.ts'
import type { World } from '../world/loadWorld.ts'
import { Tile } from '../world/tiles.ts'
import { Barrier, putBarrier } from './barriers.ts'
import { markChanged } from './resin.ts'
import { hasPower, type PowerState } from './power.ts'
import { callReinforcements, startEvacuation, type CommanderState } from './commander.ts'
import { lightFlare } from './camouflage.ts'
import { formatDuration } from '../core/clock.ts'
import type { Squad } from '../agents/squad.ts'
import { members } from '../agents/soldier.ts'
import type { CivilianContext } from '../agents/civilian.ts'

const TPS = CONFIG.sim.ticksPerSecond
const P = CONFIG.player

export type PlayerAction =
  /** Lock an unlocked door, or unlock a locked one. `i` = tile index on the level. */
  | { kind: 'door'; levelIndex: number; i: number }
  /** Board up a window (a limited number per run). */
  | { kind: 'window'; levelIndex: number; i: number }
  /** Light a flare on a spot: shows hidden Myrr nearby for a while (a limited number per run). */
  | { kind: 'flare'; at: PathNode }
  /** Switch a generator off, or back on. */
  | { kind: 'power'; generator: number }
  /** Sound the alarm (it stays on until stopped), or stop it. */
  | { kind: 'alarm' }
  /** Send a squad to a spot: it goes there, holds for a while, then goes back on patrol. */
  | { kind: 'send'; squadId: number; to: PathNode }
  /** Call the drop ship now (if the Commander hasn't yet). */
  | { kind: 'dropShip' }
  /** Order the evacuation now. */
  | { kind: 'evacuate' }

export interface PlayerState {
  /** Actions waiting to be applied. */
  queue: PlayerAction[]
  /** Every action applied, with its tick. */
  log: { tick: number; action: PlayerAction }[]
  /** Doors the player locked: level index and tile index. `on` = the lock is on the door now. */
  locks: { levelIndex: number; i: number; on: boolean }[]
  /** Boards and flares the player has left. */
  boards: number
  flares: number
  /** Messages for the screen (what an action did, or why it couldn't). The screen takes them. */
  feedback: string[]
}

export function createPlayer(): PlayerState {
  return { queue: [], log: [], locks: [], boards: P.boards, flares: P.flares, feedback: [] }
}

/** Apply what the player asked for, then keep the player's locks powered. */
export function updatePlayer(player: PlayerState, squads: Squad[], ctx: CivilianContext): void {
  for (const action of player.queue.splice(0)) {
    const result = apply(action, player, squads, ctx)
    player.feedback.push(result.text)
    if (result.done) player.log.push({ tick: ctx.tick, action })
  }
  keepPlayerLocks(player, ctx.world, ctx.power, ctx)
}

interface Result { done: boolean; text: string }
const done = (text: string): Result => ({ done: true, text })
const refused = (text: string): Result => ({ done: false, text })

function apply(action: PlayerAction, player: PlayerState, squads: Squad[], ctx: CivilianContext): Result {
  switch (action.kind) {
    case 'door': return toggleDoor(action.levelIndex, action.i, player, ctx)
    case 'window': return boardWindow(action.levelIndex, action.i, player, ctx)
    case 'flare': return flare(action.at, player, ctx)
    case 'power': return togglePower(action.generator, ctx.power, ctx)
    case 'alarm': return toggleAlarm(ctx.commander, ctx)
    case 'send': return sendSquad(squads[action.squadId], action.to, ctx)
    case 'dropShip': return dropShip(ctx.commander, ctx)
    case 'evacuate': return evacuate(ctx.commander, squads, ctx)
  }
}

// ---------------------------------------------------------------- doors and windows

function toggleDoor(levelIndex: number, i: number, player: PlayerState, ctx: CivilianContext): Result {
  const level = ctx.world.levels[levelIndex]
  if (!level || level.tiles[i] !== Tile.Door) return refused('That isn\'t a door')
  const at = spot(level.width, levelIndex, i)
  const where = `on Level ${levelIndex + 1}${roomNear(ctx.world, levelIndex, i)}`
  // A door the player locked: unlock it.
  const mine = player.locks.findIndex((l) => l.levelIndex === levelIndex && l.i === i)
  if (mine >= 0) {
    player.locks.splice(mine, 1)
    if (level.barrierKind[i] === Barrier.Lock) clearBarrier(level, i)
    logEvent(ctx, 'player', `You unlocked a door ${where}`, at)
    return done('Door unlocked')
  }
  // A door the Commander's lockdown locked: open it (the lockdown leaves it alone from now on).
  if (level.barrierKind[i] === Barrier.Lock) {
    clearBarrier(level, i)
    ctx.commander.lockdownTiles = ctx.commander.lockdownTiles.filter((t) => t !== i)
    logEvent(ctx, 'player', `You unlocked a door ${where} that the lockdown had locked`, at)
    return done('Door unlocked (it was locked by the lockdown)')
  }
  if (level.barrier[i] > 0) return refused(level.barrierKind[i] === Barrier.Weld ? 'That door is welded shut' : 'That door is barricaded')
  player.locks.push({ levelIndex, i, on: false })
  const powered = hasPower(ctx.power)
  logEvent(ctx, 'player', `You locked a door ${where}${powered ? '' : ' (no power: it locks when the power is back)'}`, at)
  return done(powered ? 'Door locked' : 'Door will lock when the power is back')
}

/**
 * Player locks are powered like the Commander's: off while the power is out, back on
 * when it returns. A lock the Myrr break is gone for good. (Humans open locks freely.)
 */
function keepPlayerLocks(player: PlayerState, world: World, power: PowerState, log: Log): void {
  const powered = hasPower(power)
  player.locks = player.locks.filter((lock) => {
    const level = world.levels[lock.levelIndex]
    if (lock.on && level.barrier[lock.i] <= 0 && powered) {
      logEvent(log, 'player', `The Myrr broke a door you locked on Level ${lock.levelIndex + 1}`, spot(level.width, lock.levelIndex, lock.i))
      return false
    }
    if (powered && !lock.on && level.barrier[lock.i] <= 0) putBarrier(level, lock.i, Barrier.Lock)
    if (!powered && lock.on && level.barrierKind[lock.i] === Barrier.Lock) clearBarrier(level, lock.i)
    lock.on = powered && level.barrier[lock.i] > 0
    return true
  })
}

function boardWindow(levelIndex: number, i: number, player: PlayerState, ctx: CivilianContext): Result {
  const level = ctx.world.levels[levelIndex]
  if (!level || level.tiles[i] !== Tile.Window) return refused('That isn\'t a window')
  if (level.barrier[i] > 0) return refused('That window is already boarded')
  if (player.boards <= 0) return refused('No boards left')
  player.boards--
  putBarrier(level, i, Barrier.Boards)
  logEvent(ctx, 'player', `You boarded up a window on Level ${levelIndex + 1}${roomNear(ctx.world, levelIndex, i)}`, spot(level.width, levelIndex, i))
  return done(`Window boarded (${player.boards} boards left)`)
}

function clearBarrier(level: World['levels'][number], i: number): void {
  level.barrier[i] = 0
  level.barrierKind[i] = Barrier.None
  markChanged(level, i)
}

// ---------------------------------------------------------------- flares, power, alarm

function flare(at: PathNode, player: PlayerState, ctx: CivilianContext): Result {
  if (player.flares <= 0) return refused('No flares left')
  player.flares--
  lightFlare(ctx.world.levels[at.levelIndex], at.x + 0.5, at.y + 0.5, ctx.tick)
  logEvent(ctx, 'player', `You lit a flare on Level ${at.levelIndex + 1}${roomNear(ctx.world, at.levelIndex, at.y * ctx.world.levels[at.levelIndex].width + at.x)}`, at)
  return done(`Flare lit for ${formatDuration(CONFIG.flares.burnSeconds * TPS)} (${player.flares} left)`)
}

function togglePower(index: number, power: PowerState, log: Log): Result {
  const gen = power.generators[index]
  if (!gen) return refused('That isn\'t a generator')
  gen.switchedOff = !gen.switchedOff
  logEvent(log, 'player', `You switched the ${gen.room.room.name} ${gen.switchedOff ? 'off' : 'back on'}`, gen.at)
  return done(`${gen.room.room.name} ${gen.switchedOff ? 'off' : 'on'}${gen.broken ? ' (it is also broken)' : ''}`)
}

function toggleAlarm(cmd: CommanderState, log: Log): Result {
  if (cmd.alarm) {
    cmd.alarm = false
    cmd.playerAlarm = false
    // The Commander leaves it off for a while before sounding it again himself.
    cmd.alarmQuietUntil = log.tick + Math.round(P.alarmQuietSeconds * TPS)
    logEvent(log, 'player', 'You stopped the alarm')
    return done('Alarm stopped')
  }
  cmd.alarm = true
  cmd.playerAlarm = true
  logEvent(log, 'player', 'You sounded the alarm: everyone to shelter')
  return done('Alarm on: everyone to shelter')
}

// ---------------------------------------------------------------- squads, drop ship, evacuation

function sendSquad(squad: Squad | undefined, to: PathNode, ctx: CivilianContext): Result {
  if (!squad || squad.guardId >= 0 || !members(squad, ctx).length) return refused('That squad can\'t be sent')
  if (squad.mission === 'assault') {
    squad.mission = null
    squad.missionReached = false
    logEvent(ctx, 'player', `You called ${squad.name} back from the assault`)
  }
  squad.playerGoal = to
  logEvent(ctx, 'player', `You sent ${squad.name} to Level ${to.levelIndex + 1}${roomNear(ctx.world, to.levelIndex, to.y * ctx.world.levels[to.levelIndex].width + to.x)}`, to)
  return done(`${squad.name} on the way`)
}

function dropShip(cmd: CommanderState, ctx: CivilianContext): Result {
  if (cmd.reinforcementsCalled) return refused(cmd.reinforcementsDue !== null ? `The drop ship is already on its way (${formatDuration(cmd.reinforcementsDue - ctx.tick)})` : 'The drop ship has already come')
  callReinforcements(cmd, ctx)
  logEvent(ctx, 'player', `You radioed for the drop ship: it lands in ${formatDuration(CONFIG.commander.reinforcements.delaySeconds * TPS)}`)
  return done('Drop ship called')
}

function evacuate(cmd: CommanderState, squads: Squad[], ctx: CivilianContext): Result {
  if (cmd.evacuation !== 'none') return refused('The evacuation has already been ordered')
  startEvacuation(cmd, squads, ctx)
  logEvent(ctx, 'player', 'You ordered the evacuation: everyone falls back to the Landing Pad')
  return done('Evacuation ordered')
}

// ---------------------------------------------------------------- helpers

function spot(width: number, levelIndex: number, i: number): PathNode {
  return { levelIndex, x: i % width, y: Math.floor(i / width) }
}

/** " (Mess Hall)" for a tile in a room, else "". */
function roomNear(world: World, levelIndex: number, i: number): string {
  const level = world.levels[levelIndex]
  const room = level.rooms[level.roomOf[i]]
  return room ? ` (${room.name})` : ''
}
