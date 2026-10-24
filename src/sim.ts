// The simulation: all game state plus the step() that advances it one tick.
// Never touches the canvas or the DOM, so it can run headless.

import { CONFIG } from './config.ts'
import { Rng } from './core/rng.ts'
import { createWorld, type World } from './world/world.ts'
import { createAgent, type Agent } from './agents/agent.ts'
import { updateWanderer } from './agents/wander.ts'
import { movementHooks } from './agents/movement.ts'
import { activityAt, createCivilianData, roomFor, updateCivilian, type CivilianContext } from './agents/civilian.ts'
import { createMyrrData, planDigging, takerHurt, updateTaker, type HiveState } from './agents/myrr.ts'
import { updateBroodling, updateCollapse, updateInfections, updateMother, updateSpineback } from './agents/lifecycle.ts'
import { createStats, logEvent, type GameEvent, type RunStats } from './core/events.ts'
import { checkEnding, type Ending } from './systems/endings.ts'
import { createCommander, landingPad, updateCommander, type CommanderState } from './systems/commander.ts'
import { makeWeapon, pruneShots, tickWeapon, type Shot } from './agents/combat.ts'
import { soldierHurt, updateSoldier, updateSquads, type Squad } from './agents/soldier.ts'
import { countResin, seedHiveResin } from './systems/resin.ts'
import { makeNoise, pruneNoises, type Noise } from './systems/noise.ts'
import { createPheromones, decayPheromones, type Pheromones } from './systems/pheromones.ts'
import { findRooms, randomTileIn, roomTiles, type RoomRef } from './world/rooms.ts'
import { createSupplies, type Supplies } from './systems/supplies.ts'
import { createMedBays, updateMedBays, type MedBay } from './systems/medbay.ts'
import { createPower, hasPower, type PowerState } from './systems/power.ts'
import { createSensors, updateSensors, type Sensor } from './systems/sensors.ts'
import { updateTurret } from './agents/turret.ts'
import type { RoomType } from './world/level.ts'
import type { PathNode } from './world/pathfinding.ts'

export interface SimState {
  seed: number
  tick: number
  rng: Rng
  world: World
  agents: Agent[]
  noises: Noise[]
  pheromones: Pheromones
  hive: HiveState
  squads: Squad[]
  /** Recent shots and swings, for tracers. */
  shots: Shot[]
  supplies: Supplies
  medbays: MedBay[]
  power: PowerState
  sensors: Sensor[]
  /** Motion sensor alerts so far. */
  sensorAlerts: number
  /** Key moments of the run, oldest first. */
  events: GameEvent[]
  stats: RunStats
  /** Set when the run has ended; the sim stops. */
  ending: Ending | null
  /** Was the colony powered last tick (to log power going off and on). */
  hadPower: boolean
  commander: CommanderState
}

export function createSim(seed: number): SimState {
  const world = createWorld()
  const sim: SimState = {
    seed,
    tick: 0,
    rng: new Rng(seed),
    world,
    agents: [],
    noises: [],
    pheromones: createPheromones(world),
    hive: { motherId: -1, captives: [], hatched: 0, losses: { taker: 0, spineback: 0 }, resinTiles: 0, dig: null, nextDigTick: 0, tunnelsDug: 0, collapsing: false, escapeTo: null, escaped: false },
    squads: [],
    shots: [],
    supplies: new Map(),
    medbays: createMedBays(world),
    power: createPower(world),
    sensors: [],
    sensorAlerts: 0,
    events: [],
    stats: createStats(),
    ending: null,
    hadPower: true,
    commander: null as unknown as CommanderState,
  }
  sim.supplies = createSupplies(world, sim.rng)
  sim.sensors = createSensors(world, sim.rng)
  seedHiveResin(world)
  sim.hive.resinTiles = countResin(world)
  spawnCivilians(sim)
  spawnSoldiers(sim)
  spawnHive(sim)
  spawnMyrrWanderers(sim)
  sim.commander = createCommander(sim.agents)
  return sim
}

const TPS = CONFIG.sim.ticksPerSecond
const SKITTER_TICKS = Math.round(CONFIG.noise.skitterEverySeconds * TPS)

