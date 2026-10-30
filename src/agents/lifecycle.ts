// The hive's life cycle:
//
//   captive ─▶ Brood Mother injects ─▶ cocooned (infected) ─▶ Broodling bursts out
//   Broodling grows in the hive ─▶ becomes a Taker or a Spineback, by what the hive needs.
//
// The infection belongs to the person: if soldiers cut them free, it keeps
// ticking wherever they go until a medic stabilizes them or the med bay cures them.
// Spinebacks guard the hive: one stays with the Brood Mother, the rest hide in
// the resin by the cocoons (the hive's food), so rescuers walk into ambushes.
// They kill humans who come near, and answer alarm scent wherever it goes up. Spare Spinebacks go raiding: they hunt
// and carry people home like Takers, and only kill when they must.

import { updateStakeout } from './landing.ts'
import { CONFIG } from '../config.ts'
import { canWalk, findPath } from '../world/pathfinding.ts'
import { findRooms, roomAt, sameRoom } from '../world/rooms.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { createAgent, tileOf, type Agent } from './agent.ts'
import { isFree, setMode } from './civilian.ts'
import { followPath, isMoving } from './movement.ts'
import { createMyrrData, updateTaker, type HiveContext, type MyrrData } from './myrr.ts'
import { makeWeapon, nearestVisible, tryAttack, type CombatContext } from './combat.ts'
import { strongest } from '../systems/pheromones.ts'
import { logEvent } from '../core/events.ts'
import { who } from './describe.ts'
import { kill } from './combat.ts'
import { isHidden } from '../systems/camouflage.ts'
import { makeNoise } from '../systems/noise.ts'
import { choose, ramp, scoreList, type Option } from '../core/utility.ts'

const TPS = CONFIG.sim.ticksPerSecond
const L = CONFIG.lifecycle

/** A Spineback doing one of these is out raiding (run by the Taker brain). */
const RAID_TASKS = new Set(['rest', 'scout', 'return', 'hunt', 'attack', 'carry', 'swarm'])

// ---------------------------------------------------------------- Brood Mother

/**
 * The Brood Mother is rooted in her chamber, injecting captives one at a time.
 * She bites anyone who comes within reach. Intruders in the hive core make her
 * uproot (slow) and hunt them; when the hive core is quiet again she goes home
 * and roots herself again.
 *
 * Badly threatened in the Hive Core, she uproots and retreats to her hidden Deep
 * Chamber (her guards pull back with her) and roots there. Threatened again there,
 * she burrows into the deep rock: if nobody kills her first, she escapes.
 */
export function updateMother(mother: Agent, ctx: HiveContext & CombatContext): void {
  const m = mother.myrr!
  const { hive } = ctx
  const check = ctx.tick % CONFIG.perception.intervalTicks === 0

  bite(mother, ctx)
  if (check) considerRecall(mother, ctx)

  if (!hive.escapeTo && m.task !== 'burrow' && check && badlyThreatened(mother, ctx)) {
    if (!hive.retreated && hive.deepHome) {
      // First time: pull back to the Deep Chamber.
      hive.escapeTo = hive.deepHome
      logEvent(ctx, 'hive', m.rooted
        ? 'The Brood Mother is tearing herself free to retreat to her Deep Chamber'
        : 'The Brood Mother is retreating to her Deep Chamber with her guards')
      if (m.rooted && m.task !== 'uproot') startUproot(m)
      // Already loose (hunting): drop the hunt and go.
      if (!m.rooted) { mother.path = []; mother.state = { name: 'idle', ticksLeft: 0 } }
    } else if (intruder(mother, ctx)) {
      // Already in the Deep Chamber and they followed her in: dig away.
      startBurrow(mother, ctx)
    }
  }
  if (m.task === 'burrow') {
    // Digging herself down into the deep rock: kill her before she's gone.
    if (--m.ticksLeft <= 0) hive.escaped = true
    return
  }
  if (m.rooted && m.task === 'uproot') return uproot(mother, ctx)
  if (hive.escapeTo) {
    // Badly wounded, she drags herself along: down to woundedFleeShare of her flee speed.
    const fit = mother.health / mother.maxHealth
    mother.baseSpeed = mother.speed = L.motherFleeSpeed * (L.woundedFleeShare + (1 - L.woundedFleeShare) * fit)
    return flee(mother, ctx)
  }
  if (!m.rooted) return roam(mother, ctx)

  // Rooted: intruders in the hive core make her tear free to fight them.
  if (check && m.task !== 'inject' && intruder(mother, ctx)) {
    startUproot(m)
    logEvent(ctx, 'hive', 'The Brood Mother is uprooting herself to deal with the intruders')
    return
  }

  if (m.task === 'inject') {
    if (--m.ticksLeft > 0) return
    const captive = ctx.agents[m.targetId]
    hive.captives = hive.captives.filter((id) => id !== m.targetId)
    if (captive?.civ && captive.civ.mode === 'captive') cocoon(captive, ctx)
    m.task = 'rest'
    m.targetId = -1
    return
  }

  // Next in line: the oldest captive still held in the hive.
  const next = hive.captives.find((id) => ctx.agents[id]?.civ?.mode === 'captive')
  if (next === undefined) return
  m.task = 'inject'
  m.targetId = next
  m.ticksLeft = Math.round(L.injectSeconds * TPS)
}

