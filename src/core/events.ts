// The event log and run statistics: key moments of a run, for the sidebar and
// the run summary at the end.

export type EventKind =
  | 'contact' | 'capture' | 'injected' | 'hatch' | 'rescue' | 'cure' | 'death'
  | 'power' | 'gear' | 'hive' | 'command' | 'ending'

export interface GameEvent {
  tick: number
  kind: EventKind
  text: string
  /** Where it happened (clicking the log line jumps there), if anywhere in particular. */
  at?: { levelIndex: number; x: number; y: number }
  /** The person or Myrr it happened to, if one: for following them and for the people's fates. */
  agentId?: number
}

/** What an event is about: an agent (its position now, and its id) or just a place. */
export type About = { levelIndex: number; x: number; y: number; id?: number; kind?: string }

export interface RunStats {
  captures: number
  /** Captives dropped when their carrier was killed. */
  dropped: number
  /** People cut free from cocoons. */
  cutFree: number
  /** Brave survivors of a capture who joined a squad. */
  volunteers: number
  cures: number
  civiliansKilled: number
  soldiersKilled: number
  hatched: number
  myrrKilled: { taker: number; spineback: number; broodling: number; mother: number }
  evacuated: number
  /** Blows struck by Myrr from hiding (and how many hit soldiers). */
  ambushes: number
  squadAmbushes: number
  /** Someone has seen a Myrr. */
  contact: boolean
}

export function createStats(): RunStats {
  return {
    captures: 0, dropped: 0, cutFree: 0, volunteers: 0, cures: 0, civiliansKilled: 0, soldiersKilled: 0, hatched: 0,
    myrrKilled: { taker: 0, spineback: 0, broodling: 0, mother: 0 }, evacuated: 0, ambushes: 0, squadAmbushes: 0, contact: false,
  }
}

/** Where events are written. Shared by everything that can log. */
export interface Log {
  events: GameEvent[]
  stats: RunStats
  tick: number
}

export function logEvent(log: Log, kind: EventKind, text: string, about?: About | null): void {
  const ev: GameEvent = { tick: log.tick, kind, text }
  if (about) {
    ev.at = { levelIndex: about.levelIndex, x: Math.floor(about.x), y: Math.floor(about.y) }
    // Agents have a kind; plain places (PathNodes) don't.
    if (about.kind !== undefined && about.id !== undefined) ev.agentId = about.id
  }
  log.events.push(ev)
}
