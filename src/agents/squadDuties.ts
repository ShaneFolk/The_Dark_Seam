// Squad duties beyond fighting: merging small squads, splitting off an escort for
// someone cut free, covering engineers at a broken generator, and guarding the Commander.

import { CONFIG } from '../config.ts'
import { roomAt, roughDistance, sameRoom } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree, isLost } from './civilian.ts'
import { type Generator } from '../systems/power.ts'
import { logEvent } from '../core/events.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'
import { medBayFor, needsMedBay } from '../systems/medbay.ts'
import { dist, members, newSquad, setOrder, type Order, type Squad } from './squad.ts'

const S = CONFIG.soldiers

/** Busy with something that can't just be handed over (carrying or setting up a turret). */
const NO_MERGE = new Set<Order>(['fetchTurret', 'deployTurret', 'packTurret', 'guide'])

/**
 * A squad down to a soldier or two joins the nearest other squad (not the command
 * squad) with room, so nobody is left wandering alone. They bring their gear.
 */
export function mergeSquads(squads: Squad[], ctx: CombatContext): void {
  const G = S.merge
  for (const small of squads) {
    const mine = members(small, ctx)
    if (!mine.length || mine.length > G.at || small.guardId >= 0 || small.carryingTurret || NO_MERGE.has(small.order)) continue
    let best: Squad | null = null, bestD = Infinity
    for (const other of squads) {
      // Not into the command squad, nor one busy with something it can't share (an escort walking someone out).
      if (other === small || other.guardId >= 0 || NO_MERGE.has(other.order)) continue
      const theirs = members(other, ctx)
      if (!theirs.length || theirs.length + mine.length > G.maxSize) continue
      // Only squads on the same level merge (a lone soldier doesn't cross the mine to find one).
      const d = theirs[0].levelIndex === mine[0].levelIndex ? roughDistance(theirs[0], mine[0]) : Infinity
      if (d < bestD) { best = other; bestD = d }
    }
    if (!best) continue
    for (const id of small.members) {
      const a = ctx.agents[id]
      if (!a || a.dead) continue
      a.soldier!.squadId = best.id
      best.members.push(id)
    }
    small.members = []
    best.flares += small.flares
    best.charges += small.charges
    best.incendiaries += small.incendiaries
    best.kills += small.kills
    small.flares = small.charges = small.incendiaries = 0
    small.mission = null
    setOrder(small, 'patrol', null)
    logEvent(ctx, 'command', `${small.name} (${mine.length} left) joins ${best.name}`)
  }
}

/**
 * On an assault: split off up to S.escortSize members (the medic first, for the
 * stabilizers) as a new squad to walk a freed person to the med bay, as long as
 * the assault keeps enough soldiers. Returns the new squad, or null if nobody can go.
 */
export function detachEscort(squad: Squad, person: Agent, squads: Squad[], ctx: CombatContext): Squad | null {
  const alive = members(squad, ctx)
  const spare = Math.min(S.escortSize, alive.length - CONFIG.commander.assault.minMembers)
  if (spare <= 0) return null
  const picks = [...alive]
    .sort((a, b) => (a.soldier!.role === 'medic' ? 0 : 1) - (b.soldier!.role === 'medic' ? 0 : 1) || dist(a, person) - dist(b, person))
    .slice(0, spare)
  const escort = newSquad(squads.length, `${squad.name.replace(/ Squad$/, '')} Escort`, squad.patrol, squad.patrolIndex, ctx.tick)
  escort.morale = squad.morale
  escort.veteran = squad.veteran
  squads.push(escort)
  for (const a of picks) {
    squad.members = squad.members.filter((id) => id !== a.id)
    escort.members.push(a.id)
    a.soldier!.squadId = escort.id
  }
  escort.escortId = person.id
  setOrder(escort, 'guide', tileOf(person))
  escort.targetId = person.id
  return escort
}

/** Is the squad's rescued person still on their way to the med bay? Clears escortId once not. */
export function stillEscorting(squad: Squad, ctx: CombatContext): boolean {
  const person = ctx.agents[squad.escortId]
  const bay = person && medBayFor(ctx.medbays)
  if (person && isFree(person) && needsMedBay(person) && bay && !sameRoom(roomAt(ctx.world, tileOf(person)), bay)) return true
  squad.escortId = -1
  return false
}

