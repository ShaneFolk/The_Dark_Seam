// The player's tools (Phase 11), on the screen side: a bar of buttons, a hint over
// the map saying what a tap will do, a short message after each action, and turning
// a tap into an action for the sim. Nothing here changes the sim: actions go into
// sim.player.queue and the sim applies them (systems/player.ts).

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import { Tile } from '../world/tiles.ts'
import { canWalk } from '../world/pathfinding.ts'
import { currentCamera, type ViewState } from './view.ts'
import { isFree } from '../agents/civilian.ts'

/** Tools used by tapping the map. */
export type Tool = 'inspect' | 'door' | 'window' | 'flare' | 'send' | 'power'

const TAP_TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'inspect', label: 'Inspect' },
  { tool: 'door', label: 'Door' },
  { tool: 'window', label: 'Window' },
  { tool: 'flare', label: 'Flare' },
  { tool: 'send', label: 'Send squad' },
  { tool: 'power', label: 'Power' },
]

/** How long a message after an action stays up, in milliseconds (real time: it shows while paused too). */
const NOTICE_MS = 3500

export class Tools {
  private buttons = new Map<Tool, HTMLButtonElement>()
  private alarmBtn: HTMLButtonElement
  private shipBtn: HTMLButtonElement
  private evacBtn: HTMLButtonElement
  private hint: HTMLElement
  private notice: HTMLElement
  private shownHint = ''
  private noticeUntil = 0
  private sim: SimState
  private view: ViewState

  constructor(bar: HTMLElement, stage: HTMLElement, sim: SimState, view: ViewState) {
    this.sim = sim
    this.view = view
    const row = document.createElement('div')
    row.className = 'tool-bar'
    for (const { tool, label } of TAP_TOOLS) {
      const btn = button(label, () => { view.tool = tool; view.sendSquad = null })
      this.buttons.set(tool, btn)
      row.appendChild(btn)
    }
    // One press, no tap on the map.
    const orders = document.createElement('div')
    orders.className = 'tool-bar orders'
    this.alarmBtn = button('Alarm', () => sim.player.queue.push({ kind: 'alarm' }))
    this.shipBtn = button('Drop ship', () => sim.player.queue.push({ kind: 'dropShip' }))
    this.evacBtn = button('Evacuate', () => sim.player.queue.push({ kind: 'evacuate' }))
    orders.append(this.alarmBtn, this.shipBtn, this.evacBtn)
    bar.append(row, orders)

    const box = document.createElement('div')
    box.className = 'tool-hint'
    this.hint = document.createElement('div')
    this.notice = document.createElement('div')
    this.notice.className = 'tool-notice'
    box.append(this.hint, this.notice)
    stage.appendChild(box)
  }

  /** A tap or click on the map with the current tool. Returns false if it was an ordinary inspect. */
  tap(x: number, y: number, w: number, h: number): boolean {
    const { sim, view } = this
    if (view.tool === 'inspect') return false
    const level = sim.world.levels[view.levelIndex]
    const camera = currentCamera(view)
    const [wx, wy] = camera.screenToWorld(x, y, w, h)
    const fx = wx / CONFIG.render.tileSize, fy = wy / CONFIG.render.tileSize
    const tx = Math.floor(fx), ty = Math.floor(fy)
    if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return true
    // How far a tap reaches, in tiles: a fixed distance on screen, so it works zoomed out too.
    const reach = Math.max(0.75, CONFIG.player.tapReachPx / (CONFIG.render.tileSize * camera.zoom))

    if (view.tool === 'door' || view.tool === 'window') {
      const want = view.tool === 'door' ? Tile.Door : Tile.Window
      const i = nearestTile(level, fx, fy, reach, want)
      if (i < 0) return this.say(`No ${view.tool} there: tap right on one (zooming in helps)`)
      sim.player.queue.push({ kind: view.tool, levelIndex: view.levelIndex, i })
      return true
    }

    if (view.tool === 'flare') {
      sim.player.queue.push({ kind: 'flare', at: { levelIndex: view.levelIndex, x: tx, y: ty } })
      return true
    }

    if (view.tool === 'power') {
      const room = level.roomOf[ty * level.width + tx]
      const gen = sim.power.generators.findIndex((g) => g.room.levelIndex === view.levelIndex && g.room.room.index === room)
      if (gen < 0) return this.say('Tap inside a generator room (Level 1)')
      sim.player.queue.push({ kind: 'power', generator: gen })
      return true
    }

    // Send: first tap a soldier to pick their squad, then tap where to send it.
    if (view.sendSquad === null) {
      let best = -1, bestD = reach
      for (const a of sim.agents) {
        if (!a.soldier || a.dead || !isFree(a) || a.levelIndex !== view.levelIndex) continue
        const d = Math.hypot(a.x - fx, a.y - fy)
        if (d <= bestD) { best = a.id; bestD = d }
      }
      if (best < 0) return this.say('No soldier there: tap on one')
      const squad = sim.squads[sim.agents[best].soldier!.squadId]
      if (squad.guardId >= 0) return this.say('That is the Commander\'s guard: it stays with the Commander')
      view.sendSquad = squad.id
      return true
    }
    if (!canWalk(level, tx, ty, 'human')) return this.say('Nobody can stand there: tap open floor')
    sim.player.queue.push({ kind: 'send', squadId: view.sendSquad, to: { levelIndex: view.levelIndex, x: tx, y: ty } })
    view.sendSquad = null
    return true
  }