/**
 * Keep laying, or call the raiders home? Scored (CONFIG.utility.mother): laying has a
 * fixed score; recalling grows with the threat (free humans in her chamber, her lost
 * health). If recalling wins, she shrieks and every raiding Spineback not carrying
 * someone drops what it's doing and comes back to guard.
 */
function considerRecall(mother: Agent, ctx: HiveContext): void {
  const U = CONFIG.utility.mother
  const hive = ctx.hive
  const m = mother.myrr!
  if (ctx.tick - hive.lastRecallTick < U.recallCooldownSeconds * TPS) return
  const raiders = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && RAID_TASKS.has(a.myrr.task) && a.myrr.task !== 'carry')
  if (!raiders.length) return
  const threat = Math.max(ramp(intruderCount(ctx), ...U.intruders), 1 - mother.health / mother.maxHealth)
  const options: Option<'lay' | 'recall'>[] = [{ action: 'lay', score: U.lay }, { action: 'recall', score: U.recall * threat }]
  const pick = choose(options)?.action ?? 'lay'
  m.lastChoice = `${pick} (${scoreList(options)})`
  if (pick !== 'recall') return
  hive.lastRecallTick = ctx.tick
  for (const a of raiders) {
    a.myrr!.task = 'guard'
    a.myrr!.targetId = -1
    a.myrr!.swarmHunt = false
    a.path = []
    a.state = { name: 'idle', ticksLeft: 0 }
  }
  makeNoise(ctx.noises, 'screech', mother.levelIndex, mother.x, mother.y, ctx.tick, mother.id)
  logEvent(ctx, 'hive', `The Brood Mother shrieks: ${raiders.length} raiding Spineback${raiders.length === 1 ? ' comes' : 's come'} home to guard (${scoreList(options)})`)
}

/** Free humans in her room. */
export function intruderCount(ctx: HiveContext): number {
  const home = ctx.hive.motherHome
  const room = (home && roomAt(ctx.world, home)) || findRooms(ctx.world, ['hive'])[0]
  if (!room) return 0
  return ctx.agents.filter((a) => !a.dead && a.side === 'human' && a.kind !== 'turret' && isFree(a) && a.levelIndex === room.levelIndex &&
    sameRoom(roomAt(ctx.world, tileOf(a)), room)).length
}

function addBroodling(at: PathNode, ctx: HiveContext): void {
  const brood = createAgent(ctx.agents.length, 'broodling', 'myrr', at, CONFIG.movement.myrrSpeed * 0.5, CONFIG.health.broodling)
  brood.myrr = createMyrrData('broodling')
  brood.myrr.task = 'grow'
  brood.myrr.home = at
  brood.myrr.ticksLeft = Math.round(L.growSeconds * TPS)
  ctx.agents.push(brood)
}

/** Last resort: burrow into the deep rock (the Escape ending if she finishes). */
function startBurrow(mother: Agent, ctx: HiveContext): void {
  const m = mother.myrr!
  m.task = 'burrow'
  m.targetId = -1
  m.ticksLeft = Math.round(L.burrowSeconds * TPS)
  mother.path = []
  mother.state = { name: 'idle', ticksLeft: 0 }
  ctx.hive.escapeTo = null
  logEvent(ctx, 'hive', 'The Brood Mother is burrowing into the deep rock to escape!')
}

