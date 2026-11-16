// Squads: the shared data (each soldier's role, a squad's order and gear) and small helpers
// used by the squad brain (soldier.ts) and its duties (squadDuties.ts, squadGear.ts, medic.ts).

import { CONFIG } from '../config.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { findPath } from '../world/pathfinding.ts'
import { findRooms, randomTileIn, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { isFree } from './civilian.ts'
import { logEvent } from '../core/events.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'
import { landingCost, type Scouting } from './scout.ts'

const S = CONFIG.soldiers

export interface SoldierData {
  squadId: number
  role: 'soldier' | 'medic'
  /** Next tick this soldier re-plans its route. */
  repathTick: number
  /** Leaders: the goal of the current route (as a number), and when to re-plan it anyway. */
  pathGoal: number
  samePathUntil: number
  /** Myrr this soldier is shooting at, or -1. */
  targetId: number
  /** Medics only: stabilizers left, current patient (-1 = none) and ticks left on the job. */
  stabilizers: number
  patientId: number
  workTicks: number
}

export type Order = 'cover' | 'packTurret' | 'guide' | 'guard' | 'patrol' | 'respond' | 'rescue' | 'cut' | 'resupply' | 'retreat' | 'reload' | 'blast' | 'fetchTurret' | 'deployTurret' | 'assault' | 'escort'

export interface Squad {
  id: number
  /** What the log and sidebar call it, e.g. "Anvil Squad" (see data/names.ts). */
  name: string
  members: number[]
  order: Order
  /** Where the squad is heading. */
  goal: PathNode | null
  /** Agent the order is about (carrier to chase, cocoon to cut), or -1. */
  targetId: number
  /** 0 to 1. Low morale makes the squad retreat. */
  morale: number
  lastContactTick: number
  patrol: RoomRef[]
  patrolIndex: number
  /** Ticks left on timed work (resupplying, cutting, welding, pausing on patrol). */
  ticksLeft: number
  /** Welded themselves in during the current retreat. */
  welded: boolean
  /** Mining charges the squad carries. */
  charges: number
  /** The leader is carrying a packed turret. */
  carryingTurret: boolean
  /** The Commander's orders for this squad: assault the hive, or guard the evacuation. */
  mission: 'assault' | 'escort' | null
  missionGoal: PathNode | null
  /** Has reached the mission goal (assault: the Hive Core). */
  missionReached: boolean
  /** Incendiary grenades for burning resin. */
  incendiaries: number
  /** Where the squad is about to burn resin (while it stops to throw), or null. */
  burnAt: PathNode | null
  /** The Commander told it to skip burning to save someone (logged once per decision). */
  riskTaken: boolean
  /** When that decision was last logged (so it isn't repeated every time the order flips). */
  riskLoggedTick: number
  /** Command squad: the agent it guards (the Commander), or -1. */
  guardId: number
  /** Flares left (they show hidden Myrr nearby). */
  flares: number
  /** Places searched so far on the current response. */
  searches: number
  /** Myrr its soldiers have killed; at CONFIG.soldiers.veteran.kills the squad becomes veterans. */
  kills: number
  veteran: boolean
  /** Ammo left in a turret the squad packed up and is carrying (null = a fresh one from the armory). */
  turretAmmo: number | null
  /** A scout sent down an elevator ahead of the squad (scout.ts), or null. */
  scouting: Scouting | null
  /** Someone just cut free that this squad is walking to the med bay, or -1. */
  escortId: number
}

/** A fresh squad on patrol with no members yet (add them with squad.members.push). */
export function newSquad(id: number, name: string, patrol: RoomRef[], patrolIndex: number, tick: number): Squad {
  return {
    id, name, members: [], order: 'patrol', goal: null, targetId: -1, morale: 1,
    lastContactTick: tick, patrol, patrolIndex, ticksLeft: 0, welded: false,
    charges: 0, carryingTurret: false, mission: null, missionGoal: null, missionReached: false,
    incendiaries: 0, burnAt: null, riskTaken: false, riskLoggedTick: -1e9, guardId: -1, flares: 0,
    turretAmmo: null, scouting: null, searches: 0, kills: 0, veteran: false, escortId: -1,
  }
}

export function setOrder(squad: Squad, order: Order, goal: PathNode | null): void {
  if (squad.order !== order) { squad.ticksLeft = 0; squad.welded = false; squad.searches = 0 }
  squad.order = order
  if (goal) squad.goal = goal
  if (order === 'patrol') { squad.goal = null; squad.targetId = -1 }
}

export function members(squad: Squad, ctx: CombatContext): Agent[] {
  return squad.members.map((id) => ctx.agents[id]).filter((a) => a && !a.dead && isFree(a))
}

/** Squad morale drops when one of its soldiers is hurt or killed (less for veterans). */
export function soldierHurt(squads: Squad[], soldier: Agent, killed: boolean): void {
  const squad = squads[soldier.soldier!.squadId]
  const loss = (killed ? S.morale.squadmateDown : S.morale.hitTaken) * (squad.veteran ? S.veteran.moraleLossScale : 1)
  squad.morale = Math.max(0, squad.morale - loss)
}

/** A soldier killed a Myrr: count it for the squad, and make them veterans at enough kills. */
export function soldierKilled(squads: Squad[], soldier: Agent, ctx: CombatContext): void {
  const squad = squads[soldier.soldier!.squadId]
  if (!squad) return
  squad.kills++
  if (squad.veteran || squad.kills < S.veteran.kills) return
  squad.veteran = true
  for (const a of members(squad, ctx)) {
    a.maxHealth += S.veteran.healthBonus
    a.health += S.veteran.healthBonus
    if (a.weapon) a.weapon.skill = Math.min(1, a.weapon.skill + S.veteran.skillBonus)
  }
  squad.morale = Math.min(1, squad.morale + S.veteranMoraleBoost)
  logEvent(ctx, 'command', `${squad.name} are veterans now (${squad.kills} Myrr killed)`)
}

export function roomGoal(ctx: CombatContext, types: ('security' | 'armory')[], from: Agent): PathNode | null {
  const rooms = findRooms(ctx.world, types)
  if (!rooms.length) return null
  const here = roomAt(ctx.world, tileOf(from))
  if (rooms.some((r) => sameRoom(r, here))) return tileOf(from)
  return randomTileIn(ctx.world, rooms[0], ctx.rng)
}

export function isCocooned(ctx: CombatContext, id: number): boolean {
  return id >= 0 && ctx.agents[id]?.civ?.mode === 'cocooned'
}

export function walkTo(agent: Agent, to: PathNode, ctx: CombatContext): void {
  // Squads steer clear of an elevator whose landing a scout found watched.
  const path = findPath(ctx.world, tileOf(agent), to, 'human', { linkCost: landingCost(ctx) })
  if (path?.length) {
    agent.path = path
    agent.state = { name: 'moving' }
  }
}

export function dist(a: Agent, b: Agent): number {
  return a.levelIndex === b.levelIndex ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity
}
