// The hive forgets: a trick it has learned (lying in wait at generators it broke, or
// staking out an elevator landing) is dropped once it keeps costing Myrr. The hive
// then has to notice the pattern all over again, and won't start for a while.
// A Myrr is "on" a trick from when it is sent until windowSeconds later; dying in
// that time counts as a loss for the trick, and a capture it makes counts as a win.

import { CONFIG } from '../config.ts'
import { logEvent } from '../core/events.ts'
import type { Agent } from './agent.ts'
import type { HiveContext, MyrrData, Tactic } from './myrrData.ts'

const TPS = CONFIG.sim.ticksPerSecond
const FG = CONFIG.hive.forget

const NAMES: Record<Tactic, string> = {
  repairAmbush: 'lying in wait for engineers at broken generators',
  stakeout: 'staking out the elevator landing',
}

/** Mark a Myrr as sent on a trick. */
export function startTactic(m: MyrrData, tactic: Tactic, tick: number): void {
  m.tactic = tactic
  m.tacticTick = tick
}

/** Is this Myrr still counted as on its trick? */
function onTactic(m: MyrrData, tick: number): boolean {
  return m.tactic !== null && tick - m.tacticTick <= FG.windowSeconds * TPS
}

/** Can the hive learn this trick (again) yet? */
export function canLearn(ctx: HiveContext, tactic: Tactic): boolean {
  return ctx.tick >= ctx.hive.relearnAfter[tactic]
}

/** A Myrr died: if it was on a trick, the hive doubts it more; enough doubt and it forgets. */
export function tacticLoss(agent: Agent, ctx: HiveContext): void {
  const m = agent.myrr
  if (!m || !onTactic(m, ctx.tick)) return
  const hive = ctx.hive
  const t = m.tactic!
  m.tactic = null
  if (++hive.doubts[t] < FG.losses) return
  hive.doubts[t] = 0
  hive.relearnAfter[t] = ctx.tick + Math.round(FG.relearnAfterSeconds * TPS)
  if (t === 'repairAmbush') { hive.ambushLearned = false; hive.repairsSeen = 0 }
  else { hive.landing.ridesSeen = 0 }
  logEvent(ctx, 'hive', `The hive gives up ${NAMES[t]}: it cost too many Myrr`, agent)
}

/** A Myrr on a trick caught someone: the trick paid off, so the hive doubts it less. */
export function tacticWin(m: MyrrData, ctx: HiveContext): void {
  if (!onTactic(m, ctx.tick)) return
  const t = m.tactic!
  ctx.hive.doubts[t] = Math.max(0, ctx.hive.doubts[t] - 1)
  m.tactic = null
}