/** Engineers working on (or heading to) this generator. */
function engineersOn(gen: Generator, ctx: CombatContext): Agent[] {
  return ctx.agents.filter((a) => !a.dead && a.civ?.engineer && a.civ.activity === 'repair' && isFree(a) && sameRoom(a.civ.target, gen.room))
}

/**
 * The knocked-out generator (its index) this squad should cover: one with
 * engineers on it that no other squad covers, and this is the nearest free
 * squad to it. -1 if none.
 */
export function repairToCover(squad: Squad, squads: Squad[], ctx: CombatContext): number {
  if (!S.coverRepairs) return -1
  const gens = ctx.power.generators
  for (let i = 0; i < gens.length; i++) {
    if (!gens[i].broken || squads.some((s) => s.order === 'cover' && s.targetId === i)) continue
    const crew = engineersOn(gens[i], ctx)
    if (!crew.length) continue
    // Only the nearest squad that's free (on patrol, no mission, not the command squad) goes.
    const at = gens[i].at
    const far = (s: Squad) => {
      const l = members(s, ctx)[0]
      return l ? roughDistance(l, at) : Infinity
    }
    const free = squads.filter((s) => s.order === 'patrol' && !s.mission && s.guardId < 0 && members(s, ctx).length)
    free.sort((a, b) => far(a) - far(b))
    if (free[0] === squad) return i
  }
  return -1
}

/** Stay with the engineers until the generator runs again (or they're gone). */
export function coverRepair(squad: Squad, squads: Squad[], ctx: CombatContext): void {
  if (squad.order !== 'cover') {
    const i = repairToCover(squad, squads, ctx)
    setOrder(squad, 'cover', null)
    squad.targetId = i
    ctx.power.generators[i].coverSquad = squad.id
    logEvent(ctx, 'command', `${squad.name} is covering the engineers at the ${ctx.power.generators[i].room.room.name}`, ctx.power.generators[i].at)
  }
  const gen = ctx.power.generators[squad.targetId]
  const crew = gen ? engineersOn(gen, ctx) : []
  if (!gen || !gen.broken || !crew.length) {
    if (gen?.coverSquad === squad.id) gen.coverSquad = -1
    setOrder(squad, 'patrol', null)
    return
  }
  // Walk with the nearest engineer (to the generator, then stand guard there).
  const leader = members(squad, ctx)[0]
  crew.sort((a, b) => dist(leader, a) - dist(leader, b))
  squad.goal = tileOf(crew[0])
}

/** Command-squad orders done at the Commander's side; for any other, he walks along with them. */
export const STAY_WITH_COMMANDER = new Set<Order>(['guard', 'respond', 'rescue', 'patrol'])

/**
 * The command squad: stay with the Commander, fight Myrr that come near them,
 * and chase down anything carrying them off. Once the Commander is lost for good
 * the squad becomes an ordinary one.
 */
export function guardCommander(squad: Squad, leader: Agent, myrrSeen: Agent | null, ctx: CombatContext): void {
  const boss = ctx.agents[squad.guardId]
  const carrier = ctx.agents.find((a) => !a.dead && a.myrr?.task === 'carry' && a.myrr.targetId === boss.id)
  if (carrier) {
    setOrder(squad, 'rescue', tileOf(carrier))
    squad.targetId = carrier.id
    return
  }
  if (isLost(boss)) {
    squad.guardId = -1
    setOrder(squad, 'patrol', null)
    return
  }
  const range = CONFIG.commander.guardRange
  if (myrrSeen && myrrSeen.levelIndex === boss.levelIndex && dist(myrrSeen, boss) <= range) {
    setOrder(squad, 'respond', tileOf(myrrSeen))
    return
  }
  if (squad.order !== 'guard' || leader.levelIndex !== boss.levelIndex || dist(leader, boss) > S.guardRegroupDistance) setOrder(squad, 'guard', tileOf(boss))
}
