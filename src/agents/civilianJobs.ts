// Civilian jobs beyond the daily routine: engineers repairing generators (and waiting for cover), barricading the shelter, grabbing a pistol and shooting back.

import { CONFIG } from '../config.ts'
import { roomAt, sameRoom } from '../world/rooms.ts'
import { isHidden } from '../systems/camouflage.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canSee } from './perception.ts'
import { isRanged, nearestVisible, tryAttack } from './combat.ts'
import { stockIn, take } from '../systems/supplies.ts'
import { buildSeconds, putBarrier, roomOpenings } from '../systems/barriers.ts'
import { Tile } from '../world/tiles.ts'
import { logEvent } from '../core/events.ts'
import { damagedGenerators, humanSight, repairGenerator, type Generator } from '../systems/power.ts'
import { makeWeapon } from './combat.ts'
import { type CivilianData, type CivilianContext, isFree, walkTo } from './civilian.ts'

const TPS = CONFIG.sim.ticksPerSecond

/**
 * Hold back from a knocked-out generator while Myrr are in sight in its room, or
 * while an escort squad is coming, until soldiers are close (or for maxSeconds).
 */
export function waitForCover(agent: Agent, civ: CivilianData, gen: Generator, ctx: CivilianContext): boolean {
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
export function repair(agent: Agent, gen: Generator, ctx: CivilianContext): void {
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
export function generatorToRepair(agent: Agent, ctx: CivilianContext): Generator | null {
  for (const gen of damagedGenerators(ctx.power)) {
    if (agent.civ!.activity === 'repair' && sameRoom(agent.civ!.target, gen.room)) return gen
    const crew = ctx.agents.filter((a) => a !== agent && !a.dead && a.civ?.activity === 'repair' && isFree(a) && sameRoom(a.civ.target, gen.room)).length
    if (crew < CONFIG.power.repairCrew) return gen
  }
  return null
}

/** Openings of the room they're hiding in that have no barrier yet (indoor rooms only). */
export function planFortify(agent: Agent, ctx: CivilianContext): NonNullable<CivilianData['fortify']> {
  const room = roomAt(ctx.world, tileOf(agent))
  if (!room || room.room.outdoor || room.room.type === 'hive') return []
  const level = ctx.world.levels[agent.levelIndex]
  return roomOpenings(ctx.world, room).filter((o) => level.barrier[o.tile] <= 0)
}

/** Walk to the next opening and put up a barricade (doors) or boards (windows). */
export function fortifyStep(agent: Agent, civ: CivilianData, ctx: CivilianContext): void {
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

/** Take a pistol (and a couple of magazines) from the room, if it has one. Low skill. */
export function tryArm(agent: Agent, ctx: CivilianContext): void {
  if (agent.weapon && isRanged(agent.weapon)) return
  const stock = stockIn(ctx.supplies, roomAt(ctx.world, tileOf(agent)))
  if (!stock || take(stock, 'pistols', 1) === 0) return
  agent.weapon = makeWeapon('pistol', CONFIG.combat.skill.civilian)
  agent.weapon.spare = take(stock, 'pistolMags', CONFIG.supplies.civilianMags)
}

export function shootBack(agent: Agent, ctx: CivilianContext): void {
  const range = CONFIG.combat.weapons[agent.weapon!.kind].range
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks !== 0 && agent.weapon!.cooldown > 0) return
  const target = nearestVisible(agent, ctx, range, (a) => a.side === 'myrr')
  if (target) tryAttack(agent, target, ctx)
}
