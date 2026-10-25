// One-line descriptions of agents, for the debug readout and the event log.

import type { Agent } from './agent.ts'

/** A short name: "a miner", "a medic", "Taker #12". */
export function who(agent: Agent): string {
  if (agent.kind === 'commander') return 'The Commander'
  if (agent.soldier) return agent.soldier.role === 'medic' ? 'A medic' : 'A soldier'
  if (agent.civ) return 'A ' + agent.civ.job
  if (agent.kind === 'brood-mother') return 'The Brood Mother'
  return agent.kind[0].toUpperCase() + agent.kind.slice(1) + ' #' + agent.id
}

export function describeAgent(agent: Agent, tick: number): string {
  const civ = agent.civ
  if (agent.kind === 'turret') return 'Sentry turret #' + agent.id + ' · ammo ' + (agent.weapon?.inMag ?? 0) + ' · battery ' + Math.round((agent.battery ?? 0) / 20) + 's · health ' + Math.round(agent.health)
  if (agent.soldier && civ) {
    const w = agent.weapon
    const ammo = w ? `${w.inMag}+${w.spare} mags` : ''
    const meds = agent.soldier.role === 'medic' ? ` · ${agent.soldier.stabilizers} stabilizers${agent.soldier.patientId >= 0 ? ` · treating #${agent.soldier.patientId}` : ''}` : ''
    return `${agent.soldier.role === 'medic' ? 'Medic' : 'Soldier'} #${agent.id}${meds} · squad ${agent.soldier.squadId + 1} · ${civ.mode === 'routine' ? 'on duty' : civ.mode} · health ${Math.round(agent.health)} · ${w?.kind} ${ammo}`
  }
  if (civ) {
    const shift = `${String(civ.shiftStart).padStart(2, '0')}:00 shift`
    const doing = civ.mode === 'routine' ? `${civ.activity}${civ.target ? ` → ${civ.target.room.name}` : ''}` : civ.mode
    const inf = civ.infection ? ` · INFECTED (hatches in ${Math.max(0, Math.round((civ.infection.hatchTick - tick) / 20))}s${tick < civ.infection.stabilizedUntilTick ? ', stabilized' : ''})` : ''
    return `Civilian #${agent.id} · ${civ.trait ? civ.trait + ' ' : ''}${civ.job} (${shift}) · ${doing}${inf} · health ${Math.round(agent.health)} · fear ${civ.fear.toFixed(2)} · home ${civ.home.room.name}`
  }
  const m = agent.myrr
  if (m?.role === 'mother') return `Brood Mother #${agent.id} · ${m.task === 'inject' ? `injecting #${m.targetId}` : m.task} · health ${Math.round(agent.health)}${m.lastChoice ? ` · last chose ${m.lastChoice}` : ''}`
  if (m?.role === 'broodling') return `Broodling #${agent.id} · grows up in ${Math.ceil(m.ticksLeft / 20)}s`
  if (m?.role === 'spineback') return `Spineback #${agent.id} · ${m.task === 'respond' ? 'answering alarm' : 'guarding'} · health ${Math.round(agent.health)}`
  if (agent.dead) return `${agent.kind} #${agent.id} · dead`
  if (m) return `Taker #${agent.id}${m.task === 'dig' ? ' · DIGGING' : m.task === 'haulCarry' ? ' · CARRYING A COCOON' : m.task === 'decoy' ? ' · DECOY' : ''} · health ${Math.round(agent.health)} · ${m.task}${m.targetId >= 0 ? ` · target #${m.targetId}` : ''}${m.lastChoice ? ` · last chose ${m.lastChoice}` : ''}`
  return `Myrr #${agent.id} · ${agent.state.name}`
}
