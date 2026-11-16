// Medics: wake paralysed people and stabilize infected ones when it's safe.

import { CONFIG } from '../config.ts'
import { tileOf, type Agent } from './agent.ts'
import { followPath } from './movement.ts'
import { nearestVisible } from './combat.ts'
import type { CivilianContext as CombatContext } from './civilian.ts'
import { dist, walkTo, type SoldierData } from './squad.ts'

const TPS = CONFIG.sim.ticksPerSecond
const S = CONFIG.soldiers

/**
 * Medic work: wake paralysed people and stabilize infected ones nearby, unless a
 * Myrr is too close. Returns true while busy (the medic doesn't follow the squad).
 */
export function treatPatients(agent: Agent, ctx: CombatContext): boolean {
  const s = agent.soldier!
  if (s.patientId < 0) {
    if ((ctx.tick + agent.id) % CONFIG.perception.intervalTicks !== 0) return false
    if (nearestVisible(agent, ctx, S.unsafeRange, (a) => a.side === 'myrr')) return false
    const patient = nearestVisible(agent, ctx, S.patientRange, (a) => !!needsCare(a, s, ctx))
    if (!patient) return false
    s.patientId = patient.id
    s.workTicks = Math.round((needsCare(patient, s, ctx) === 'wake' ? S.wakeSeconds : S.stabilizeSeconds) * TPS)
  }

  const patient = ctx.agents[s.patientId]
  const care = patient && needsCare(patient, s, ctx)
  if (!care || nearestVisible(agent, ctx, S.unsafeRange, (a) => a.side === 'myrr')) {
    s.patientId = -1
    return false
  }

  if (patient.levelIndex === agent.levelIndex && dist(agent, patient) <= S.arriveDistance) {
    agent.path = []
    agent.state = { name: 'idle', ticksLeft: 0 }
    if (--s.workTicks > 0) return true
    const civ = patient.civ!
    if (care === 'wake') {
      civ.paralyzedUntilTick = ctx.tick // wakes up on its own next tick
    } else if (civ.infection) {
      // Pause the larva: push the hatch time back by the pause.
      const pause = Math.round(S.stabilizerPauseSeconds * TPS)
      civ.infection.stabilizedUntilTick = ctx.tick + pause
      civ.infection.hatchTick += pause
      s.stabilizers--
    }
    s.patientId = -1
    return false
  }

  if (ctx.tick >= s.repathTick || agent.state.name !== 'moving') {
    s.repathTick = ctx.tick + TPS
    walkTo(agent, tileOf(patient), ctx)
  }
  followPath(agent, ctx.world)
  return true
}

/** What a person needs from a medic, if anything. */
export function needsCare(a: Agent, medic: SoldierData, ctx: CombatContext): 'wake' | 'stabilize' | null {
  const civ = a.civ
  if (!civ || a.dead || a.side !== 'human') return null
  if (civ.mode === 'paralyzed') return 'wake'
  if (civ.infection && ctx.tick >= civ.infection.stabilizedUntilTick && medic.stabilizers > 0 &&
      civ.mode !== 'cocooned' && civ.mode !== 'captured' && civ.mode !== 'captive') return 'stabilize'
  return null
}
