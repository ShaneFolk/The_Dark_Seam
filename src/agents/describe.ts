// One-line descriptions of agents, for the debug readout.

import type { Agent } from './agent.ts'

export function describeAgent(agent: Agent): string {
  const civ = agent.civ
  if (civ) {
    const shift = `${String(civ.shiftStart).padStart(2, '0')}:00 shift`
    const doing = civ.mode === 'routine' ? `${civ.activity}${civ.target ? ` → ${civ.target.room.name}` : ''}` : civ.mode
    return `Civilian #${agent.id} · ${civ.job} (${shift}) · ${doing} · fear ${civ.fear.toFixed(2)} · home ${civ.home.room.name}`
  }
  return `Myrr #${agent.id} · ${agent.state.name}`
}