  update(): void {
    const { sim, view } = this
    // What the sim said about the last actions.
    const said = sim.player.feedback.splice(0)
    if (said.length) this.say(said[said.length - 1])
    if (this.noticeUntil && performance.now() > this.noticeUntil) { this.noticeUntil = 0; this.notice.textContent = '' }

    for (const [tool, btn] of this.buttons) btn.classList.toggle('active', view.tool === tool)
    const cmd = sim.commander
    this.alarmBtn.classList.toggle('active', cmd.alarm)
    this.alarmBtn.textContent = cmd.alarm ? 'Stop alarm' : 'Alarm'
    this.shipBtn.disabled = cmd.reinforcementsCalled
    this.evacBtn.disabled = cmd.evacuation !== 'none'
    const text = hintFor(sim, view)
    if (text !== this.shownHint) { this.shownHint = text; this.hint.textContent = text }
    this.hint.parentElement!.hidden = !text && !this.noticeUntil
  }

  /** Show a short message over the map. Returns true (a tap that was handled). */
  private say(text: string): true {
    this.notice.textContent = text
    this.noticeUntil = performance.now() + NOTICE_MS
    this.hint.parentElement!.hidden = false
    return true
  }
}

/** The nearest tile of a kind within `reach` tiles of a point, or -1. */
function nearestTile(level: SimState['world']['levels'][number], fx: number, fy: number, reach: number, kind: number): number {
  let best = -1, bestD = reach
  const r = Math.ceil(reach)
  for (let y = Math.floor(fy) - r; y <= Math.floor(fy) + r; y++)
    for (let x = Math.floor(fx) - r; x <= Math.floor(fx) + r; x++) {
      if (x < 0 || y < 0 || x >= level.width || y >= level.height || level.tiles[y * level.width + x] !== kind) continue
      const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy)
      if (d <= bestD) { best = y * level.width + x; bestD = d }
    }
  return best
}

function hintFor(sim: SimState, view: ViewState): string {
  const p = sim.player
  switch (view.tool) {
    case 'inspect': return ''
    case 'door': return `Tap a door to lock or unlock it${p.locks.length ? ` (${p.locks.length} locked by you)` : ''}. Locks need power and only stop the Myrr, who can break them.`
    case 'window': return `Tap a window to board it up (${p.boards} boards left). Myrr can still smash through, more slowly.`
    case 'flare': return `Tap anywhere to light a flare: it shows hidden Myrr nearby (${p.flares} left).`
    case 'power': return `Tap a generator room (Level 1) to switch it off or on. ${sim.power.generators.map((g) => `${g.room.room.name}: ${g.switchedOff ? 'off' : g.broken ? 'broken' : 'on'}`).join(' · ')}`
    case 'send': {
      if (view.sendSquad === null) return 'Tap a soldier to pick their squad.'
      return `${sim.squads[view.sendSquad].name}: tap where to send it, on any level. They hold the spot ${CONFIG.player.holdSeconds} s, then patrol.`
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