function startUproot(m: MyrrData): void {
  m.task = 'uproot'
  m.targetId = -1
  m.ticksLeft = Math.round(L.uprootSeconds * TPS)
}

/** Tearing free of the chamber floor. She can bite but not move until it's done. */
function uproot(mother: Agent, ctx: HiveContext): void {
  const m = mother.myrr!
  // Calmed down: the intruders are gone and she isn't fleeing.
  if (!ctx.hive.escapeTo && ctx.tick % CONFIG.perception.intervalTicks === 0 && !intruder(mother, ctx)) {
    m.task = 'rest'
    return
  }
  if (--m.ticksLeft > 0) return
  m.rooted = false
  m.task = 'hunt'
  m.lastSeenTick = ctx.tick
  mother.baseSpeed = mother.speed = L.motherSpeed
  if (!ctx.hive.escapeTo) logEvent(ctx, 'hive', 'The Brood Mother has torn free and is hunting the intruders')
}

/** Uprooted: hunt intruders in the hive core, then go home and root again. */
function roam(mother: Agent, ctx: HiveContext): void {
  const m = mother.myrr!
  if (m.task === 'root') {
    if (--m.ticksLeft > 0) return
    m.rooted = true
    m.task = 'rest'
    mother.baseSpeed = mother.speed = 0
    return
  }
  if (ctx.tick % CONFIG.perception.intervalTicks === 0) {
    const foe = intruder(mother, ctx)
    m.targetId = foe ? foe.id : -1
    if (foe) { m.lastSeenTick = ctx.tick; m.task = 'hunt' }
  }
  const target = m.targetId >= 0 ? ctx.agents[m.targetId] : null
  if (target && !target.dead) {
    if (ctx.tick >= m.repathTick) {
      m.repathTick = ctx.tick + TPS
      const path = findPath(ctx.world, tileOf(mother), tileOf(target), 'human')
      if (path?.length) { mother.path = path; mother.state = { name: 'moving' } }
    }
    followPath(mother, ctx.world)
    return
  }
  if (ctx.tick - m.lastSeenTick < L.motherCalmSeconds * TPS) return
  // Quiet: walk home, then root herself again.
  const home = ctx.hive.motherHome
  if (!home || (Math.floor(mother.x) === home.x && Math.floor(mother.y) === home.y && mother.levelIndex === home.levelIndex)) {
    m.task = 'root'
    m.ticksLeft = Math.round(L.rerootSeconds * TPS)
    mother.path = []
    mother.state = { name: 'idle', ticksLeft: 0 }
    return
  }
  if (m.task !== 'return' || mother.state.name !== 'moving') {
    m.task = 'return'
    const path = findPath(ctx.world, tileOf(mother), home, 'human')
    if (path?.length) { mother.path = path; mother.state = { name: 'moving' } }
    else { m.task = 'root'; m.ticksLeft = Math.round(L.rerootSeconds * TPS) }
  }
  if (mother.state.name === 'moving') followPath(mother, ctx.world)
}

/** Nearest free human (or turret) inside the hive core, if any. */
function intruder(mother: Agent, ctx: HiveContext): Agent | null {
  // Her room: the Hive Core, or the Deep Chamber once she has retreated there.
  const home = ctx.hive.motherHome
  const core = (home && roomAt(ctx.world, home)) || findRooms(ctx.world, ['hive'])[0]
  if (!core) return null
  let best: Agent | null = null, bestD = Infinity
  for (const a of ctx.agents) {
    if (a.dead || a.side !== 'human' || a.levelIndex !== core.levelIndex || !(isFree(a) || a.kind === 'turret')) continue
    if (!sameRoom(roomAt(ctx.world, tileOf(a)), core)) continue
    const d = Math.hypot(a.x - mother.x, a.y - mother.y)
    if (d < bestD) { best = a; bestD = d }
  }
  return best
}

/** Bite the nearest human (or turret) in reach, rooted or not. */
function bite(mother: Agent, ctx: CombatContext): void {
  const foe = nearestVisible(mother, ctx, CONFIG.combat.weapons.maw.range, (a) => a.side === 'human' && (isFree(a) || a.kind === 'turret'))
  if (foe) tryAttack(mother, foe, ctx)
}

