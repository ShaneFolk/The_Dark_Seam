// Entry point: creates the sim and renderer and starts the loop.

import './style.css'
import { CONFIG } from './config.ts'
import { startLoop } from './core/loop.ts'
import { createSim, step } from './sim.ts'
import { Renderer } from './render/renderer.ts'
import { createView } from './render/view.ts'
import { Input } from './render/input.ts'
import { Sidebar } from './render/sidebar.ts'
import { showSummary } from './render/summary.ts'
import { loadSprites } from './render/sprites.ts'

/** Read ?seed=123 from the URL, or fall back to the default seed. */
function getSeed(): number {
  const param = new URLSearchParams(window.location.search).get('seed')
  const parsed = param === null ? NaN : Number(param)
  return Number.isFinite(parsed) ? parsed : CONFIG.sim.defaultSeed
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('Missing #game canvas')

/** Show a startup error (such as a broken map) on the page instead of a blank screen. */
function showError(err: unknown): void {
  const pre = document.createElement('pre')
  pre.className = 'fatal'
  pre.textContent = err instanceof Error ? err.message : String(err)
  document.body.appendChild(pre)
}

let sim: ReturnType<typeof createSim>
try {
  sim = createSim(getSeed())
} catch (err) {
  showError(err)
  throw err
}
const renderer = new Renderer(canvas)
void loadSprites() // the renderer switches to sprites once the sheet has loaded
const view = createView(sim.world.levels.length)
const selectLevel = (levelIndex: number) => { view.levelIndex = levelIndex }
const input = new Input(canvas, view, selectLevel)
const sidebarRoot = document.querySelector<HTMLElement>('#sidebar')
if (!sidebarRoot) throw new Error('Missing #sidebar')
const sidebar = new Sidebar(sidebarRoot, sim, view, selectLevel)

startLoop(CONFIG.sim.ticksPerSecond, CONFIG.sim.maxTicksPerFrame, {
  update: () => step(sim),
  speed: () => (view.paused ? 0 : view.speed),
  render: (frameMs) => {
    input.update(view, frameMs)
    renderer.render(sim, view)
    sidebar.update(sim, view)
    if (sim.ending) showSummary(sim)
  },
})
