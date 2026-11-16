// Soldiers and squads: the squad brain (which order each squad follows) and how
// each soldier moves and fights. Shared squad data lives in squad.ts; the duties
// are in squadDuties.ts (merging, escorts, covering repairs, the command squad),
// squadGear.ts (turrets, charges, flares, burning resin) and medic.ts.
//
// Each squad has one order at a time, picked by its "brain" a few times a second
// in this priority order:
//
//   retreat   morale broke: fall back to Security, weld it shut, wait until it recovers, then
//             go back on duty (during an evacuation: fall back to the Landing Pad instead)
//   resupply  low on ammo: restock at the Armory
//   chase     on an assault, the Brood Mother is fleeing: run her down
//   rescue    a Taker is carrying someone: chase it and shoot it
//   respond   Myrr in sight, or screams, gunfire, digging, smashing or chewing heard
//             (at the spot they search a couple of places nearby, then go back to patrol)
//   cut       a cocoon in sight: cut the person free
//   guide     walk someone just cut free (weak, slow) to the med bay; on an assault the medic and
//             a soldier split off as an escort (if the squad can spare them) while the rest fight on
//   blast     heavy fighting in an Upper Mine tunnel: collapse it with a mining charge
//   cover     a generator is knocked out: go with the engineers repairing it and guard them
//   reload    a turret is low: feed it spare rifle magazines
//   fetchTurret / deployTurret   carry a packed turret from the armory to a defence point
//   packTurret  evacuation, armory empty: pack up a turret already standing to move it to the Landing Pad
//   assault / escort   the Commander's missions: storm the Hive Core / guard the evacuation
//   guard     the command squad stays with the Commander (and only fights near them); when it
//             has to go somewhere (supplies, turrets, falling back), the Commander goes with it
//   patrol    otherwise walk the squad's route
//
// After an ambush the Commander has squads burn resin ahead of them (grenades, or
// the flamethrower) before walking into it, unless someone is about to be lost.
//
// The leader walks to the squad's goal; the others keep close to the leader.
// Every soldier shoots the nearest Myrr in reach on their own. Medics also wake
// paralysed people and stabilize infected ones when it's safe.

import { CONFIG } from '../config.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { canWalk } from '../world/pathfinding.ts'
import { findRooms, randomTileIn, roomAt, roughDistance } from '../world/rooms.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { canHear, canSee } from './perception.ts'
import { setMode } from './civilian.ts'
import { nearestVisible, roundsLeft, tryAttack } from './combat.ts'
import { roomsWith, stockIn, take } from '../systems/supplies.ts'
import { Barrier, putBarrier, roomOpenings } from '../systems/barriers.ts'
import { humanSight } from '../systems/power.ts'
import { createTurret, deploySite } from './turret.ts'
import { collapseTunnel } from '../systems/digging.ts'
import { countResin } from '../systems/resin.ts'
import { makeNoise } from '../systems/noise.ts'
import { kill } from './combat.ts'
import { logEvent } from '../core/events.ts'
import { landingPad } from '../systems/commander.ts'
import { who } from './describe.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'
import { startScouting, updateScout, waitForScout } from './scout.ts'
export type { Order, SoldierData, Squad } from './squad.ts'
export { members, newSquad, soldierHurt, soldierKilled } from './squad.ts'
export { movableTurret } from './squadGear.ts'
import { dist, isCocooned, members, roomGoal, setOrder, walkTo, type Squad } from './squad.ts'
import { treatPatients } from './medic.ts'
import { armoryWithTurret, blastSite, canBurn, fortifyPad, lightFlareAhead, onPad, padWork, resinAhead, reservedSites, throwIncendiary, turretToReload, wantsToBurn } from './squadGear.ts'
import { coverRepair, detachEscort, guardCommander, mergeSquads, repairToCover, STAY_WITH_COMMANDER, stillEscorting } from './squadDuties.ts'

const TPS = CONFIG.sim.ticksPerSecond
const S = CONFIG.soldiers

// ---------------------------------------------------------------- squad brain