/** Advance the simulation by exactly one fixed tick. Agents update in id order. */
export function step(sim: SimState): void {
  if (sim.ending) return // the run is over
  sim.tick++
  pruneNoises(sim.noises, sim.tick)
  pruneShots(sim.shots, sim.tick)
  if (sim.tick % TPS === 0) decayPheromones(sim.pheromones)

  const ctx: CivilianContext = {
    world: sim.world,
    rng: sim.rng,
    tick: sim.tick,
    agents: sim.agents,
    noises: sim.noises,
    supplies: sim.supplies,
    events: sim.events,
    stats: sim.stats,
    medbays: sim.medbays,
    commander: sim.commander,
    power: sim.power,
    pheromones: sim.pheromones,
    hive: sim.hive,
    shots: sim.shots,
    onSoldierHurt: (soldier, killed) => soldierHurt(sim.squads, soldier, killed),
    onMyrrHurt: (myrr, source) => takerHurt(myrr, source, ctx),
  }

  movementHooks.onBreak = (agent, kind) => makeNoise(sim.noises, kind, agent.levelIndex, agent.x, agent.y, sim.tick, agent.id)
  updateInfections(ctx)
  updateMedBays(sim.medbays, sim.agents, sim.world, hasPower(sim.power), ctx)
  updateCollapse(ctx)
  const powered = hasPower(sim.power)
  if (powered !== sim.hadPower) logEvent(ctx, 'power', powered ? 'Power restored' : 'Power is out: both generators are down')
  sim.hadPower = powered
  sim.sensorAlerts += updateSensors(sim.sensors, sim.agents, sim.noises, sim.tick)
  updateCommander(sim.commander, sim.squads, ctx, {
    spawnReinforcements: () => {
      const pad = landingPad(ctx)
      if (pad) addSquad(sim, pad, CONFIG.soldiers.squadSize, BEATS[sim.squads.length % BEATS.length])
    },
  })
  updateSquads(sim.squads, ctx)
  planDigging(ctx)

  // Only agents that existed at the start of the tick act (new Broodlings wait a tick).
  const count = sim.agents.length
  for (let i = 0; i < count; i++) {
    const agent = sim.agents[i]
    if (agent.dead || agent.civ?.mode === 'evacuated') continue
    if (agent.weapon) tickWeapon(agent.weapon) // cooldowns and reloads, for everyone
    if (agent.kind === 'turret') { updateTurret(agent, ctx); continue }
    if (agent.civ) {
      updateCivilian(agent, ctx)
      if (agent.soldier && !agent.dead && agent.civ.mode === 'routine') updateSoldier(agent, sim.squads, ctx)
      continue
    }
    const role = agent.myrr?.role
    if (role === 'taker') updateTaker(agent, ctx)
    else if (role === 'mother') updateMother(agent, ctx)
    else if (role === 'broodling') updateBroodling(agent, ctx)
    else if (role === 'spineback') updateSpineback(agent, ctx)
    else if (agent.kind === 'wanderer-myrr') updateWanderer(agent, sim.world, sim.rng)
    // Moving Myrr skitter now and then.
    if (agent.side === 'myrr' && agent.state.name === 'moving' && (sim.tick + agent.id) % SKITTER_TICKS === 0) {
      makeNoise(sim.noises, 'skitter', agent.levelIndex, agent.x, agent.y, sim.tick, agent.id)
    }
  }
  checkForEnding(sim)
}

/** Once a second: has the run ended? */
function checkForEnding(sim: SimState): void {
  if (sim.tick % TPS !== 0) return
  const ending = checkEnding(sim.agents, sim.hive, sim.stats, sim.tick, sim.commander.evacuation === 'gone')
  if (!ending) return
  sim.ending = ending
  logEvent({ events: sim.events, stats: sim.stats, tick: sim.tick }, 'ending', 'The run ended: ' + ending.kind)
}

/** Activity counts per level for the sidebar (living, not cocooned). */
export function levelActivity(sim: SimState, levelIndex: number): { humans: number; myrr: number } {
  let humans = 0, myrr = 0
  for (const a of sim.agents) {
    if (a.dead || a.levelIndex !== levelIndex || a.civ?.mode === 'cocooned' || a.civ?.mode === 'evacuated' || a.kind === 'turret') continue
    if (a.side === 'human') humans++
    else myrr++
  }
  return { humans, myrr }
}

/** Civilians start wherever their schedule puts them at the start hour. */
function spawnCivilians(sim: SimState): void {
  const { world, rng } = sim
  for (let n = 0; n < CONFIG.civilians.count; n++) {
    const civ = createCivilianData(world, rng)
    if (!civ) break
    civ.activity = activityAt(civ, 0)
    civ.target = roomFor(civ, civ.activity, civ.home.levelIndex, world, rng)
    const at = randomTileIn(world, civ.target, rng)
    const agent = createAgent(sim.agents.length, 'civilian', 'human', at, CONFIG.movement.humanSpeed, CONFIG.health.human)
    agent.civ = civ
    agent.weapon = makeWeapon('fists', CONFIG.combat.skill.civilian)
    sim.agents.push(agent)
  }
}

/** Squads start in Security. Each patrols its own beat; the last member is the medic. */
function spawnSoldiers(sim: SimState): void {
  const security = findRooms(sim.world, ['security'])[0]
  if (!security) return
  const squads = Math.ceil(CONFIG.soldiers.count / CONFIG.soldiers.squadSize)
  for (let q = 0; q < squads; q++) {
    const size = Math.min(CONFIG.soldiers.squadSize, CONFIG.soldiers.count - q * CONFIG.soldiers.squadSize)
    addSquad(sim, security, size, BEATS[q % BEATS.length])
  }
}

