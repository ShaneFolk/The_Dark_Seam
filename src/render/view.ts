// What the viewer is looking at: current level, one camera per level, and
// the tile under the mouse. Render-side state only.

import { Camera } from './camera.ts'

export interface ViewState {
  /** Index into world.levels (0 = Level 1). */
  levelIndex: number
  cameras: Camera[]
  /** Mouse position on the canvas in CSS pixels, or null when outside. */
  mouse: { x: number; y: number } | null
}

export function createView(levelCount: number): ViewState {
  return {
    levelIndex: 0,
    cameras: Array.from({ length: levelCount }, () => new Camera()),
    mouse: null,
  }
}

export function currentCamera(view: ViewState): Camera {
  return view.cameras[view.levelIndex]
}