/** Decide each squad's order. Runs every perception interval. */
export function updateSquads(squads: Squad[], ctx: CombatContext): void {
  if (ctx.tick % CONFIG.perception.intervalTicks !== 0) return
  const seconds = CONFIG.perception.intervalTicks / TPS
  if (ctx.tick % (S.mergeCheckSeconds * TPS) === 0) mergeSquads(squads, ctx)
  for (const squad of squads) {
    const alive = members(squad, ctx)
    if (squad.guardId >= 0 && !alive.length) ctx.commander.escortTo = null
    if (!alive.length) continue
    const leader = alive[0]

    // What does the squad see and hear?
    let myrrSeen: Agent | null = null
    let myrrCount = 0
    let carrier: Agent | null = null
    let cocoon: Agent | null = null
    for (const s of alive) {
      const SIGHT = humanSight(ctx.power, s.levelIndex)
      const m = nearestVisible(s, ctx, SIGHT, (a) => a.side === 'myrr')
      if (m && (!myrrSeen || dist(s, m) < dist(s, myrrSeen))) myrrSeen = m
      for (const a of ctx.agents) {
        if (a.dead || a.levelIndex !== s.levelIndex) continue
        if (a.side === 'myrr' && canSee(s, a, ctx.world.levels[s.levelIndex], SIGHT)) {
          myrrCount++
          if (a.myrr?.task === 'carry' || a.myrr?.task === 'haulCarry') carrier = a
        } else if (a.civ?.mode === 'cocooned' && canSee(s, a, ctx.world.levels[s.levelIndex], SIGHT)) {
          cocoon = a
        }
      }
    }
    // Sensor alerts go to the nearest squad; other noises only if a member hears them.
    const alert = ctx.noises.find((n) => n.kind === 'sensor' && n.tick === ctx.tick && nearestSquad(squads, n, ctx) === squad)
    const heard = alert ?? ctx.noises.find((n) => n.kind !== 'skitter' && n.kind !== 'sensor' && n.kind !== 'elevator' && n.sourceId >= 0 &&
      !squad.members.includes(n.sourceId) && alive.some((s) => canHear(s, n, ctx.world.levels[s.levelIndex])))

    // Morale drifts: down while outnumbered, back up when it's quiet.
    if (myrrCount > alive.length) squad.morale -= S.morale.outnumberedPerSecond * seconds * (squad.veteran ? S.veteran.moraleLossScale : 1)
    else if (!myrrSeen) squad.morale += S.morale.recoverPerSecond * seconds * (squad.veteran ? S.veteran.moraleRecoverScale : 1)
    squad.morale = Math.max(0, Math.min(1, squad.morale))
    if (myrrSeen) { squad.lastContactTick = ctx.tick; ctx.commander.lastSightingTick = ctx.tick }
    if (cocoon) squad.lastContactTick = ctx.tick

    // Assault done: at the hive, nothing left to fight or cut for a while.
    if (squad.mission === 'assault' && squad.missionReached && !ctx.hive.escapeTo && ctx.tick - squad.lastContactTick > CONFIG.commander.assault.quietSeconds * TPS) {
      squad.mission = null
      squad.missionReached = false
      logEvent(ctx, 'command', `${squad.name} finished its assault on the hive`, leader)
    }
    // A broken or thinned-out squad abandons its assault.
    if (squad.mission === 'assault' && (squad.morale < S.morale.breakAt || alive.length < CONFIG.commander.assault.minMembers)) {
      squad.mission = null
      ctx.commander.lastFailTick = ctx.tick
      logEvent(ctx, 'command', `${squad.name} broke off its assault on the hive`, leader)
    }

    const ammo = alive.reduce((sum, s) => sum + (s.weapon ? roundsLeft(s.weapon) : 0), 0)
    // Low on ammo, and somewhere still has some to restock from.
    const restockAt = roomsWith(ctx.supplies, 'rifleMags', leader)[0] ?? null
    const lowAmmo = !!restockAt && ammo < alive.length * CONFIG.combat.weapons.rifle.magazine * S.lowAmmoShare

    // Regrouped: back on duty (they cut their way out of any welds on the way).
    if (squad.order === 'retreat' && squad.morale >= S.morale.regroupAt) {
      setOrder(squad, 'patrol', null)
      logEvent(ctx, 'command', `${squad.name} has regrouped and is back on duty`, leader)
    }
    // Pick the order (see the list at the top of this file).
    if (squad.order === 'retreat' ? squad.morale < S.morale.regroupAt : squad.morale < S.morale.breakAt) {
      // During an evacuation they fall back to the Landing Pad, not into Security.
      const pad = ctx.commander.evacuation !== 'none' && ctx.commander.evacuation !== 'gone' ? landingPad(ctx) : null
      if (squad.order !== 'retreat') setOrder(squad, 'retreat', pad ? randomTileIn(ctx.world, pad, ctx.rng) : roomGoal(ctx, ['security'], leader))
    } else if (squad.order === 'resupply' || lowAmmo) {
      if (squad.order !== 'resupply') setOrder(squad, 'resupply', restockAt ? randomTileIn(ctx.world, restockAt, ctx.rng) : roomGoal(ctx, ['armory'], leader))
    } else if (squad.guardId >= 0 && padWork(squad, ctx)) {
      // The command squad is busy setting up the Landing Pad (the Commander waits there).
    } else if (squad.guardId >= 0 && !(squad.order === 'guard' && !myrrSeen &&
        squad.mission === 'escort' && ctx.commander.evacuation === 'fortify' && fortifyPad(squad, squads, ctx))) {
      guardCommander(squad, leader, myrrSeen, ctx)
    } else if (squad.mission === 'assault' && ctx.hive.escapeTo && ctx.agents[ctx.hive.motherId] && !ctx.agents[ctx.hive.motherId].dead) {
      // The Brood Mother is getting away: catching her comes first (they still shoot on the move).
      setOrder(squad, 'assault', tileOf(ctx.agents[ctx.hive.motherId]))
      squad.missionGoal = squad.goal
    } else if (carrier) {
      setOrder(squad, 'rescue', tileOf(carrier))
      squad.targetId = carrier.id
    } else if (squad.escortId >= 0 && stillEscorting(squad, ctx)) {
      // Walking a rescued person to the med bay: stay with them until they're in
      // (they shoot anything that comes near, but don't leave them to chase it).
      setOrder(squad, 'guide', tileOf(ctx.agents[squad.escortId]))
      squad.targetId = squad.escortId
    } else if (myrrSeen) {
      setOrder(squad, 'respond', tileOf(myrrSeen))
    } else if (squad.order === 'guide') {
      setOrder(squad, 'patrol', null)
    } else if (cocoon && squad.order !== 'cut') {
      setOrder(squad, 'cut', tileOf(cocoon))
      squad.targetId = cocoon.id
    } else if (squad.mission === 'escort' && ctx.commander.evacuation === 'fortify' && (squad.order === 'patrol' || squad.order === 'escort') && fortifyPad(squad, squads, ctx)) {
      // Setting up turrets around the Landing Pad (fortifyPad gave the order).
    } else if (squad.mission && (squad.order === 'patrol' || squad.order === squad.mission)) {
      // Assaults hunt the Brood Mother wherever she is (and chase her if she flees).
      const mother = ctx.agents[ctx.hive.motherId]
      if (squad.mission === 'assault' && mother && !mother.dead) squad.missionGoal = tileOf(mother)
      if (!squad.missionGoal) squad.missionGoal = missionGoal(squad, ctx)
      if (squad.missionGoal) setOrder(squad, squad.mission, squad.missionGoal)
    } else if (squad.order === 'cover' || (squad.order === 'patrol' && !squad.mission && squad.guardId < 0 && repairToCover(squad, squads, ctx) >= 0)) {
      coverRepair(squad, squads, ctx)
    } else if (squad.order === 'patrol' && squad.charges > 0 && blastSite(ctx)) {
      setOrder(squad, 'blast', blastSite(ctx))
    } else if (heard && squad.order === 'patrol') {
      setOrder(squad, 'respond', { levelIndex: heard.levelIndex, x: Math.floor(heard.x), y: Math.floor(heard.y) })
      squad.lastContactTick = ctx.tick
    } else if (squad.order === 'patrol' && squad.carryingTurret) {
      const site = deploySite(ctx, reservedSites(squads))
      if (site) setOrder(squad, 'deployTurret', site)
    } else if (squad.order === 'patrol' && !squad.carryingTurret && armoryWithTurret(ctx, CONFIG.commander.evacuation.padTurrets) && deploySite(ctx, reservedSites(squads))) {
      setOrder(squad, 'fetchTurret', randomTileIn(ctx.world, armoryWithTurret(ctx, CONFIG.commander.evacuation.padTurrets)!, ctx.rng))
    } else if (squad.order === 'patrol' && turretToReload(ctx, leader)) {
      const t = turretToReload(ctx, leader)!
      setOrder(squad, 'reload', tileOf(t))
      squad.targetId = t.id
    } else if (squad.order === 'respond' && ctx.tick - squad.lastContactTick > S.respondGiveUpSeconds * TPS) {
      setOrder(squad, 'patrol', null)
    } else if (squad.order === 'rescue' || (squad.order === 'cut' && !isCocooned(ctx, squad.targetId))) {
      setOrder(squad, 'patrol', null)
    }
    // The command squad never leaves the Commander: when it has to go somewhere, he goes with it.
    if (squad.guardId >= 0) ctx.commander.escortTo = STAY_WITH_COMMANDER.has(squad.order) ? null : tileOf(leader)
  }
}

