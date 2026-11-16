// The player's tools (Phase 11), on the screen side: a bar of buttons, a hint over
// the map saying what a tap will do, and turning a tap into an action for the sim.
// Nothing here changes the sim: actions go into sim.player.queue and the sim
// applies them on its next tick (systems/player.ts).

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import { Tile } from '../world/tiles.ts'
import { canWalk } from '../world/pathfinding.ts'
import { currentCamera, type ViewState } from './view.ts'
import { pickAt } from './inspector.ts'
import { isFree } from '../agents/civilian.ts'

export type Tool = 'inspect' | 'door' | 'power' | 'send'

const LABELS: Record<Tool | 'alarm', string> = { inspect: 'Inspect', door: 'Door', power: 'Power', send: 'Send squad', alarm: 'Alarm' }

export class Tools {
  private buttons = new Map<Tool, HTMLButtonElement>()
  private alarmBtn: HTMLButtonElement
  private hint: HTMLElement
  private shownHint = ''

  private sim: SimState
  private view: ViewState

  constructor(bar: HTMLElement, stage: HTMLElement, sim: SimState, view: ViewState) {
    this.sim = sim
    this.view = view
    const row = document.createElement('div')
    row.className = 'tool-bar'
    for (const tool of ['inspect', 'door', 'power', 'send'] as Tool[]) {
      const btn = button(LABELS[tool], () => { view.tool = tool; view.sendSquad = null })
      this.buttons.set(tool, btn)
      row.appendChild(btn)
    }
    // The alarm is one press, no tap on the map.
    this.alarmBtn = button(LABELS.alarm, () => sim.player.queue.push({ kind: 'alarm' }))
    row.appendChild(this.alarmBtn)
    bar.appendChild(row)

    this.hint = document.createElement('div')
    this.hint.className = 'tool-hint'
    stage.appendChild(this.hint)
  }

  /** A tap or click on the map with the current tool. Returns false if it was an ordinary inspect. */
  tap(x: number, y: number, touch: boolean, w: number, h: number): boolean {
    const { sim, view } = this
    if (view.tool === 'inspect') return false
    const level = sim.world.levels[view.levelIndex]
    const [wx, wy] = currentCamera(view).screenToWorld(x, y, w, h)
    const tx = Math.floor(wx / CONFIG.render.tileSize), ty = Math.floor(wy / CONFIG.render.tileSize)
    if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return true

    if (view.tool === 'door') {
      // The door at the tap, or the nearest one next to it (fingers are wide).
      const reach = touch ? 1 : 0
      for (let r = 0; r <= reach; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const i = (ty + dy) * level.width + tx + dx
            if (level.tiles[i] === Tile.Door) { sim.player.queue.push({ kind: 'door', levelIndex: view.levelIndex, i }); return true }
          }
      return true
    }

    if (view.tool === 'power') {
      const room = level.roomOf[ty * level.width + tx]
      const gen = sim.power.generators.findIndex((g) => g.room.levelIndex === view.levelIndex && g.room.room.index === room)
      if (gen >= 0) sim.player.queue.push({ kind: 'power', generator: gen })
      return true
    }

    // Send: first tap a soldier to pick their squad, then tap where to send it.
    if (view.sendSquad === null) {
      const sel = pickAt(sim, view, x, y, w, h, touch)
      const soldier = sel?.agentId !== undefined ? sim.agents[sel.agentId] : null
      const squad = soldier?.soldier ? sim.squads[soldier.soldier.squadId] : null
      if (squad && squad.guardId < 0 && isFree(soldier!)) view.sendSquad = squad.id
      return true
    }
    if (canWalk(level, tx, ty, 'human')) {
      sim.player.queue.push({ kind: 'send', squadId: view.sendSquad, to: { levelIndex: view.levelIndex, x: tx, y: ty } })
      view.sendSquad = null
    }
    return true
  }

  update(): void {
    const { sim, view } = this
    for (const [tool, btn] of this.buttons) btn.classList.toggle('active', view.tool === tool)
    this.alarmBtn.classList.toggle('active', sim.commander.alarm)
    this.alarmBtn.textContent = sim.commander.alarm ? 'Stop alarm' : 'Alarm'
    const text = hintFor(sim, view)
    if (text !== this.shownHint) {
      this.shownHint = text
      this.hint.textContent = text
      this.hint.hidden = !text
    }
  }
}

function hintFor(sim: SimState, view: ViewState): string {
  switch (view.tool) {
    case 'inspect': return ''
    case 'door': return `Tap a door to lock it (or unlock one you locked)${sim.player.locks.length ? ` · ${sim.player.locks.length} locked by you` : ''}. Locks need power; Myrr can break them.`
    case 'power': {
      const gens = sim.power.generators.map((g) => `${g.room.room.name}: ${g.switchedOff ? 'off' : g.broken ? 'broken' : 'on'}`).join(' · ')
      return `Tap a generator room (Level 1) to switch it off or on. ${gens}`
    }
    case 'send': {
      if (view.sendSquad === null) return 'Tap a soldier to pick their squad (not the Commander\'s guard).'
      const squad = sim.squads[view.sendSquad]
      return `${squad.name}: tap where to send it, on any level. They hold the spot ${Math.round(CONFIG.player.holdSeconds)} s, then patrol.`
    }
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
