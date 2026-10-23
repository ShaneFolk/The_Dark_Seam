// Entry point: creates the sim and renderer and starts the loop.

import './style.css'
import { CONFIG } from './config.ts'
import { startLoop } from './core/loop.ts'
import { createSim, step } from './sim.ts'
import { Renderer } from './render/renderer.ts'

/** Read ?seed=123 from the URL, or fall back to the default seed. */
function getSeed(): number {
  const param = new URLSearchParams(window.location.search).get('seed')
  const parsed = param === null ? NaN : Number(param)
  return Number.isFinite(parsed) ? parsed : CONFIG.sim.defaultSeed
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('Missing #game canvas')

const sim = createSim(getSeed())
const renderer = new Renderer(canvas)

startLoop(CONFIG.sim.ticksPerSecond, CONFIG.sim.maxTicksPerFrame, {
  update: () => step(sim),
  render: () => renderer.render(sim),
})
