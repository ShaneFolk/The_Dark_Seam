// What the viewer is looking at: current level, one camera per level, and
// the tile under the mouse. Render-side state only.

import { CONFIG } from '../config.ts'
import type { SimState } from '../sim.ts'
import { Camera } from './camera.ts'

export interface ViewState {
  /** Index into world.levels (0 = Level 1). */
  levelIndex: number
  cameras: Camera[]
  /** Mouse position on the canvas in CSS pixels, or null when outside. */
  mouse: { x: number; y: number } | null
  /** Show the trail scent overlay (toggle with P). */
  showPheromones: boolean
  /** Sim speed (times normal) and whether it's paused. */
  speed: number
  paused: boolean
  /** Draw with the sprite sheet, or the plain coloured shapes (toggle with G). */
  art: 'sprites' | 'shapes'
  /** What was clicked or tapped: an agent (by id), or else a tile. Shown in the inspector. */
  selected: Selection | null
  /** Keep the camera on the selected agent, across levels (toggle with F). */
  following: boolean
}

export interface Selection {
  levelIndex: number
  x: number
  y: number
  agentId?: number
}

export function createView(levelCount: number): ViewState {
  return {
    levelIndex: 0,
    cameras: Array.from({ length: levelCount }, () => new Camera()),
    mouse: null,
    showPheromones: false,
    speed: 1,
    paused: false,
    art: 'sprites',
    selected: null,
    following: false,
  }
}

/** Step to the next faster (+1) or slower (-1) speed. */
export function stepSpeed(view: ViewState, dir: 1 | -1): void {
  const speeds: readonly number[] = CONFIG.sim.speeds
  const i = speeds.indexOf(view.speed)
  view.speed = speeds[Math.max(0, Math.min(speeds.length - 1, i + dir))]
}

export function currentCamera(view: ViewState): Camera {
  return view.cameras[view.levelIndex]
}

/** Following: show the selected agent's level and keep the camera on them. Stops if they die or leave. */
export function followSelected(sim: SimState, view: ViewState): void {
  if (!view.following) return
  const agent = view.selected?.agentId !== undefined ? sim.agents[view.selected.agentId] : null
  if (!agent || agent.dead || agent.civ?.mode === 'evacuated') { view.following = false; return }
  view.levelIndex = agent.levelIndex
  const camera = currentCamera(view)
  camera.x = agent.x * CONFIG.render.tileSize
  camera.y = agent.y * CONFIG.render.tileSize
}