/** Infect and wrap a captive in a cocoon where they lie; a Taker will carry it to the nursery (nest.ts). */
function cocoon(captive: Agent, ctx: HiveContext): void {
  const civ = captive.civ!
  setMode(captive, civ, 'cocooned')
  civ.infection = { hatchTick: ctx.tick + Math.round(L.incubationSeconds * TPS), stabilizedUntilTick: 0 }
  captive.state = { name: 'idle', ticksLeft: 1e9 }
  ctx.hive.unplaced.push(captive.id)
  logEvent(ctx, 'injected', `${who(captive)} was injected and cocooned in the hive`)
}

/** Humans in the hive core and few guards left, or the Brood Mother badly hurt. */
function badlyThreatened(mother: Agent, ctx: HiveContext): boolean {
  if (mother.health < mother.maxHealth * L.fleeBelowHealth) return true
  // Free humans only: captives and cocoons lying in the hive don't count.
  const intruders = ctx.agents.filter((a) => !a.dead && isFree(a) && a.levelIndex === mother.levelIndex &&
    Math.hypot(a.x - mother.x, a.y - mother.y) <= L.guardRadius + 4).length
  const guards = ctx.agents.filter((a) => !a.dead && a.kind === 'spineback').length
  // Unguarded, she still fights until she has taken some real damage.
  return intruders >= 2 && guards < L.fleeWhenGuardsBelow && mother.health < mother.maxHealth * L.fleeUnguardedBelowHealth
}

/** The reachable Level 3 tile farthest from the hive core: the deep tunnels. */
/** Retreating to the Deep Chamber; once there she roots herself again. */
function flee(mother: Agent, ctx: HiveContext): void {
  const to = ctx.hive.escapeTo!
  if (mother.state.name === 'moving' || mother.state.name === 'crossing') {
    if (followPath(mother, ctx.world)) arriveDeep(mother, ctx)
    return
  }
  // She is far too big for vent ducts or chutes: open tunnels only (the routes humans can use).
  const path = findPath(ctx.world, tileOf(mother), to, 'human')
  if (path?.length) { mother.path = path; mother.state = { name: 'moving' } }
  else startBurrow(mother, ctx) // cut off: dig in where she is
}

function arriveDeep(mother: Agent, ctx: HiveContext): void {
  const hive = ctx.hive
  hive.escapeTo = null
  hive.retreated = true
  hive.motherHome = hive.deepHome
  const m = mother.myrr!
  m.task = 'root'
  m.ticksLeft = Math.round(L.rerootSeconds * TPS)
  mother.path = []
  mother.state = { name: 'idle', ticksLeft: 0 }
  logEvent(ctx, 'hive', 'The Brood Mother has reached her Deep Chamber')
}

/** With the Brood Mother dead: Broodlings die at once; the rest weaken until they die. */
export function updateCollapse(ctx: CombatContext): void {
  if (!ctx.hive.collapsing) return
  for (const a of ctx.agents) {
    if (a.dead || a.side !== 'myrr') continue
    if (a.kind === 'broodling') { kill(a, ctx); continue }
    a.health -= L.collapseDecayPerSecond / TPS
    if (a.health <= 0) kill(a, ctx)
  }
}

// ---------------------------------------------------------------- infections

/** Hatch infections whose time is up, wherever the host is. */
export function updateInfections(ctx: HiveContext): void {
  const count = ctx.agents.length
  for (let i = 0; i < count; i++) {
    const host = ctx.agents[i]
    const inf = host.civ?.infection
    if (!inf || host.dead || inf.hatchTick > ctx.tick) continue
    host.civ!.infection = null
    host.civ!.mode = 'dead'
    host.civ!.deathCause = 'hatched'
    host.dead = true
    host.health = 0
    addBroodling(tileOf(host), ctx)
    ctx.hive.hatched++
    ctx.stats.hatched++
    logEvent(ctx, 'hatch', `A Broodling burst out of ${who(host).toLowerCase()} on Level ${host.levelIndex + 1}`)
  }
}

// ---------------------------------------------------------------- Broodlings

/**
 * Crawl about where it hatched while growing (Spinebacks come to guard it there),
 * then turn into what the hive needs.
 */
