// Takers hunting: choosing the next job, finding lone prey, clawing, stinging, carrying them home and handing them to the Brood Mother.

import { CONFIG } from '../config.ts'
import { depositTrail } from '../systems/pheromones.ts'
import { resinFrontier } from '../systems/resin.ts'
import { tileOf, type Agent } from './agent.ts'
import { logEvent } from '../core/events.ts'
import { who } from './describe.ts'
import { canSee } from './perception.ts'
import { callSwarm } from './swarm.ts'
import { isFree, setMode } from './civilian.ts'
import { isRanged, type CombatContext } from './combat.ts'
import { pickWeighted as pickByScore, ramp, scoreList, type Option } from '../core/utility.ts'
import { nextScoutTrip, goHome, rest, goTo, nearMother, weakenScent } from './myrr.ts'
import { type MyrrData, type HiveContext } from './myrrData.ts'

const TPS = CONFIG.sim.ticksPerSecond
const H = CONFIG.hive

export type Job = 'scout' | 'spread' | 'sabotage' | 'commander'

/**
 * Rested: what next? Each job gets a utility score from what the hive knows, and
 * one is picked at random, better scores more likely (see core/utility.ts):
 *
 *   scout      find prey; scores higher the hungrier the hive (few captives and cocoons)
 *   spread     coat more resin (Takers); scores lower as the resin nears its limit
 *   sabotage   knock out a generator (Takers), once the humans have killed Myrr;
 *              more losses and more turrets (they need power) make it more attractive
 *   commander  go looking for the Commander, once the humans have killed Myrr;
 *              less attractive while the command squad is at full strength
 *
 * A Myrr shot recently is shaken: sabotage and the Commander hunt score lower until it calms down.
 */
export function chooseNextJob(agent: Agent, m: MyrrData, ctx: CombatContext): void {
  const U = CONFIG.utility.taker
  const hive = ctx.hive
  const losses = hive.losses.taker + hive.losses.spineback
  const fought = ramp(losses, CONFIG.power.sabotageAfterLosses - 1, U.lossesFull)
  // Shot recently: risky jobs look worse until it has calmed down.
  const nerve = ramp(ctx.tick - m.shotTick, 0, U.shakenSeconds * TPS)
  const fed = ctx.agents.filter((a) => a.civ?.mode === 'cocooned').length + hive.captives.length
  const options: Option<Job>[] = [{ action: 'scout', score: U.scoutBase + U.scoutHunger * (1 - ramp(fed, 0, U.fullAt)) }]
  const working = ctx.power.generators.filter((g) => !g.broken)
  if (m.role === 'taker') {
    if (hive.resinTiles < CONFIG.resin.maxTiles) options.push({ action: 'spread', score: U.spreadBase * (1 - ramp(hive.resinTiles, 0, CONFIG.resin.maxTiles)) })
    if (working.length && fought > 0) {
      const turrets = ctx.agents.filter((a) => a.kind === 'turret' && !a.dead).length
      options.push({ action: 'sabotage', score: (U.sabotageMax * fought + U.turretBonus * ramp(turrets, 0, 3)) * nerve })
    }
  }
  const boss = ctx.agents.find((a) => a.kind === 'commander' && !a.dead && isFree(a))
  if (boss && fought > 0) {
    const guards = ctx.agents.filter((a) => a.soldier && !a.dead && isFree(a) && a.levelIndex === boss.levelIndex && Math.hypot(a.x - boss.x, a.y - boss.y) <= CONFIG.commander.guardRange).length
    options.push({ action: 'commander', score: U.commanderMax * fought * (guards >= CONFIG.commander.guardSquadSize ? H.guardedCommanderScale : 1) * nerve })
  }
  const pick = pickByScore(options, ctx.rng, CONFIG.utility.sharpness)?.action ?? 'scout'
  m.lastChoice = `${pick} (${scoreList(options)})`

  if (pick === 'sabotage') {
    const gen = ctx.rng.pick(working)
    if (goTo(agent, ctx, gen.at)) { m.task = 'sabotage'; m.targetId = ctx.power.generators.indexOf(gen); return }
  } else if (pick === 'spread') {
    const spot = resinFrontier(ctx.world, agent.levelIndex, ctx.rng)
    if (spot && goTo(agent, ctx, spot)) { m.task = 'spread'; return }
  } else if (pick === 'commander' && boss && goTo(agent, ctx, tileOf(boss))) {
    // Head for the Commander's position (they'll be guarded: expect a swarm). One look, then home.
    m.task = 'scout'
    m.trips = H.tripsBeforeReturn - 1
    return
  }
  m.task = 'scout'
  m.trips = 0
  nextScoutTrip(agent, m, ctx)
}

