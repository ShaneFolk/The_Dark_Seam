// Sidebar: one tab per level with its activity counts, plus a controls hint.
// Plain DOM, rebuilt only when something it shows has changed.

import { levelActivity, type SimState } from '../sim.ts'
import type { ViewState } from './view.ts'

export class Sidebar {
  private buttons: HTMLButtonElement[] = []
  private lastShown = ''

  constructor(root: HTMLElement, sim: SimState, onSelect: (levelIndex: number) => void) {
    const title = document.createElement('h1')
    title.textContent = 'Carrow Deep'
    root.appendChild(title)

    sim.world.levels.forEach((level, i) => {
      const btn = document.createElement('button')
      btn.className = 'level-tab'
      btn.addEventListener('click', () => onSelect(i))
      btn.innerHTML = `<span class="level-key">${level.id}</span><span class="level-name"></span><span class="level-counts"></span>`
      btn.querySelector('.level-name')!.textContent = level.name
      root.appendChild(btn)
      this.buttons.push(btn)
    })

    const help = document.createElement('p')
    help.className = 'help'
    help.innerHTML = 'Drag or WASD to pan<br>Scroll to zoom<br>1 / 2 / 3 to switch level'
    root.appendChild(help)
  }

  update(sim: SimState, view: ViewState): void {
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
