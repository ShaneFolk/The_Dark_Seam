// Mouse and keyboard controls for the camera and level switching.

import { CONFIG } from '../config.ts'
import { currentCamera, stepSpeed, type ViewState } from './view.ts'

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

export class Input {
  private keysDown = new Set<string>()
  private dragging = false
  private lastDrag = { x: 0, y: 0 }

  constructor(
    canvas: HTMLCanvasElement,
    view: ViewState,
    onLevelKey: (levelIndex: number) => void,
  ) {
    const local = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.lastDrag = { x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      view.mouse = local(e)
      if (!this.dragging) return
      // Dragging moves the map with the mouse, so the camera goes the other way.
      currentCamera(view).panScreen(this.lastDrag.x - e.clientX, this.lastDrag.y - e.clientY)
      this.lastDrag = { x: e.clientX, y: e.clientY }
    })
    const stopDrag = () => { this.dragging = false }
    canvas.addEventListener('pointerup', stopDrag)
    canvas.addEventListener('pointercancel', stopDrag)
    canvas.addEventListener('pointerleave', () => { view.mouse = null })

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const { x, y } = local(e)
      const factor = e.deltaY < 0 ? CONFIG.render.zoomStep : 1 / CONFIG.render.zoomStep
      currentCamera(view).zoomAt(factor, x, y, canvas.clientWidth, canvas.clientHeight)
    }, { passive: false })

    window.addEventListener('keydown', (e) => {
      if (e.code in PAN_KEYS || e.code === 'Space') e.preventDefault()
      if (e.code === 'Space') view.paused = !view.paused
      if (e.key === '+' || e.key === '=') stepSpeed(view, 1)
      if (e.key === '-' || e.key === '_') stepSpeed(view, -1)
      this.keysDown.add(e.code)
      if (e.code === 'KeyP') view.showPheromones = !view.showPheromones
      if (e.code === 'KeyG') view.art = view.art === 'sprites' ? 'shapes' : 'sprites'
      const digit = Number(e.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= view.cameras.length) onLevelKey(digit - 1)
    })
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code))
    window.addEventListener('blur', () => this.keysDown.clear())
  }

  /** Apply held keys. Called once per frame with the real time passed. */
  update(view: ViewState, dtMs: number): void {
    let dx = 0, dy = 0
    for (const code of this.keysDown) {
      const dir = PAN_KEYS[code]
      if (dir) { dx += dir[0]; dy += dir[1] }
    }
    if (dx || dy) {
      // Cap the step so a long frame (e.g. after switching tabs) cannot fling the camera.
      const dist = (CONFIG.render.panSpeed * Math.min(dtMs, 100)) / 1000
      currentCamera(view).panScreen(dx * dist, dy * dist)
    }
  }
}