/** Spot free humans; lay scent where they are; hunt the closest one who is alone. */
export function lookForPrey(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const level = ctx.world.levels[agent.levelIndex]
  const range = H.sightRange
  let best: Agent | null = null
  let bestDist = Infinity
  const scentPerLook = CONFIG.pheromones.sighting * (CONFIG.perception.intervalTicks / TPS)

  const spine = m.role === 'spineback'
  const groupSize = spine ? CONFIG.spinebacks.groupSize : H.groupSize
  let crowded = false
  for (const human of ctx.agents) {
    if (human.dead || !isFree(human) || human.levelIndex !== agent.levelIndex || human.kind === 'turret') continue
    const dist = Math.hypot(human.x - agent.x, human.y - agent.y)
    if (dist > range || !canSee(agent, human, level, range)) continue
    // Armed humans: a Taker alone is weak in a straight fight, so it calls a swarm or goes home.
    // Spinebacks (and swarms) take them on.
    if (human.weapon && isRanged(human.weapon) && !spine && !m.swarmHunt) {
      if (m.task !== 'hunt' && callSwarm(agent, ctx)) return
      // Not worth it here: wipe out the prey scent around this spot so scouts look elsewhere.
      weakenScent(ctx, tileOf(agent), H.armedPreyScent.radius, H.armedPreyScent.keep)
      if (m.task !== 'return' && m.task !== 'rest') goHome(agent, m, ctx)
      return
    }
    depositTrail(ctx.pheromones, ctx.world, human.levelIndex, human.x, human.y, scentPerLook)
    if (m.task === 'hunt' && human.id === m.targetId) m.lastSeenTick = ctx.tick
    if (companions(human, ctx) >= groupSize && !m.swarmHunt) { crowded = true; continue } // too many of them
    if (human.id === m.ignoreId && ctx.tick < m.ignoreUntilTick) continue // gave up on this one
    if (dist < bestDist) { best = human; bestDist = dist }
  }

  if (m.task === 'hunt') {
    const target = ctx.agents[m.targetId]
    if (target && companions(target, ctx) >= groupSize && !m.swarmHunt) giveUp(agent, m, ctx)
    return
  }
  // Only groups in sight: call the others in.
  if (!best && crowded && callSwarm(agent, ctx)) return
  if (best) {
    m.task = 'hunt'
    m.targetId = best.id
    m.lastSeenTick = ctx.tick
    m.repathTick = ctx.tick
    m.huntStartTick = ctx.tick
  }
}

/** Free humans within `loneRadius` of this one. */
function companions(human: Agent, ctx: HiveContext): number {
  let n = 0
  for (const other of ctx.agents) {
    if (other === human || !isFree(other) || other.levelIndex !== human.levelIndex) continue
    if (Math.hypot(other.x - human.x, other.y - human.y) <= H.loneRadius) n++
  }
  return n
}

/** Paralyse a weakened human. */
export function sting(target: Agent, ctx: HiveContext): void {
  const civ = target.civ!
  setMode(target, civ, 'paralyzed')
  civ.paralyzedUntilTick = ctx.tick + Math.round(H.paralysisSeconds * TPS)
  target.path = []
  target.state = { name: 'idle', ticksLeft: 1e9 }
}

export function capture(agent: Agent, m: MyrrData, target: Agent, ctx: HiveContext): void {
  ctx.stats.captures++
  // Did anyone see it? If not, the colony only notices when they go missing.
  const level = ctx.world.levels[agent.levelIndex]
  target.civ!.takenTick = ctx.tick
  target.civ!.takenSeen = ctx.agents.some((h) => h !== target && isFree(h) && h.levelIndex === agent.levelIndex &&
    canSee(h, agent, level, CONFIG.perception.sightRange))
  logEvent(ctx, 'capture', `${who(target)} was taken by a ${agent.kind === 'spineback' ? 'Spineback' : 'Taker'} on Level ${agent.levelIndex + 1}`, target)
  target.civ!.mode = 'captured'
  target.path = []
  target.state = { name: 'idle', ticksLeft: 1e9 }
  target.speed = target.baseSpeed
  depositTrail(ctx.pheromones, ctx.world, agent.levelIndex, agent.x, agent.y, CONFIG.pheromones.capture)

  m.task = 'carry'
  m.swarmHunt = false
  m.lastTrailTile = -1
  agent.speed = agent.baseSpeed * (m.role === 'spineback' ? CONFIG.spinebacks.carrySpeedMultiplier : H.carrySpeedMultiplier)
  if (!goTo(agent, ctx, nearMother(ctx))) agent.path = []
}

/** Keep the carried human with the Taker. */
export function carryAlong(agent: Agent, ctx: HiveContext): void {
  const m = agent.myrr!
  if (m.task !== 'carry') return
  const captive = ctx.agents[m.targetId]
  if (!captive) return
  captive.levelIndex = agent.levelIndex
  captive.x = agent.x
  captive.y = agent.y
}

/** Lay scent on each new tile on the way home with prey. */
export function layTrail(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const level = ctx.world.levels[agent.levelIndex]
  const tile = agent.levelIndex * level.width * level.height + Math.floor(agent.y) * level.width + Math.floor(agent.x)
  if (tile === m.lastTrailTile) return
  m.lastTrailTile = tile
  depositTrail(ctx.pheromones, ctx.world, agent.levelIndex, agent.x, agent.y, CONFIG.pheromones.carryTrail)
}

export function deliver(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  const captive = ctx.agents[m.targetId]
  const mother = ctx.agents[ctx.hive.motherId]
  // Not home yet (e.g. the first route failed): try again.
  if (mother && !mother.dead && (agent.levelIndex !== mother.levelIndex || Math.hypot(mother.x - agent.x, mother.y - agent.y) > H.deliverRange)) {
    if (goTo(agent, ctx, nearMother(ctx))) return
  }
  // A captive that hatched on the way is already dead: nothing to hand over.
  if (captive?.civ && !captive.dead) {
    captive.civ.mode = 'captive'
    const spot = nearMother(ctx)
    captive.levelIndex = spot.levelIndex
    captive.x = spot.x + 0.5
    captive.y = spot.y + 0.5
    ctx.hive.captives.push(captive.id)
  }
  m.targetId = -1
  agent.speed = agent.baseSpeed
  rest(agent, m, ctx)
}

export function giveUp(agent: Agent, m: MyrrData, ctx: HiveContext): void {
  m.ignoreId = m.targetId
  m.ignoreUntilTick = ctx.tick + Math.round(H.ignoreSeconds * TPS)
  m.targetId = -1
  m.swarmHunt = false
  agent.speed = agent.baseSpeed
  m.task = 'scout'
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 0 }
  nextScoutTrip(agent, m, ctx)
}
