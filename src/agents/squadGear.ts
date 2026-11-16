// Squad gear: turrets (fetch, set up, pack, reload, fortify the Landing Pad), mining charges,
// flares, and burning resin with incendiaries or the flamethrower.

import { CONFIG } from '../config.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { findLandingPad, isIn, randomTileIn, roughDistance, type RoomRef } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { burnArea } from './combat.ts'
import { needsReload, padSite } from './turret.ts'
import { strongest } from '../systems/pheromones.ts'
import { chokePoint } from '../systems/digging.ts'
import { makeNoise } from '../systems/noise.ts'
import { lightFlare } from '../systems/camouflage.ts'
import { logEvent } from '../core/events.ts'
import { hatchingSoon } from '../systems/commander.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'
import { members, setOrder, type Squad } from './squad.ts'

const TPS = CONFIG.sim.ticksPerSecond
const S = CONFIG.soldiers

/**
 * Fortifying the Landing Pad before the ship is called: carry a turret there and
 * set it up on the pad's edge. Returns true if it gave the squad an order.
 */
export function fortifyPad(squad: Squad, squads: Squad[], ctx: CombatContext): boolean {
  const reserved = reservedSites(squads)
  const site = padSite(ctx, reserved)
  if (!site) return false
  if (squad.carryingTurret) { setOrder(squad, 'deployTurret', site); return true }
  // Squads already fetching count toward the turrets wanted.
  const coming = squads.filter((s) => s.carryingTurret || s.order === 'fetchTurret' || s.order === 'deployTurret' || s.order === 'packTurret').length
  const standing = ctx.agents.filter((a) => a.kind === 'turret' && onPad(a, ctx)).length
  if (standing + coming >= CONFIG.commander.evacuation.padTurrets) return false
  const armory = armoryWithTurret(ctx)
  if (armory) {
    setOrder(squad, 'fetchTurret', randomTileIn(ctx.world, armory, ctx.rng))
    return true
  }
  // The armory is empty: go and pack up a turret standing somewhere else.
  const turret = movableTurret(squad, squads, ctx)
  if (!turret) return false
  setOrder(squad, 'packTurret', tileOf(turret))
  squad.targetId = turret.id
  return true
}

/** Fetching, packing or setting up a turret for the Landing Pad during the fortifying. */
export function padWork(squad: Squad, ctx: CombatContext): boolean {
  return ctx.commander.evacuation === 'fortify' && squad.mission === 'escort' &&
    (squad.order === 'fetchTurret' || squad.order === 'packTurret' || squad.order === 'deployTurret')
}

/** Is this agent standing on the Landing Pad? */
export function onPad(a: Agent | undefined, ctx: CombatContext): boolean {
  return !!a && !a.dead && isIn(ctx.world, a, findLandingPad(ctx.world))
}

/** The nearest standing turret off the Landing Pad that no other squad is already packing up. */
export function movableTurret(squad: Squad | null, squads: Squad[], ctx: CombatContext): Agent | null {
  const claimed = new Set(squads.filter((s) => s !== squad && s.order === 'packTurret').map((s) => s.targetId))
  const leader = squad ? members(squad, ctx)[0] : null
  let best: Agent | null = null, bestD = Infinity
  for (const a of ctx.agents) {
    if (a.kind !== 'turret' || a.dead || onPad(a, ctx) || claimed.has(a.id)) continue
    const d = leader ? roughDistance(leader, a) : a.levelIndex
    if (d < bestD) { best = a; bestD = d }
  }
  return best
}

/** Spots squads are already carrying turrets to. */
export function reservedSites(squads: Squad[]): PathNode[] {
  return squads.filter((s) => s.order === 'deployTurret' && s.goal).map((s) => s.goal!)
}

/** A room that still has a packed turret (more than `keep`, which are held back for the Landing Pad). */
export function armoryWithTurret(ctx: CombatContext, keep = 0): RoomRef | null {
  return [...ctx.supplies.values()].find((s) => s.stock.turrets > keep)?.room ?? null
}

