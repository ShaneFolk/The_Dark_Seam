// Myrr data: what each Myrr is doing (role, task, target) and the hive's shared state.

import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import { type PathNode } from '../world/pathfinding.ts'
import { type RoomRef } from '../world/rooms.ts'
import { type Decoy } from './decoy.ts'
import { type Pheromones } from '../systems/pheromones.ts'
import { type DigJob } from '../systems/digging.ts'
import type { Noise } from '../systems/noise.ts'
import { type Agent } from './agent.ts'
import { type Log } from '../core/events.ts'
import { type Swarm } from './swarm.ts'
import type { LandingWatch } from './landing.ts'


export type Task =
  | 'rest' | 'scout' | 'return' | 'hunt' | 'attack' | 'carry' | 'spread' | 'coat' | 'dig' | 'sabotage' // Takers
  | 'lurk' // a Taker lying in wait by a generator it knocked out, for the engineers
  | 'swarm' // Takers and raiding Spinebacks gathering for a swarm
  | 'haul' | 'haulCarry' // Takers moving a cocoon to a new nursery (nest.ts)
  | 'decoy' // a Taker making a diversion at a motion sensor (decoy.ts)
  | 'inject' | 'uproot' | 'root' | 'burrow' // Brood Mother (she also uses 'rest', 'hunt' and 'return')
  | 'grow' // Broodlings
  | 'guard' | 'respond' | 'stakeout' // Spinebacks (stakeout: hiding by an elevator landing, landing.ts)

export interface MyrrData {
  role: 'taker' | 'mother' | 'broodling' | 'spineback'
  task: Task
  /** Ticks left in timed tasks (rest, grab, coat). */
  ticksLeft: number
  /** Human being hunted or carried. */
  targetId: number
  /** Tick the hunted human was last seen. */
  lastSeenTick: number
  /** Next tick a hunter re-plans its route. */
  repathTick: number
  /** Scouting trips in a row that found nothing. */
  trips: number
  /** Last tile index scent was laid on while carrying. */
  lastTrailTile: number
  /** Tick the current hunt started. */
  huntStartTick: number
  /** Human this Taker has given up on, and until when. */
  ignoreId: number
  ignoreUntilTick: number
  /** Brood Mother: anchored in her chamber. She must uproot before she can move. */
  rooted: boolean
  /** Hunting as part of a swarm: don't back off from groups or guns. */
  swarmHunt: boolean
  /** The last job picked after resting, with the scores (for the description). */
  lastChoice: string
  /** Tick it was last shot (a shaken Myrr steers clear of risky jobs for a while). */
  shotTick: number
  /** Broodlings: where it hatched (it stays near there while it grows). */
  home: PathNode | null
  /** A learned trick it was sent on, and when (hiveMemory.ts), or null. */
  tactic: Tactic | null
  tacticTick: number
}

/** The tricks the hive learns and can forget (hiveMemory.ts). */
export type Tactic = 'repairAmbush' | 'stakeout'

export interface HiveState {
  motherId: number
  /** Humans held in the hive, waiting to be injected (oldest first). */
  captives: number[]
  /** Broodlings hatched so far. */
  hatched: number
  /** The Brood Mother has died: the hive is collapsing. */
  collapsing: boolean
  /** The Brood Mother is fleeing to this spot (escape ending if she gets there). */
  escapeTo: PathNode | null
  escaped: boolean
  /** The Brood Mother's spot in the middle of her chamber (the Deep Chamber once she has retreated). */
  motherHome: PathNode | null
  /** Her fallback: the middle of the Deep Chamber, and whether she has retreated there. */
  deepHome: PathNode | null
  retreated: boolean
  /** Where the cocoons are kept once the hive has moved them (null = the Hive Core), how often it has, and when it next may. */
  nursery: RoomRef | null
  nestMoves: number
  nextNestTick: number
  /** Soldiers have been in among the cocoons since the last move. */
  raided: boolean
  /** Cocoons waiting for a Taker to carry them to the nursery (new ones, or after a move). */
  unplaced: number[]
  /** Times engineers were seen coming to fix a generator the hive broke; at CONFIG.power.ambush.learnAfter it starts lying in wait. */
  repairsSeen: number
  ambushLearned: boolean
  /** What it knows about soldiers coming down the elevators (landing.ts). */
  landing: LandingWatch
  /** Losses on each learned trick since it last paid off, and when it may be learned again after giving it up (hiveMemory.ts). */
  doubts: Record<Tactic, number>
  relearnAfter: Record<Tactic, number>
  /** Last tick the Brood Mother called her raiders home. */
  lastRecallTick: number
  /** The diversion under way, if any, and when the next may start. */
  decoy: Decoy | null
  nextDecoyTick: number
  /** The swarm gathering right now, if any, and when the next may be called. */
  swarm: Swarm | null
  nextSwarmTick: number
  /** Recent losses, used to decide what Broodlings grow into (Phase 6 fills these). */
  losses: { taker: number; spineback: number }
  /** Tiles covered in resin, all levels. */
  resinTiles: number
  /** Tunnel being dug, if any (one at a time), and when the next may start. */
  dig: DigJob | null
  nextDigTick: number
  tunnelsDug: number
}

export interface HiveContext extends Log {
  world: World
  rng: Rng
  tick: number
  agents: Agent[]
  noises: Noise[]
  pheromones: Pheromones
  hive: HiveState
}

export function createMyrrData(role: MyrrData['role']): MyrrData {
  return { role, task: 'rest', ticksLeft: 0, targetId: -1, lastSeenTick: 0, repathTick: 0, trips: 0, lastTrailTile: -1, huntStartTick: 0, ignoreId: -1, ignoreUntilTick: 0, rooted: role === 'mother', swarmHunt: false, lastChoice: '', shotTick: -1e9, home: null, tactic: null, tacticTick: 0 }
}
