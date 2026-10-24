// The event log and run statistics: key moments of a run, for the sidebar and
// the run summary at the end.

export type EventKind =
  | 'contact' | 'capture' | 'injected' | 'hatch' | 'rescue' | 'cure' | 'death'
  | 'power' | 'gear' | 'hive' | 'command' | 'ending'

export interface GameEvent {
  tick: number
  kind: EventKind
  text: string
}

export interface RunStats {
  captures: number
  /** Captives dropped when their carrier was killed. */
  dropped: number
  /** People cut free from cocoons. */
  cutFree: number
  cures: number
  civiliansKilled: number
  soldiersKilled: number
  hatched: number
  myrrKilled: { taker: number; spineback: number; broodling: number; mother: number }
  evacuated: number
  /** Someone has seen a Myrr. */
  contact: boolean
}

export function createStats(): RunStats {
  return {
    captures: 0, dropped: 0, cutFree: 0, cures: 0, civiliansKilled: 0, soldiersKilled: 0, hatched: 0,
    myrrKilled: { taker: 0, spineback: 0, broodling: 0, mother: 0 }, evacuated: 0, contact: false,
  }
}

/** Where events are written. Shared by everything that can log. */
export interface Log {
  events: GameEvent[]
  stats: RunStats
  tick: number
}

export function logEvent(log: Log, kind: EventKind, text: string): void {
  log.events.push({ tick: log.tick, kind, text })
}
