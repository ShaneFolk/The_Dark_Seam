// Player interference (Phase 11): the watcher can lock doors, switch generators off
// and on, sound or stop the alarm, and send a squad somewhere.
//
// The screen never changes the sim directly: a tool puts an action in
// sim.playerQueue, and the sim applies the queue at the start of its next tick
// (and logs each action). Every action applied is kept in sim.playerLog with its
// tick, so a run is still "the seed plus these actions".

import { CONFIG } from '../config.ts'
import { logEvent, type Log } from '../core/events.ts'
import type { PathNode } from '../world/pathfinding.ts'
import type { World } from '../world/loadWorld.ts'
import { Tile } from '../world/tiles.ts'
import { Barrier, putBarrier } from './barriers.ts'
import { markChanged } from './resin.ts'
import { hasPower, type PowerState } from './power.ts'
import type { CommanderState } from './commander.ts'
import type { Squad } from '../agents/squad.ts'
import { members } from '../agents/soldier.ts'
import type { CivilianContext } from '../agents/civilian.ts'

export type PlayerAction =
  /** Lock an unlocked door, or unlock a door the player locked. `i` = tile index on the level. */
  | { kind: 'door'; levelIndex: number; i: number }
  /** Switch a generator off, or back on. */
  | { kind: 'power'; generator: number }
  /** Sound the alarm (it stays on until stopped), or stop it. */
  | { kind: 'alarm' }
  /** Send a squad to a spot: it goes there, holds for a while, then goes back on patrol. */
  | { kind: 'send'; squadId: number; to: PathNode }

export interface PlayerState {
  /** Actions waiting for the next tick. */
  queue: PlayerAction[]
  /** Every action applied, with its tick (to replay a run later). */
  log: { tick: number; action: PlayerAction }[]
  /** Doors the player locked: level index and tile index. `on` = the lock is on the door now. */
  locks: { levelIndex: number; i: number; on: boolean }[]
}

export function createPlayer(): PlayerState {
  return { queue: [], log: [], locks: [] }
}

/** Is this a door the player has locked? */
export function playerLocked(player: PlayerState, levelIndex: number, i: number): boolean {
  return player.locks.some((l) => l.levelIndex === levelIndex && l.i === i)
}

/** Start of a tick: apply what the player asked for, then keep the player's locks powered. */
export function updatePlayer(player: PlayerState, squads: Squad[], ctx: CivilianContext): void {
  for (const action of player.queue.splice(0)) {
    if (apply(action, player, squads, ctx)) player.log.push({ tick: ctx.tick, action })
  }
  keepPlayerLocks(player, ctx.world, ctx.power, ctx)
}

function apply(action: PlayerAction, player: PlayerState, squads: Squad[], ctx: CivilianContext): boolean {
  switch (action.kind) {
    case 'door': return toggleDoor(action.levelIndex, action.i, player, ctx)
    case 'power': return togglePower(action.generator, ctx.power, ctx)
    case 'alarm': return toggleAlarm(ctx.commander, ctx)
    case 'send': return sendSquad(squads[action.squadId], action.to, ctx)
  }
}

function toggleDoor(levelIndex: number, i: number, player: PlayerState, ctx: CivilianContext): boolean {
  const level = ctx.world.levels[levelIndex]
  if (!level || level.tiles[i] !== Tile.Door) return false
  const where = `on Level ${levelIndex + 1}${roomNear(ctx.world, levelIndex, i)}`
  const mine = player.locks.findIndex((l) => l.levelIndex === levelIndex && l.i === i)
  if (mine >= 0) {
    player.locks.splice(mine, 1)
    if (level.barrierKind[i] === Barrier.Lock && !ctx.commander.locked) clearLock(level, i)
    logEvent(ctx, 'player', `You unlocked a door ${where}`, { levelIndex, x: i % level.width, y: Math.floor(i / level.width) })
    return true
  }
  if (level.barrier[i] > 0) return false // already barricaded, welded or locked by the Commander
  player.locks.push({ levelIndex, i, on: false })
  logEvent(ctx, 'player', `You locked a door ${where}${hasPower(ctx.power) ? '' : ' (no power: it locks when the power is back)'}`, { levelIndex, x: i % level.width, y: Math.floor(i / level.width) })
  return true
}

/**
 * Player locks are powered like the Commander's: off while the power is out, back on
 * when it returns. A lock the Myrr break is gone for good.
 */
function keepPlayerLocks(player: PlayerState, world: World, power: PowerState, log: Log): void {
  const powered = hasPower(power)
  player.locks = player.locks.filter((lock) => {
    const level = world.levels[lock.levelIndex]
    if (lock.on && level.barrier[lock.i] <= 0 && powered) {
      logEvent(log, 'player', `The Myrr broke a door you locked on Level ${lock.levelIndex + 1}`, { levelIndex: lock.levelIndex, x: lock.i % level.width, y: Math.floor(lock.i / level.width) })
      return false
    }
    if (powered && !lock.on && level.barrier[lock.i] <= 0) putBarrier(level, lock.i, Barrier.Lock)
    if (!powered && lock.on && level.barrierKind[lock.i] === Barrier.Lock) clearLock(level, lock.i)
    lock.on = powered && level.barrier[lock.i] > 0
    return true
  })
}

function clearLock(level: World['levels'][number], i: number): void {
  level.barrier[i] = 0
  level.barrierKind[i] = Barrier.None
  markChanged(level, i)
}

function togglePower(index: number, power: PowerState, log: Log): boolean {
  const gen = power.generators[index]
  if (!gen) return false
  gen.switchedOff = !gen.switchedOff
  logEvent(log, 'player', `You switched the ${gen.room.room.name} ${gen.switchedOff ? 'off' : 'back on'}`, gen.at)
  return true
}

function toggleAlarm(cmd: CommanderState, log: Log & { tick: number }): boolean {
  if (cmd.alarm) {
    cmd.alarm = false
    cmd.playerAlarm = false
    // The Commander leaves it off for a while before sounding it again himself.
    cmd.alarmQuietUntil = log.tick + Math.round(CONFIG.player.alarmQuietSeconds * CONFIG.sim.ticksPerSecond)
    logEvent(log, 'player', 'You stopped the alarm')
  } else {
    cmd.alarm = true
    cmd.playerAlarm = true
    logEvent(log, 'player', 'You sounded the alarm: everyone to shelter')
  }
  return true
}

function sendSquad(squad: Squad | undefined, to: PathNode, ctx: CivilianContext): boolean {
  if (!squad || squad.guardId >= 0 || !members(squad, ctx).length) return false
  if (squad.mission === 'assault') {
    squad.mission = null
    squad.missionReached = false
    logEvent(ctx, 'player', `You called ${squad.name} back from the assault`)
  }
  squad.playerGoal = to
  logEvent(ctx, 'player', `You sent ${squad.name} to Level ${to.levelIndex + 1}${roomNear(ctx.world, to.levelIndex, to.y * ctx.world.levels[to.levelIndex].width + to.x)}`, to)
  return true
}

/** " (Mess Hall)" for a tile in a room, else "". */
function roomNear(world: World, levelIndex: number, i: number): string {
  const level = world.levels[levelIndex]
  const room = level.rooms[level.roomOf[i]]
  return room ? ` (${room.name})` : ''
}
