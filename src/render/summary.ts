// End-of-run summary: shown over the map when the run ends. Plain DOM.

import type { SimState } from '../sim.ts'
import { ENDING_TEXT } from '../systems/endings.ts'
import { formatClock } from '../core/clock.ts'
import { CONFIG } from '../config.ts'

/** Event kinds worth listing as key moments. */
const KEY_KINDS = new Set(['contact', 'death', 'power', 'gear', 'hive', 'command', 'rescue', 'cure', 'ending'])
const MAX_KEY_MOMENTS = 25

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
    <h3>Key moments</h3>
    <ol class="moments"></ol>
    <button type="button">New run (next seed)</button>`
  panel.querySelector('h2')!.textContent = e.title
  panel.querySelector('.line')!.textContent = e.line
  panel.querySelector('.meta')!.textContent =
    `Seed ${sim.seed} · ended ${formatClock(sim.ending.tick)} · ${colonyHours.toFixed(1)} colony hours (${minutes.toFixed(1)} real minutes)`
  const list = panel.querySelector('.moments')!
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
