// Endings: how a run finishes.
//
//   Overrun        no free human left (all dead, captured, held or cocooned)
//   Extermination  every Myrr is dead
//   Escape         the Brood Mother reached the deep tunnels
//   Evacuation     the evacuation ship left with survivors (Phase 8, Round B)

import type { Agent } from '../agents/agent.ts'
import type { HiveState } from '../agents/myrr.ts'
import type { RunStats } from '../core/events.ts'

export type EndingKind = 'overrun' | 'extermination' | 'escape' | 'evacuation'

export interface Ending {
  kind: EndingKind
  tick: number
}

export const ENDING_TEXT: Record<EndingKind, { title: string; line: string }> = {
  overrun: { title: 'Overrun', line: 'The hive has taken Carrow Deep. No free humans remain.' },
  extermination: { title: 'Extermination', line: 'The humans wiped out the hive. Every Myrr is dead.' },
  escape: { title: 'Escape', line: 'The Brood Mother fled into the deep tunnels. The hive will rise again.' },
  evacuation: { title: 'Evacuation', line: 'The survivors got away on the evacuation ship.' },
}

/** Has the run ended? Checked once a second. */
export function checkEnding(agents: Agent[], hive: HiveState, stats: RunStats, tick: number, evacuated: boolean): Ending | null {
  if (evacuated && stats.evacuated > 0) return { kind: 'evacuation', tick }
  if (hive.escaped) return { kind: 'escape', tick }
  const myrrLeft = agents.some((a) => !a.dead && a.side === 'myrr')
  if (!myrrLeft) return { kind: 'extermination', tick }
  const freeHumans = agents.some((a) => !a.dead && a.civ && !['captured', 'captive', 'cocooned', 'dead', 'evacuated'].includes(a.civ.mode))
  if (!freeHumans) return { kind: 'overrun', tick }
  return null
}