export function updateBroodling(agent: Agent, ctx: HiveContext): void {
  const m = agent.myrr!
  if (--m.ticksLeft <= 0) return growUp(agent, ctx)
  if (agent.state.name === 'moving' || agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }
  if (ctx.rng.chance(1 / (3 * TPS))) wanderNearHome(agent, ctx)
}

function growUp(agent: Agent, ctx: HiveContext): void {
  const role = whatTheHiveNeeds(ctx)
  agent.kind = role
  agent.baseSpeed = agent.speed = CONFIG.movement.myrrSpeed
  agent.health = agent.maxHealth = role === 'taker' ? CONFIG.health.taker : CONFIG.health.spineback
  agent.weapon = makeWeapon(role === 'taker' ? 'claws' : 'spines', CONFIG.combat.skill.myrr)
  agent.myrr = createMyrrData(role)
  agent.myrr.task = role === 'taker' ? 'rest' : 'guard'
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 0 }
}

/**
 * Spineback if the hive has fewer than its target share of them (raised by
 * Spineback losses), otherwise Taker.
 */
export function whatTheHiveNeeds(ctx: HiveContext): 'taker' | 'spineback' {
  let takers = 0, spinebacks = 0
  for (const a of ctx.agents) {
    if (a.dead) continue
    if (a.kind === 'taker') takers++
    else if (a.kind === 'spineback') spinebacks++
  }
  const want = Math.min(0.8, L.spinebackShare + L.lossBias * ctx.hive.losses.spineback)
  const share = spinebacks / Math.max(1, takers + spinebacks)
  return share < want ? 'spineback' : 'taker'
}

// ---------------------------------------------------------------- Spinebacks

/**
 * Guard a post (the Brood Mother, or a cocoon) and attack any human who comes near
 * it. When alarm scent goes up somewhere, all but `minGuards` Spinebacks go there
 * to fight, then return.
 */
export function updateSpineback(agent: Agent, ctx: CombatContext): void {
  const m = agent.myrr!
  // Raiding: hunt and carry people home, like a Taker (only stronger).
  if (RAID_TASKS.has(m.task)) return updateTaker(agent, ctx)
  if (m.task === 'stakeout') return updateStakeout(agent, ctx)
  const post = guardPost(agent, ctx)
  const chaseRange = L.guardRadius + 10
  const responding = m.task === 'respond'

  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0) {
    // Guards only chase intruders near their post; responders fight anyone they see.
    const foe = nearestVisible(agent, ctx, CONFIG.hive.sightRange, (a) =>
      a.side === 'human' && (isFree(a) || a.kind === 'turret') && (responding || (!!post.at && a.levelIndex === post.at.levelIndex &&
      Math.hypot(a.x - post.at.x, a.y - post.at.y) <= chaseRange)))
    m.targetId = foe ? foe.id : -1
    if (foe) m.lastSeenTick = ctx.tick
    if (!responding && !foe) answerAlarm(agent, ctx)
  }

  const target = m.targetId >= 0 ? ctx.agents[m.targetId] : null
  if (target && !target.dead && (isFree(target) || target.kind === 'turret')) {
    if (tryAttack(agent, target, ctx)) return
    // Ambush: a guard hidden in the resin keeps still until the human comes close.
    if (!responding && isHidden(agent, ctx.world.levels[agent.levelIndex]) &&
      Math.hypot(target.x - agent.x, target.y - agent.y) > CONFIG.camouflage.ambushRange) return
    if (ctx.tick >= m.repathTick) {
      m.repathTick = ctx.tick + TPS
      const path = findPath(ctx.world, tileOf(agent), tileOf(target), 'myrr')
      if (path?.length) { agent.path = path; agent.state = { name: 'moving' } }
    }
    if (agent.state.name === 'moving' || agent.state.name === 'crossing') followPath(agent, ctx.world)
    return
  }
  m.targetId = -1

  if (isMoving(agent)) {
    followPath(agent, ctx.world)
    return
  }
  if (responding) {
    // At the alarm and nobody to fight for a while: go back to guarding.
    if (ctx.tick - m.lastSeenTick > L.alarmGiveUpSeconds * TPS) m.task = 'guard'
    else return
  }
  // Spare guards go raiding (the hive needs hosts), as long as the Brood Mother is safe.
  if (m.task === 'guard' && !ctx.hive.escapeTo && ctx.rng.chance(1 / (CONFIG.spinebacks.raidEverySeconds * TPS))) {
    const guards = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && a.myrr.task === 'guard').length
    if (guards > CONFIG.spinebacks.homeGuards) {
      m.task = 'rest'
      m.ticksLeft = 1
      return
    }
  }
  const far = post.at && (agent.levelIndex !== post.at.levelIndex || Math.hypot(post.at.x - agent.x, post.at.y - agent.y) > post.radius + 0.5)
  if (far || ctx.rng.chance(1 / (L.guardWanderSeconds * TPS))) guardSpot(agent, post, ctx)
}