/** A turret on the leader's level that needs ammo, if the squad has spare rifle magazines. */
export function turretToReload(ctx: CombatContext, leader: Agent): Agent | null {
  if (!leader.weapon || leader.weapon.kind !== 'rifle' || leader.weapon.spare < 1) return null
  return ctx.agents.find((a) => a.kind === 'turret' && a.levelIndex === leader.levelIndex && needsReload(a)) ?? null
}

/** Where to blast: a narrow tunnel near heavy fighting on Level 2 (strong danger scent). */
export function blastSite(ctx: CombatContext): PathNode | null {
  const hot = strongest(ctx.pheromones, 'danger', ctx.world, 3, CONFIG.charges.trigger, ctx.tick).find((s) => s.at.levelIndex === 1)
  if (!hot) return null
  // Stand next to the choke point, on the colony side, and blast it.
  return chokePoint(ctx.world, hot.at, S.blastSearchRadius)
}

/** Should this squad burn resin ahead of it? The Commander skips it when someone is about to be lost. */
export function wantsToBurn(squad: Squad, ctx: CombatContext): boolean {
  if (!ctx.commander.burnResin || squad.order === 'retreat' || squad.order === 'resupply') return false
  const urgent = squad.order === 'rescue' || ((squad.order === 'cut' || squad.mission === 'assault') && hatchingSoon(ctx) > 0)
  // Logged once per decision, and not again for this squad until riskLogCooldownSeconds have passed.
  if (urgent && !squad.riskTaken && ctx.tick - squad.riskLoggedTick >= S.riskLogCooldownSeconds * TPS) {
    squad.riskLoggedTick = ctx.tick
    logEvent(ctx, 'command', `The Commander takes the risk: ${squad.name} goes in without burning the resin to save lives`)
  }
  squad.riskTaken = urgent
  return !urgent
}

/** Throw a flare onto the resin ahead (or underfoot) if none is burning nearby. */
export function lightFlareAhead(squad: Squad, agent: Agent, ctx: CombatContext): void {
  const level = ctx.world.levels[agent.levelIndex]
  const here = level.resin[Math.floor(agent.y) * level.width + Math.floor(agent.x)] > 0 ? tileOf(agent) : null
  const spot = resinAhead(agent, ctx) ?? here
  if (!spot) return
  const x = spot.x + 0.5, y = spot.y + 0.5
  if (level.flares.some((f) => Math.hypot(f.x - x, f.y - y) < CONFIG.flares.spacing)) return
  lightFlare(level, x, y, ctx.tick)
  squad.flares--
}

/** Grenades left, or a flamethrower with fuel to spare. */
export function canBurn(squad: Squad, alive: Agent[]): boolean {
  return squad.incendiaries > 0 || alive.some((s) => s.weapon?.kind === 'flamethrower' && s.weapon.inMag >= CONFIG.incendiaries.flamerFuel)
}

/** The first resin tile on the leader's route within throwing range, if any. */
export function resinAhead(agent: Agent, ctx: CombatContext): PathNode | null {
  const range = CONFIG.incendiaries.throwRange
  for (const step of agent.path) {
    if (step.levelIndex !== agent.levelIndex) return null
    if (Math.hypot(step.x + 0.5 - agent.x, step.y + 0.5 - agent.y) > range) return null
    const level = ctx.world.levels[step.levelIndex]
    if (level.resin[step.y * level.width + step.x]) return step
  }
  return null
}

/** Throw a grenade (or use the flamethrower) at the resin ahead. */
export function throwIncendiary(squad: Squad, alive: Agent[], ctx: CombatContext): void {
  const at = squad.burnAt!
  squad.burnAt = null
  if (squad.incendiaries > 0) squad.incendiaries--
  else {
    const flamer = alive.find((s) => s.weapon?.kind === 'flamethrower' && s.weapon.inMag >= CONFIG.incendiaries.flamerFuel)
    if (!flamer) return
    flamer.weapon!.inMag -= CONFIG.incendiaries.flamerFuel
  }
  burnArea(at, CONFIG.incendiaries.radius, CONFIG.incendiaries.damage, alive[0], ctx)
  makeNoise(ctx.noises, 'smash', at.levelIndex, at.x, at.y, ctx.tick, alive[0].id)
}