/** A walkable spot within searchRadius tiles of the leader, to look around. */
function searchSpot(leader: Agent, ctx: CombatContext): PathNode | null {
  const level = ctx.world.levels[leader.levelIndex]
  const r = S.searchRadius
  for (let tries = 0; tries < 12; tries++) {
    const x = Math.floor(leader.x) + ctx.rng.int(-r, r), y = Math.floor(leader.y) + ctx.rng.int(-r, r)
    if (canWalk(level, x, y, 'human')) return { levelIndex: leader.levelIndex, x, y }
  }
  return null
}

/** Where a mission sends the squad: the Hive Core, or the Landing Pad. */
function missionGoal(squad: Squad, ctx: CombatContext): PathNode | null {
  if (squad.mission === 'assault') {
    const hive = findRooms(ctx.world, ['hive'])[0]
    return hive ? randomTileIn(ctx.world, hive, ctx.rng) : null
  }
  const pad = landingPad(ctx)
  return pad ? randomTileIn(ctx.world, pad, ctx.rng) : null
}

// ---------------------------------------------------------------- each soldier

export function updateSoldier(agent: Agent, squads: Squad[], ctx: CombatContext): void {
  const squad = squads[agent.soldier!.squadId]
  shoot(agent, ctx)

  if (agent.state.name === 'crossing') {
    followPath(agent, ctx.world)
    return
  }
  const alive = members(squad, ctx)
  const leader = alive[0]
  if (squad.scouting?.scoutId === agent.id && agent !== leader) return updateScout(agent, squad, leader, ctx)
  if (agent.soldier!.role === 'medic' && treatPatients(agent, ctx)) return
  if (agent === leader) leadSquad(agent, squad, alive, squads, ctx)
  else follow(agent, leader, alive.indexOf(agent), ctx)
}