/**
 * What this guard watches over: the first `motherGuards` guards (and everyone while
 * she flees) stay with the Brood Mother; the rest are shared out among the cocoons
 * and the Broodlings growing where they hatched.
 */
function guardPost(agent: Agent, ctx: HiveContext): { at: Agent | null; radius: number } {
  const mother = ctx.agents[ctx.hive.motherId]
  const home = { at: mother && !mother.dead ? mother : null, radius: L.guardRadius }
  if (ctx.hive.escapeTo) return home
  const guards = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && a.myrr.task === 'guard')
  const i = guards.indexOf(agent)
  if (i < L.motherGuards) return home
  const young = ctx.agents.filter((a) => !a.dead && (a.civ?.mode === 'cocooned' || a.kind === 'broodling'))
  if (!young.length) return home
  return { at: young[(i - L.motherGuards) % young.length], radius: L.cocoonGuardRadius }
}

/** Go to the strongest alarm, if it's loud enough and enough guards stay behind. */
function answerAlarm(agent: Agent, ctx: CombatContext): void {
  const alarm = strongest(ctx.pheromones, 'alarm', ctx.world, 8, CONFIG.pheromones.alarmRespond).find(({ at }) =>
    (at.levelIndex === agent.levelIndex || at.levelIndex === agent.levelIndex - 1) &&
    Math.hypot(at.x - agent.x, at.y - agent.y) <= CONFIG.pheromones.alarmRange)
  if (!alarm) return
  const guards = ctx.agents.filter((a) => !a.dead && a.myrr?.role === 'spineback' && a.myrr.task === 'guard').length
  if (guards <= L.minGuards) return
  const path = findPath(ctx.world, tileOf(agent), alarm.at, 'myrr')
  if (!path?.length) return
  const m = agent.myrr!
  m.task = 'respond'
  m.lastSeenTick = ctx.tick // give up after alarmGiveUpSeconds with nobody found
  agent.path = path
  agent.state = { name: 'moving' }
}

/** Walk to a spot near the post, on resin if there is any (to hide there). */
function guardSpot(agent: Agent, post: { at: Agent | null; radius: number }, ctx: HiveContext): void {
  if (!post.at) return
  const level = ctx.world.levels[post.at.levelIndex]
  const cx = Math.floor(post.at.x), cy = Math.floor(post.at.y), r = Math.floor(post.radius)
  const spots: PathNode[] = []
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy
      if ((dx || dy) && Math.hypot(dx, dy) <= post.radius && canWalk(level, x, y, 'myrr')) spots.push({ levelIndex: post.at.levelIndex, x, y })
    }
  const onResin = spots.filter((p) => level.resin[p.y * level.width + p.x] > 0)
  const pool = onResin.length ? onResin : spots
  const goal = pool.length ? ctx.rng.pick(pool) : tileOf(post.at)
  const path = findPath(ctx.world, tileOf(agent), goal, 'myrr')
  if (path?.length) {
    agent.path = path
    agent.state = { name: 'moving' }
  }
}

/** A short crawl to a spot within broodlingRoam tiles of where it hatched. */
function wanderNearHome(agent: Agent, ctx: HiveContext): void {
  const home = agent.myrr!.home ?? tileOf(agent)
  const level = ctx.world.levels[home.levelIndex]
  const r = L.broodlingRoam
  for (let tries = 0; tries < 10; tries++) {
    const x = home.x + ctx.rng.int(-r, r), y = home.y + ctx.rng.int(-r, r)
    if (!canWalk(level, x, y, 'myrr')) continue
    const path = findPath(ctx.world, tileOf(agent), { levelIndex: home.levelIndex, x, y }, 'myrr')
    if (!path?.length) continue
    agent.path = path
    agent.state = { name: 'moving' }
    return
  }
}
