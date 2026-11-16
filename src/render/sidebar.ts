// Sidebar: one tab per level with its activity counts, plus a controls hint.
// Plain DOM, rebuilt only when something it shows has changed.
// On phones (see style.css) it sits under the map: the clock, speed, toggles and
// level tabs always show; the hive/colony details and the log open with a button.

import { levelActivity, type SimState } from '../sim.ts'
import type { ViewState } from './view.ts'
import { formatClock } from '../core/clock.ts'
import { CONFIG } from '../config.ts'
import { totalStock } from '../systems/supplies.ts'
import { hasPower } from '../systems/power.ts'
import type { GameEvent } from '../core/events.ts'

function commanderLine(sim: SimState): string {
  const c = sim.commander
  const parts: string[] = []
  if (c.second) parts.push('SECOND-IN-COMMAND (the Commander is lost)')
  parts.push(c.alarm ? 'ALARM' : 'no alarm')
  if (c.lockdown) parts.push(c.locked ? 'lockdown' : 'lockdown (no power)')
  const assault = sim.squads.filter((s) => s.mission === 'assault').map((s) => s.name)
  if (assault.length) parts.push('assaulting the hive: ' + assault.join(', '))
  const tps = CONFIG.sim.ticksPerSecond
  if (c.reinforcementsDue !== null) parts.push('drop ship in ' + Math.ceil((c.reinforcementsDue - sim.tick) / tps) + 's')
  else if (!c.reinforcementsCalled) parts.push(`${c.missingKnown} known missing (help is called at ${CONFIG.commander.reinforcements.missingToCall})`)
  if (c.evacuation === 'fortify') parts.push('FORTIFYING THE LANDING PAD')
  if (c.evacuation === 'called') parts.push('evacuation ship in ' + Math.ceil((c.shipLands - sim.tick) / tps) + 's')
  if (c.evacuation === 'landed') parts.push('SHIP AT THE PAD, leaves in ' + Math.ceil((c.shipLeaves - sim.tick) / tps) + 's')
  return parts.join(' · ')
}

/** Soldiers of a squad still in the fight (not dead, taken or evacuated). */
function soldiersLeft(sim: SimState, ids: number[]): number {
  return ids.filter((id) => { const a = sim.agents[id]; return a && !a.dead && !['captive', 'cocooned', 'dead', 'evacuated'].includes(a.civ?.mode ?? 'dead') }).length
}

function stockLine(sim: SimState): string {
  const t = totalStock(sim.supplies)
  return `${t.rifleMags} rifle mags · ${t.pistolMags} pistol mags · ${t.pistols} pistols · ${t.stabilizers} stabilizers · ${t.incendiaries} incendiaries · ${t.flares} flares`
}

export class Sidebar {
  private buttons: HTMLButtonElement[] = []
  private clock: HTMLElement
  private hiveInfo: HTMLElement
  private log: HTMLOListElement
  private logCount = -1
  private lastShown = ''
  private speedButtons: { btn: HTMLButtonElement; speed: number }[] = []
  private scentBtn: HTMLButtonElement
  private artBtn: HTMLButtonElement

  /** Called when a log line with a place is clicked. */
  private onJump: (ev: GameEvent) => void

  constructor(root: HTMLElement, sim: SimState, view: ViewState, onSelect: (levelIndex: number) => void, onJump: (ev: GameEvent) => void) {
    this.onJump = onJump
    const title = document.createElement('h1')
    title.textContent = 'Carrow Deep'
    root.appendChild(title)

    this.clock = document.createElement('p')
    this.clock.className = 'clock'
    root.appendChild(this.clock)

    // Speed bar: pause, then one button per speed.
    const bar = document.createElement('div')
    bar.className = 'speed-bar'
    for (const speed of [0, ...CONFIG.sim.speeds]) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = speed === 0 ? 'Pause' : speed + '×'
      btn.addEventListener('click', () => {
        if (speed === 0) view.paused = !view.paused
        else { view.speed = speed; view.paused = false }
      })
      bar.appendChild(btn)
      this.speedButtons.push({ btn, speed })
    }
    root.appendChild(bar)

    // On-screen versions of the P and G keys (for touch screens).
    const toggles = document.createElement('div')
    toggles.className = 'toggle-bar'
    this.scentBtn = smallButton('Scent', () => { view.showPheromones = !view.showPheromones })
    this.artBtn = smallButton('Sprites', () => { view.art = view.art === 'sprites' ? 'shapes' : 'sprites' })
    toggles.append(this.scentBtn, this.artBtn)
    root.appendChild(toggles)

    const tabs = document.createElement('div')
    tabs.className = 'level-tabs'
    root.appendChild(tabs)
    sim.world.levels.forEach((level, i) => {
      const btn = document.createElement('button')
      btn.className = 'level-tab'
      btn.addEventListener('click', () => onSelect(i))
      btn.innerHTML = `<span class="level-key">${level.id}</span><span class="level-name"></span><span class="level-counts"></span>`
      btn.querySelector('.level-name')!.textContent = level.name
      tabs.appendChild(btn)
      this.buttons.push(btn)
    })