/** Shoot the nearest Myrr in reach (re-checked a few times a second). */
function shoot(agent: Agent, ctx: CombatContext): void {
  const s = agent.soldier!
  let target = s.targetId >= 0 ? ctx.agents[s.targetId] : null
  if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0 || !target || target.dead) {
    const range = agent.weapon ? CONFIG.combat.weapons[agent.weapon.kind].range : 0
    target = nearestVisible(agent, ctx, range, (a) => a.side === 'myrr')
    s.targetId = target ? target.id : -1
  }
  if (target) tryAttack(agent, target, ctx)
}

function leadSquad(agent: Agent, squad: Squad, alive: Agent[], squads: Squad[], ctx: CombatContext): void {
  const s = agent.soldier!
  // Carrying a packed turret slows the leader (and so the squad).
  agent.speed = agent.baseSpeed * (squad.carryingTurret ? CONFIG.turrets.carrySpeedMultiplier : 1)
  // A scout is checking the landing below: wait at the top of the elevator.
  if (waitForScout(squad, agent, ctx)) return

  // Timed work at the goal: restocking, cutting a cocoon, pausing on patrol.
  if (squad.ticksLeft > 0) {
    if (--squad.ticksLeft === 0) {
      if (squad.burnAt) throwIncendiary(squad, alive, ctx)
      else finishWork(squad, alive, squads, ctx)
    }
    return
  }

  // Chasing a moving target: keep the goal on it.
  if ((squad.order === 'rescue' || squad.order === 'guide') && squad.targetId >= 0) {
    const carrier = ctx.agents[squad.targetId]
    if (carrier && !carrier.dead) squad.goal = tileOf(carrier)
  }
  if (squad.order === 'patrol' && !squad.goal) {
    squad.patrolIndex = (squad.patrolIndex + 1) % squad.patrol.length
    squad.goal = randomTileIn(ctx.world, squad.patrol[squad.patrolIndex], ctx.rng)
  }
  const goal = squad.goal
  if (!goal) return

  const here = tileOf(agent)
  const arrived = here.levelIndex === goal.levelIndex && Math.hypot(here.x - goal.x, here.y - goal.y) <= S.arriveDistance
  if (arrived) {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    if (squad.order === 'patrol') { squad.ticksLeft = S.patrolPauseSeconds * TPS; squad.goal = null }
    if (squad.order === 'resupply') squad.ticksLeft = Math.round(S.resupplySeconds * TPS)
    if (squad.order === 'retreat' && !squad.welded && !onPad(alive[0], ctx)) squad.ticksLeft = Math.round(CONFIG.barriers.weldSeconds * TPS)
    if (squad.order === 'reload') squad.ticksLeft = Math.round(CONFIG.turrets.reloadSeconds * TPS)
    if (squad.order === 'fetchTurret') squad.ticksLeft = Math.round(CONFIG.turrets.pickupSeconds * TPS)
    if (squad.order === 'packTurret') squad.ticksLeft = Math.round(CONFIG.turrets.packSeconds * TPS)
    if (squad.order === 'deployTurret') squad.ticksLeft = Math.round(CONFIG.turrets.setupSeconds * TPS)
    if (squad.order === 'blast') squad.ticksLeft = Math.round(CONFIG.charges.setSeconds * TPS)
    if (squad.order === 'cut') squad.ticksLeft = Math.round(S.cutSeconds * TPS)
    if (squad.order === 'guide') squad.goal = null
    // Responding: nothing here, so search a couple of places nearby before giving up.
    if (squad.order === 'respond') {
      squad.goal = squad.searches < S.searchSpots ? searchSpot(agent, ctx) : null
      squad.searches++
    }
    if (squad.order === 'assault' || squad.order === 'escort') squad.missionReached = true
    if (squad.order === 'assault') squad.goal = null // keep closing in on the target
    return
  }
  // Re-plan when the goal moves or the leader stopped; to the same goal only now and then
  // (in case a door was welded or a tunnel dug), as path-finding is the sim's biggest cost.
  const goalKey = goal.levelIndex * 1e6 + goal.y * 1e3 + goal.x
  if (agent.state.name !== 'moving' || (ctx.tick >= s.repathTick && (goalKey !== s.pathGoal || ctx.tick >= s.samePathUntil))) {
    s.repathTick = ctx.tick + TPS
    if (goalKey !== s.pathGoal || ctx.tick >= s.samePathUntil) s.samePathUntil = ctx.tick + Math.round(S.repathSameGoalSeconds * TPS)
    s.pathGoal = goalKey
    walkTo(agent, goal, ctx)
  }
  if (startScouting(squad, agent, alive, ctx)) return
  // Deep in the mines with resin ahead: light a flare to show anything hiding in it.
  if (squad.flares > 0 && agent.levelIndex > 0 && (ctx.tick + agent.id) % CONFIG.perception.intervalTicks === 0) lightFlareAhead(squad, agent, ctx)
  // Burn the resin ahead before walking into it (after an ambush), unless lives are at stake.
  if (wantsToBurn(squad, ctx)) {
    const spot = resinAhead(agent, ctx)
    if (spot && canBurn(squad, alive)) {
      squad.burnAt = spot
      squad.ticksLeft = Math.round(CONFIG.incendiaries.throwSeconds * TPS)
      agent.state = { name: 'idle', ticksLeft: 0 }
      return
    }
  }
  followPath(agent, ctx.world)
}

