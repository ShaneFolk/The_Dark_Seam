// End-of-run summary: shown over the map when the run ends. Plain DOM.

import type { SimState } from '../sim.ts'
import { ENDING_TEXT } from '../systems/endings.ts'
import { formatClock } from '../core/clock.ts'
import { CONFIG } from '../config.ts'
import { who } from '../agents/describe.ts'
import type { GameEvent } from '../core/events.ts'

/** Event kinds worth listing as key moments. */
const KEY_KINDS = new Set(['contact', 'death', 'power', 'gear', 'hive', 'command', 'rescue', 'cure', 'ending', 'player'])
const MAX_KEY_MOMENTS = 25
const MAX_FATES = 14

/** A short word for what an event meant for the person it was about. */
function fateStep(ev: GameEvent): string | null {
  switch (ev.kind) {
    case 'capture': return 'taken'
    case 'injected': return 'cocooned'
    case 'hatch': return 'a Broodling burst out'
    case 'cure': return 'cured'
    case 'death': return 'killed'
    case 'rescue': return ev.text.includes('dropped') ? 'dropped by their Taker' : 'cut free'
    case 'command': return ev.text.includes('volunteers') ? 'volunteered to fight' : null
    default: return null
  }
}

/**
 * One line per person with a story (taken, cut free, cured, killed...), built from
 * the event log: "Miner Edda Rusk: taken D1 13:40 → cocooned → cut free → cured → evacuated".
 */
function fates(sim: SimState): string[] {
  const steps = new Map<number, string[]>()
  for (const ev of sim.events) {
    if (ev.agentId === undefined || !sim.agents[ev.agentId]?.civ) continue
    const step = fateStep(ev)
    if (!step) continue
    const list = steps.get(ev.agentId) ?? []
    list.push(list.length ? step : `${step} ${formatClock(ev.tick).replace('Day ', 'D').replace(' ·', '')}`)
    steps.set(ev.agentId, list)
  }
  const lines: string[] = []
  for (const [id, list] of steps) {
    const a = sim.agents[id]
    const mode = a.civ!.mode
    const end = mode === 'evacuated' ? 'evacuated' : a.dead ? null : mode === 'cocooned' ? 'still cocooned' : mode === 'captive' || mode === 'captured' ? 'still held' : 'alive at the end'
    if (end) list.push(end)
    lines.push(`${who(a)}: ${list.join(' → ')}`)
  }
  // The longest stories first.
  return lines.sort((x, y) => y.split('→').length - x.split('→').length).slice(0, MAX_FATES)
}

export function showSummary(sim: SimState): void {
  if (!sim.ending || document.querySelector('.summary')) return
  const s = sim.stats
  const e = ENDING_TEXT[sim.ending.kind]
  const minutes = sim.ending.tick / CONFIG.sim.ticksPerSecond / 60
  const colonyHours = (sim.ending.tick / (CONFIG.clock.dayLengthMinutes * 60 * CONFIG.sim.ticksPerSecond)) * 24
  const moments = sim.events.filter((ev) => KEY_KINDS.has(ev.kind))
  // Keep the first few and the last ones if there are too many.
  const shown = moments.length > MAX_KEY_MOMENTS
    ? [...moments.slice(0, 10), null, ...moments.slice(-(MAX_KEY_MOMENTS - 10))]
    : moments

  const panel = document.createElement('div')
  panel.className = 'summary'
  panel.innerHTML = `
    <h2></h2>
    <p class="line"></p>
    <p class="meta"></p>
    <table>
      <tr><th>People taken</th><td>${s.captures}</td><th>Myrr killed</th><td>${s.myrrKilled.taker} Takers, ${s.myrrKilled.spineback} Spinebacks, ${s.myrrKilled.broodling} Broodlings${s.myrrKilled.mother ? ', the Brood Mother' : ''}</td></tr>
      <tr><th>Hatched (hosts lost)</th><td>${s.hatched}</td><th>Civilians killed</th><td>${s.civiliansKilled}</td></tr>
      <tr><th>Rescued</th><td>${s.cutFree} cut free, ${s.dropped} dropped</td><th>Soldiers killed</th><td>${s.soldiersKilled}</td></tr>
      <tr><th>Cured</th><td>${s.cures}</td><th>Evacuated</th><td>${s.evacuated}</td></tr>
    </table>
    <h3>People</h3>
    <ul class="moments fates"></ul>
    <h3>Key moments</h3>
    <ol class="moments"></ol>
    <button type="button">New run (next seed)</button>`
  panel.querySelector('h2')!.textContent = e.title
  panel.querySelector('.line')!.textContent = e.line
  panel.querySelector('.meta')!.textContent =
    `Seed ${sim.seed} · ended ${formatClock(sim.ending.tick)} · ${colonyHours.toFixed(1)} colony hours (${minutes.toFixed(1)} real minutes)`
  const people = fates(sim)
  const fateList = panel.querySelector('.fates')!
  for (const line of people.length ? people : ['Nobody was taken.']) {
    const li = document.createElement('li')
    li.textContent = line
    fateList.appendChild(li)
  }
  const list = panel.querySelector('ol.moments')!
  for (const ev of shown) {
    const li = document.createElement('li')
    li.textContent = ev ? `${formatClock(ev.tick)} — ${ev.text}` : '…'
    list.appendChild(li)
  }
  panel.querySelector('button')!.addEventListener('click', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('seed', String(sim.seed + 1))
    window.location.href = url.toString()
  })
  document.body.appendChild(panel)
}
