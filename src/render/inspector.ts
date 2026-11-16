// The inspector: a small panel describing what was clicked or tapped (an agent,
// or else the tile), with buttons to follow that agent or close the panel.
// Works the same with a mouse or a finger, unlike the hover readout.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import { describeAgent } from '../agents/describe.ts'
import { describeTile } from '../world/loadWorld.ts'
import { currentCamera, type Selection, type ViewState } from './view.ts'
import { toggleFollow } from './input.ts'

/** What is at a screen point on the shown level: the nearest agent within reach, or else the tile. */
export function pickAt(sim: SimState, view: ViewState, sx: number, sy: number, viewW: number, viewH: number, touch: boolean): Selection | null {
  const level = sim.world.levels[view.levelIndex]
  const [wx, wy] = currentCamera(view).screenToWorld(sx, sy, viewW, viewH)
  const x = wx / CONFIG.render.tileSize, y = wy / CONFIG.render.tileSize
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return null
  const reach: number = touch ? CONFIG.render.pickRadiusTouch : CONFIG.render.pickRadiusMouse
  let best = -1, bestD = reach
  for (const a of sim.agents) {
    if (a.dead || a.levelIndex !== view.levelIndex || a.civ?.mode === 'evacuated') continue
    const d = Math.hypot(a.x - x, a.y - y)
    if (d <= bestD) { best = a.id; bestD = d }
  }
  const sel: Selection = { levelIndex: view.levelIndex, x: Math.floor(x), y: Math.floor(y) }
  if (best >= 0) sel.agentId = best
  return sel
}

export class Inspector {
  private panel: HTMLElement
  private text: HTMLElement
  private followBtn: HTMLButtonElement
  private shown = ''

  constructor(parent: HTMLElement, view: ViewState) {
    this.panel = document.createElement('div')
    this.panel.className = 'inspector'
    this.panel.hidden = true
    this.text = document.createElement('div')
    this.text.className = 'inspector-text'
    const buttons = document.createElement('div')
    buttons.className = 'inspector-buttons'
    this.followBtn = button('Follow', () => toggleFollow(view))
    buttons.append(this.followBtn, button('Close', () => { view.selected = null; view.following = false }))
    this.panel.append(this.text, buttons)
    parent.appendChild(this.panel)
  }

  update(sim: SimState, view: ViewState): void {
    const sel = view.selected
    const agent = sel?.agentId !== undefined ? sim.agents[sel.agentId] : null
    // The followed agent may have moved to another level: keep the selection on it.
    if (sel && agent) { sel.levelIndex = agent.levelIndex; sel.x = Math.floor(agent.x); sel.y = Math.floor(agent.y) }
    let text = ''
    if (sel) {
      const level = sim.world.levels[sel.levelIndex]
      text = agent
        ? describeAgent(agent, sim.tick) + `\nLevel ${level.id} · ${level.rooms[level.roomOf[sel.y * level.width + sel.x]]?.name ?? (sel.levelIndex === 0 ? 'outside' : 'tunnels')}`
        : `Level ${level.id} · tile ${sel.x}, ${sel.y}\n${describeTile(level, sel.x, sel.y)}`
    }
    this.panel.hidden = !sel
    this.followBtn.hidden = !agent || agent.dead
    this.followBtn.classList.toggle('active', view.following)
    this.followBtn.textContent = view.following ? 'Following' : 'Follow'
    if (text !== this.shown) { this.shown = text; this.text.textContent = text }
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
