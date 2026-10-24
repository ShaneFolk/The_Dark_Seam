// Combat: weapons, attacks, damage and death. Shared by soldiers, civilians and the Myrr.

import { CONFIG } from '../config.ts'
import { makeNoise } from '../systems/noise.ts'
import { deposit, depositSpread } from '../systems/pheromones.ts'
import type { Agent } from './agent.ts'
import { canSee } from './perception.ts'
import { reveal, takeAmbush } from '../systems/camouflage.ts'
import { setMode } from './civilian.ts'
import type { HiveContext } from './myrr.ts'
import type { PowerState } from '../systems/power.ts'
import { logEvent } from '../core/events.ts'
import { who } from './describe.ts'
import { markChanged } from '../systems/resin.ts'

export type WeaponKind = keyof typeof CONFIG.combat.weapons

export interface WeaponState {
  kind: WeaponKind
  /** Chance to hit at point blank (0 to 1). */
  skill: number
  /** Rounds left in the magazine (melee weapons ignore ammo). */
  inMag: number
  /** Spare magazines. */
  spare: number
  /** Ticks until it can attack again. */
  cooldown: number
  /** Ticks left reloading (0 = not reloading). */
  reloading: number
}

/** A shot or swing, kept briefly so the renderer can draw a tracer. */
export interface Shot {
  levelIndex: number
  x0: number
  y0: number
  x1: number
  y1: number
  hit: boolean
  ranged: boolean
  /** A flamethrower burst (drawn orange). */
  flame?: boolean
  tick: number
}

/** Everything combat needs: the hive context plus the shot list and squads. */
export interface CombatContext extends HiveContext {
  shots: Shot[]
  power: PowerState
  /** Called when a soldier is hurt or killed (squad morale). */
  onSoldierHurt?: (soldier: Agent, killed: boolean) => void
  /** Called when a Myrr is hurt but not killed. */
  onMyrrHurt?: (myrr: Agent, source: Agent | null) => void
}

const TPS = CONFIG.sim.ticksPerSecond
const W = CONFIG.combat.weapons

export function makeWeapon(kind: WeaponKind, skill: number): WeaponState {
  return { kind, skill, inMag: W[kind].magazine, spare: W[kind].magazine ? CONFIG.combat.spareMagazines : 0, cooldown: 0, reloading: 0 }
}

export function isRanged(w: WeaponState): boolean {
  return W[w.kind].magazine > 0
}

/** Rounds left in total, magazine plus spares. */
export function roundsLeft(w: WeaponState): number {
  return w.inMag + w.spare * W[w.kind].magazine
}

/** Count down cooldown and reloading; start a reload when the magazine is empty. */
export function tickWeapon(w: WeaponState): void {
  if (w.cooldown > 0) w.cooldown--
  if (w.reloading > 0) {
    if (--w.reloading === 0) { w.inMag = W[w.kind].magazine; w.spare-- }
    return
  }
  if (isRanged(w) && w.inMag === 0 && w.spare > 0) w.reloading = Math.round(W[w.kind].reloadSeconds * TPS)
}

export function refill(w: WeaponState): void {
  w.inMag = W[w.kind].magazine
  w.spare = W[w.kind].magazine ? CONFIG.combat.spareMagazines : 0
  w.reloading = 0
}

/** Can this weapon reach the target right now (range and line of sight)? */
export function inReach(attacker: Agent, target: Agent, ctx: CombatContext): boolean {
  const w = attacker.weapon
  if (!w || target.dead || attacker.levelIndex !== target.levelIndex) return false
  return canSee(attacker, target, ctx.world.levels[attacker.levelIndex], W[w.kind].range)
}

/**
 * Attack if the weapon is ready and the target is in reach.
 * Returns true if an attack was made (hit or miss).
 */
export function tryAttack(attacker: Agent, target: Agent, ctx: CombatContext): boolean {
  const w = attacker.weapon
  if (!w || w.cooldown > 0 || w.reloading > 0) return false
  if (isRanged(w) && w.inMag === 0) return false
  if (!inReach(attacker, target, ctx)) return false

  const spec = W[w.kind]
  const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y)
  const chance = w.skill * (1 - CONFIG.combat.hitFalloff * Math.min(1, dist / spec.range))
  const hit = ctx.rng.next() < chance
  // Striking from hiding: a heavier first blow, and the attacker gives itself away.
  const ambush = target.side === 'human' && takeAmbush(attacker)
  reveal(attacker)
  w.cooldown = Math.max(1, Math.round(TPS / spec.perSecond))
  if (isRanged(w)) {
    w.inMag--
    makeNoise(ctx.noises, 'gunshot', attacker.levelIndex, attacker.x, attacker.y, ctx.tick, attacker.id)
  }
  ctx.shots.push({ levelIndex: attacker.levelIndex, x0: attacker.x, y0: attacker.y, x1: target.x, y1: target.y, hit, ranged: isRanged(w), flame: w.kind === 'flamethrower', tick: ctx.tick })
  if (hit) damage(target, spec.damage * (ambush ? CONFIG.camouflage.ambushDamage : 1), attacker, ctx)
  if (ambush) {
    ctx.stats.ambushes++
    if (target.soldier) ctx.stats.squadAmbushes++
    logEvent(ctx, 'hive', `${who(attacker)} ambushed ${who(target)} from the resin`)
  }
  if (w.kind === 'flamethrower') burn(attacker, target, spec.damage, ctx)
  return true
}