/** Patrol beats: the rooms each squad walks between. */
const BEATS: { level: number; types: RoomType[] }[][] = [
  [{ level: 0, types: ['command', 'mess', 'supply', 'quarters', 'medbay'] }],
  [{ level: 1, types: ['workshop', 'other', 'supply', 'mess'] }],
  [{ level: 0, types: ['other', 'workshop', 'generator'] }, { level: 1, types: ['other'] }],
]

/** A new squad starting in `room`. The last member is its medic. */
function addSquad(sim: SimState, room: RoomRef, size: number, beat: { level: number; types: RoomType[] }[]): void {
  const { world, rng } = sim
  const squadId = sim.squads.length
  const patrol: RoomRef[] = beat.flatMap((p) => findRooms(world, p.types, p.level).filter((r) => !r.room.outdoor))
  sim.squads.push({
    id: squadId, members: [], order: 'patrol', goal: null, targetId: -1, morale: 1,
    lastContactTick: sim.tick, patrol, patrolIndex: rng.int(0, Math.max(0, patrol.length - 1)), ticksLeft: 0, welded: false,
    charges: squadId < CONFIG.charges.count ? 1 : 0, carryingTurret: false,
    mission: null, missionGoal: null, missionReached: false,
  })
  for (let n = 0; n < size; n++) {
    const isMedic = n === size - 1
    const civ = createCivilianData(world, rng, 'soldier')!
    const agent = createAgent(sim.agents.length, isMedic ? 'medic' : 'soldier', 'human', randomTileIn(world, room, rng), CONFIG.movement.humanSpeed, CONFIG.health.human)
    agent.civ = civ
    agent.soldier = {
      squadId, role: isMedic ? 'medic' : 'soldier', repathTick: 0, targetId: -1,
      stabilizers: isMedic ? CONFIG.soldiers.stabilizers : 0, patientId: -1, workTicks: 0,
    }
    // The second soldier of the first squads carries a flamethrower instead of a rifle.
    const flamer = !isMedic && n === 1 && squadId < CONFIG.flamethrower.count
    agent.weapon = makeWeapon(isMedic ? 'pistol' : flamer ? 'flamethrower' : 'rifle', isMedic ? CONFIG.combat.skill.medic : CONFIG.combat.skill.soldier)
    sim.squads[squadId].members.push(agent.id)
    sim.agents.push(agent)
  }
}

/** The Brood Mother at the centre of the hive core, Takers and Spinebacks around her. */
function spawnHive(sim: SimState): void {
  const { world, rng } = sim
  const hive = findRooms(world, ['hive'])[0]
  if (!hive) return
  const tiles = roomTiles(world, hive)
  const centre = tiles.reduce((best, t) =>
    Math.hypot(t.x - hive.room.centerX, t.y - hive.room.centerY) < Math.hypot(best.x - hive.room.centerX, best.y - hive.room.centerY) ? t : best,
  )
  const mother = createAgent(sim.agents.length, 'brood-mother', 'myrr', centre, 0, CONFIG.health.broodMother)
  mother.myrr = createMyrrData('mother')
  sim.hive.motherId = mother.id
  sim.agents.push(mother)

  for (let n = 0; n < CONFIG.hive.takers; n++) {
    const taker = createAgent(sim.agents.length, 'taker', 'myrr', rng.pick(tiles), CONFIG.movement.myrrSpeed, CONFIG.health.taker)
    taker.myrr = createMyrrData('taker')
    taker.myrr.ticksLeft = rng.int(1, 10 * TPS) // stagger the first trips
    taker.weapon = makeWeapon('claws', CONFIG.combat.skill.myrr)
    sim.agents.push(taker)
  }
  for (let n = 0; n < CONFIG.hive.spinebacks; n++) {
    const guard = createAgent(sim.agents.length, 'spineback', 'myrr', rng.pick(tiles), CONFIG.movement.myrrSpeed, CONFIG.health.spineback)
    guard.myrr = createMyrrData('spineback')
    guard.myrr.task = 'guard'
    guard.weapon = makeWeapon('spines', CONFIG.combat.skill.myrr)
    sim.agents.push(guard)
  }
}

/** Phase 2 test Myrr (count is 0 now that the hive has Takers). */
function spawnMyrrWanderers(sim: SimState): void {
  const { world, rng } = sim
  const hive = findRooms(world, ['hive'])[0]
  const tiles: PathNode[] = hive ? roomTiles(world, hive) : []
  for (let n = 0; n < CONFIG.wanderers.myrr && tiles.length; n++) {
    sim.agents.push(createAgent(sim.agents.length, 'wanderer-myrr', 'myrr', rng.pick(tiles), CONFIG.movement.myrrSpeed))
  }
}