function finishWork(squad: Squad, alive: Agent[], squads: Squad[], ctx: CombatContext): void {
  if (squad.order === 'fetchTurret') {
    const stock = stockIn(ctx.supplies, roomAt(ctx.world, tileOf(alive[0])))
    if (stock && take(stock, 'turrets', 1)) squad.carryingTurret = true
    setOrder(squad, 'patrol', null) // the brain sends a carrying squad to deploy next
    return
  }
  if (squad.order === 'packTurret') {
    const turret = ctx.agents[squad.targetId]
    const leader = alive[0]
    if (turret && !turret.dead && !squad.carryingTurret && turret.levelIndex === leader.levelIndex && Math.hypot(turret.x - leader.x, turret.y - leader.y) <= S.packReach) {
      turret.dead = true // packed up: off the map until set up again
      squad.carryingTurret = true
      squad.turretAmmo = turret.weapon?.inMag ?? null
      logEvent(ctx, 'gear', `${squad.name} packed up a turret on Level ${turret.levelIndex + 1} to move it to the Landing Pad`, turret)
    }
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'deployTurret') {
    if (squad.carryingTurret) {
      const turret = createTurret(ctx.agents.length, squad.goal!)
      if (squad.turretAmmo !== null) turret.weapon!.inMag = squad.turretAmmo
      squad.turretAmmo = null
      ctx.agents.push(turret)
      logEvent(ctx, 'gear', `${squad.name} set up a sentry turret on Level ${squad.goal!.levelIndex + 1}`, squad.goal)
      squad.carryingTurret = false
    }
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'reload') {
    // Feed spare rifle magazines into the turret.
    const turret = ctx.agents[squad.targetId]
    const giver = alive.find((s) => s.weapon?.kind === 'rifle' && s.weapon.spare > 0)
    if (turret?.weapon && giver?.weapon) {
      const mags = Math.min(CONFIG.turrets.reloadMags, giver.weapon.spare)
      giver.weapon.spare -= mags
      turret.weapon.inMag = Math.min(CONFIG.combat.weapons.turret.magazine, turret.weapon.inMag + mags * CONFIG.combat.weapons.rifle.magazine * 2)
    }
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'blast') {
    // Back off and set it off: the tunnel collapses into rock for good.
    const at = squad.goal!
    const level = ctx.world.levels[at.levelIndex]
    const collapsed = new Set(collapseTunnel(ctx.world, at, CONFIG.charges.radius))
    for (const a of ctx.agents) {
      if (!a.dead && a.levelIndex === at.levelIndex && collapsed.has(Math.floor(a.y) * level.width + Math.floor(a.x))) kill(a, ctx)
    }
    makeNoise(ctx.noises, 'blast', at.levelIndex, at.x, at.y, ctx.tick, alive[0].id)
    squad.charges--
    logEvent(ctx, 'gear', `${squad.name} collapsed a tunnel on Level ${at.levelIndex + 1} with a mining charge`, at)
    ctx.hive.resinTiles = countResin(ctx.world)
    setOrder(squad, 'patrol', null)
    return
  }
  if (squad.order === 'retreat') {
    // Fallen back: weld the doors and board the windows of the room they're in.
    const room = roomAt(ctx.world, tileOf(alive[0]))
    const level = ctx.world.levels[alive[0].levelIndex]
    if (room) for (const o of roomOpenings(ctx.world, room)) {
      if (level.barrier[o.tile] <= 0) putBarrier(level, o.tile, o.kind === Barrier.Boards ? Barrier.Boards : Barrier.Weld)
    }
    squad.welded = true
    logEvent(ctx, 'command', `${squad.name} fell back and welded itself in`, alive[0])
    return
  }
  if (squad.order === 'resupply') {
    // Restock from what this room actually has.
    const stock = stockIn(ctx.supplies, roomAt(ctx.world, tileOf(alive[0])))
    for (const s of alive) {
      const w = s.weapon
      if (w && stock && w.kind !== 'flamethrower') { // flamethrower fuel isn't stocked
        const item = w.kind === 'rifle' ? 'rifleMags' : 'pistolMags'
        w.spare += take(stock, item, Math.max(0, CONFIG.combat.spareMagazines - w.spare))
        if (w.inMag === 0 && w.spare > 0 && w.reloading === 0) { w.inMag = CONFIG.combat.weapons[w.kind].magazine; w.spare-- }
      }
      if (s.soldier!.role === 'medic' && stock) s.soldier!.stabilizers += take(stock, 'stabilizers', S.stabilizers - s.soldier!.stabilizers)
    }
    if (stock) squad.incendiaries += take(stock, 'incendiaries', CONFIG.incendiaries.perSquad - squad.incendiaries)
    if (stock) squad.flares += take(stock, 'flares', CONFIG.flares.perSquad - squad.flares)
    setOrder(squad, 'patrol', null)
  } else if (squad.order === 'cut') {
    const person = ctx.agents[squad.targetId]
    if (person?.civ && person.civ.mode === 'cocooned') {
      // Cut free, but still infected and weak: they need the med bay, and help getting there.
      person.civ.rescued = true
      ctx.stats.cutFree++
      person.health = Math.min(person.health, S.rescuedHealth)
      person.baseSpeed = CONFIG.movement.humanSpeed * S.rescuedSpeed
      person.civ.fear = 0
      setMode(person, person.civ, 'routine')
      if (squad.mission === 'assault') {
        const escort = detachEscort(squad, person, squads, ctx)
        logEvent(ctx, 'rescue', escort
          ? `Soldiers cut ${who(person, true)} free from a cocoon; ${members(escort, ctx).length === 1 ? 'one of them takes' : `${escort.name} (${members(escort, ctx).length}) splits off to take`} them to the med bay while the rest fight on`
          : `Soldiers cut ${who(person, true)} free from a cocoon; nobody can be spared, so they must make their own way to the med bay`, person)
      } else {
        logEvent(ctx, 'rescue', `Soldiers cut ${who(person, true)} free from a cocoon and walk them to the med bay`, person)
        squad.escortId = person.id
        setOrder(squad, 'guide', tileOf(person))
        squad.targetId = person.id
        return
      }
    }
    setOrder(squad, 'patrol', null)
  }
}