    // Phones: the rest is folded away behind this button.
    const more = smallButton('Details ▾', () => {
      const open = root.classList.toggle('expanded')
      more.textContent = open ? 'Details ▴' : 'Details ▾'
    })
    more.className = 'details-toggle'
    root.appendChild(more)
    const details = document.createElement('div')
    details.className = 'sidebar-details'
    root.appendChild(details)

    this.hiveInfo = document.createElement('p')
    this.hiveInfo.className = 'help'
    details.appendChild(this.hiveInfo)

    const logTitle = document.createElement('h2')
    logTitle.textContent = 'Event log'
    details.appendChild(logTitle)
    this.log = document.createElement('ol')
    this.log.className = 'event-log'
    details.appendChild(this.log)

    const help = document.createElement('p')
    help.className = 'help'
    help.innerHTML = '<span class="help-keys">Drag or WASD to pan<br>Scroll to zoom<br>1 / 2 / 3 to switch level<br>Space to pause, + / - to change speed<br>P to show hive scent (green trail, red alarm, yellow danger)<br>G to switch sprites / plain shapes<br>Click someone to inspect them, F to follow, Esc to close<br></span>'
      + '<span class="help-touch">Drag to pan, pinch to zoom, tap someone to inspect them</span>'
    details.appendChild(help)
  }

  update(sim: SimState, view: ViewState): void {
    const time = formatClock(sim.tick) + (view.paused ? ' · paused' : view.speed !== 1 ? ` · ${view.speed}×` : '')
    if (this.clock.textContent !== time) this.clock.textContent = time
    for (const { btn, speed } of this.speedButtons) btn.classList.toggle('active', speed === 0 ? view.paused : !view.paused && speed === view.speed)
    this.scentBtn.classList.toggle('active', view.showPheromones)
    this.artBtn.classList.toggle('active', view.art === 'sprites')
    let takers = 0, spinebacks = 0, broodlings = 0, civilians = 0, soldiers = 0, cocoons = 0, infected = 0
    for (const a of sim.agents) {
      if (a.dead) continue
      if (a.civ?.mode === 'cocooned') cocoons++
      else if (a.civ?.infection) infected++
      if (a.soldier) soldiers++
      else if (a.civ && a.civ.mode !== 'cocooned') civilians++
      if (a.kind === 'taker') takers++
      else if (a.kind === 'spineback') spinebacks++
      else if (a.kind === 'broodling') broodlings++
    }
    const hive = `Hive: ${takers} Takers · ${spinebacks} Spinebacks · ${broodlings} Broodlings · ${sim.hive.captives.length} captives · ${cocoons} cocoons · ${sim.hive.hatched} hatched · ${sim.hive.resinTiles} resin tiles · ${sim.hive.tunnelsDug} tunnels dug${sim.hive.dig ? ' (digging now)' : ''}`
      + `
Colony: ${civilians} civilians · ${soldiers} soldiers · ${infected} infected walking around`
      + `\nPower: ${hasPower(sim.power) ? 'on' : 'OFF'} (${sim.power.generators.map((g) => `${g.room.room.name} ${Math.round(g.health)}`).join(', ')}) · sensor alerts ${sim.sensorAlerts}`
      + `\nCommander: ${commanderLine(sim)}`
      + `\nSupplies: ${stockLine(sim)}`
      + sim.medbays.map((b) => `
Med bay: ${b.beds.length}/${CONFIG.medbay.beds} beds`).join('')
      + sim.squads.map((s) => ({ s, left: soldiersLeft(sim, s.members) })).filter(({ left }) => left > 0).map(({ s, left }) => `
${s.name}${s.veteran ? ' ★' : ''} (${left} left): ${s.order} · morale ${Math.round(s.morale * 100)}%`).join('')
    if (this.hiveInfo.textContent !== hive) this.hiveInfo.textContent = hive
    // Latest events, newest first.
    if (sim.events.length !== this.logCount) {
      this.logCount = sim.events.length
      this.log.replaceChildren(...sim.events.slice(-10).reverse().map((ev) => {
        const li = document.createElement('li')
        li.textContent = `${formatClock(ev.tick).replace('Day ', 'D')} ${ev.text}`
        li.className = 'ev-' + ev.kind
        // Lines that happened somewhere: click to look there (and select who it was about).
        if (ev.at) {
          li.classList.add('has-place')
          li.title = 'Show where this happened'
          li.addEventListener('click', () => this.onJump(ev))
        }
        return li
      }))
    }
    const counts = sim.world.levels.map((_, i) => levelActivity(sim, i))
    const key = `${view.levelIndex}|${counts.map((c) => `${c.humans},${c.myrr}`).join('|')}`
    if (key === this.lastShown) return
    this.lastShown = key

    this.buttons.forEach((btn, i) => {
      btn.classList.toggle('active', i === view.levelIndex)
      btn.querySelector('.level-counts')!.textContent = `Humans ${counts[i].humans} · Myrr ${counts[i].myrr}`
    })
  }
}

function smallButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