/** Flamethrower: scorch every other Myrr near the target, and burn away resin there. */
function burn(attacker: Agent, target: Agent, dmg: number, ctx: CombatContext): void {
  const F = CONFIG.flamethrower
  for (const a of ctx.agents) {
    if (a === target || a.dead || a.side !== 'myrr' || a.levelIndex !== target.levelIndex) continue
    if (Math.hypot(a.x - target.x, a.y - target.y) <= F.splash) damage(a, dmg * 0.6, attacker, ctx)
  }
  burnArea(tileOfPoint(target), F.burnRadius, 0, attacker, ctx)
}

/** Burn away resin in a square around a tile; Myrr standing in it take `dmg`. */
export function burnArea(at: { levelIndex: number; x: number; y: number }, radius: number, dmg: number, source: Agent, ctx: CombatContext): void {
  const level = ctx.world.levels[at.levelIndex]
  if (dmg > 0) for (const a of ctx.agents) {
    if (a.dead || a.side !== 'myrr' || a.levelIndex !== at.levelIndex) continue
    if (Math.abs(Math.floor(a.x) - at.x) <= radius && Math.abs(Math.floor(a.y) - at.y) <= radius) damage(a, dmg, source, ctx)
  }
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const x = at.x + dx, y = at.y + dy
      if (x < 0 || y < 0 || x >= level.width || y >= level.height) continue
      const i = y * level.width + x
      if (!level.resin[i]) continue
      level.resin[i] = 0
      ctx.hive.resinTiles--
      markChanged(level, i)
    }
}

function tileOfPoint(a: Agent): { levelIndex: number; x: number; y: number } {
  return { levelIndex: a.levelIndex, x: Math.floor(a.x), y: Math.floor(a.y) }
}

export function damage(target: Agent, amount: number, source: Agent | null, ctx: CombatContext): void {
  if (target.dead) return
  target.health -= amount
  reveal(target)
  if (target.civ && source && source.side === 'myrr') {
    target.civ.threat = { levelIndex: source.levelIndex, x: source.x, y: source.y }
    target.civ.lastSeenTick = ctx.tick
  }
  if (target.soldier) ctx.onSoldierHurt?.(target, target.health <= 0)
  // A hurt Myrr releases alarm scent; a dying one releases more.
  if (target.myrr) {
    const amount = target.health <= 0 ? CONFIG.pheromones.alarmOnDeath : CONFIG.pheromones.alarmOnHurt
    deposit(ctx.pheromones, 'alarm', ctx.world, target.levelIndex, target.x, target.y, amount)
    // Danger marks the spot as a place Myrr get hurt, for the hive to avoid later.
    const danger = target.health <= 0 ? CONFIG.pheromones.dangerOnDeath : CONFIG.pheromones.dangerOnHurt
    depositSpread(ctx.pheromones, 'danger', ctx.world, target.levelIndex, target.x, target.y, danger, CONFIG.pheromones.dangerSpread)
  }
  if (target.health <= 0) kill(target, ctx)
  else if (target.myrr) ctx.onMyrrHurt?.(target, source)
}

export function kill(agent: Agent, ctx: CombatContext): void {
  agent.dead = true
  agent.health = 0
  agent.path = []
  agent.state = { name: 'idle', ticksLeft: 1e9 }
  if (agent.civ) {
    agent.civ.mode = 'dead'
    agent.civ.deathCause = agent.civ.deathCause ?? 'killed'
    if (agent.soldier) ctx.stats.soldiersKilled++
    else ctx.stats.civiliansKilled++
    logEvent(ctx, 'death', `${who(agent)} was killed on Level ${agent.levelIndex + 1}`)
  }
  const m = agent.myrr
  if (m) {
    if (m.role === 'taker') ctx.hive.losses.taker++
    if (m.role === 'spineback') ctx.hive.losses.spineback++
    if (m.role !== 'mother') ctx.stats.myrrKilled[m.role]++
    if (m.role === 'mother') {
      ctx.stats.myrrKilled.mother++
      ctx.hive.collapsing = true
      logEvent(ctx, 'hive', 'The Brood Mother is dead. The hive is collapsing')
    }
    // A Taker killed while carrying someone drops them, still paralysed for a while.
    if (m.task === 'carry' && m.targetId >= 0) {
      const captive = ctx.agents[m.targetId]
      if (captive?.civ && captive.civ.mode === 'captured') {
        setMode(captive, captive.civ, 'paralyzed')
        captive.civ.paralyzedUntilTick = ctx.tick + Math.round(CONFIG.hive.paralysisSeconds * TPS * 0.5)
        captive.state = { name: 'idle', ticksLeft: 1e9 }
        ctx.stats.dropped++
        logEvent(ctx, 'rescue', `A Taker carrying ${who(captive).toLowerCase()} was killed; they were dropped`)
      }
      m.targetId = -1
    }
  }
}

/** The nearest living agent that passes `test` and that `viewer` can see within `range`. */
export function nearestVisible(viewer: Agent, ctx: CombatContext, range: number, test: (a: Agent) => boolean): Agent | null {
  const level = ctx.world.levels[viewer.levelIndex]
  let best: Agent | null = null
  let bestDist = Infinity
  for (const other of ctx.agents) {
    if (other === viewer || other.dead || other.levelIndex !== viewer.levelIndex || !test(other)) continue
    const d = Math.hypot(other.x - viewer.x, other.y - viewer.y)
    if (d >= bestDist || d > range) continue
    if (!canSee(viewer, other, level, range)) continue
    best = other
    bestDist = d
  }
  return best
}

/** Drop old tracers. */
export function pruneShots(shots: Shot[], tick: number): void {
  const keep = Math.max(1, Math.round(CONFIG.combat.tracerSeconds * TPS))
  let n = 0
  for (const s of shots) if (tick - s.tick < keep) shots[n++] = s
  shots.length = n
}