/** Spots around the leader, one per follower, so the squad spreads out instead of stacking. */
const FORMATION: readonly [number, number][] = [[-1, 1], [1, 1], [-1, -1], [1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]]

function follow(agent: Agent, leader: Agent, slot: number, ctx: CombatContext): void {
  const s = agent.soldier!
  const far = agent.levelIndex !== leader.levelIndex || dist(agent, leader) > S.followDistance
  // Re-plan about once a second, staggered by id so followers don't move in lockstep.
  if (far && (ctx.tick >= s.repathTick || agent.state.name !== 'moving')) {
    s.repathTick = ctx.tick + TPS + (agent.id % 7)
    walkTo(agent, formationSpot(leader, slot, ctx), ctx)
  }
  if (agent.state.name === 'moving') followPath(agent, ctx.world)
}

/** This follower's spot next to the leader (the next free one if that tile is blocked). */
function formationSpot(leader: Agent, slot: number, ctx: CombatContext): PathNode {
  const at = tileOf(leader)
  const level = ctx.world.levels[at.levelIndex]
  for (let k = 0; k < FORMATION.length; k++) {
    const [dx, dy] = FORMATION[(slot - 1 + k) % FORMATION.length]
    if (canWalk(level, at.x + dx, at.y + dy, 'human')) return { levelIndex: at.levelIndex, x: at.x + dx, y: at.y + dy }
  }
  return at
}

/** The squad whose leader is closest to a spot (another level counts as far away). */
function nearestSquad(squads: Squad[], at: { levelIndex: number; x: number; y: number }, ctx: CombatContext): Squad | null {
  let best: Squad | null = null, bestD = Infinity
  for (const sq of squads) {
    const leader = members(sq, ctx)[0]
    if (!leader) continue
    const d = roughDistance(leader, at)
    if (d < bestD) { best = sq; bestD = d }
  }
  return best
}
