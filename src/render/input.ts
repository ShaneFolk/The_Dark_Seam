// Mouse, touch and keyboard controls for the camera, selection and level switching.
//
// Pointers (mouse, finger or pen) are tracked by id, so two fingers can pinch:
//   one pointer down and moving  -> pan
//   two pointers down            -> pinch to zoom (and pan with the midpoint)
//   a short press that hardly moved -> a tap: select whatever is under it

import { CONFIG } from '../config.ts'
import { currentCamera, stepSpeed, type ViewState } from './view.ts'

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
}

interface Pointer { x: number; y: number }

export class Input {
  private keysDown = new Set<string>()
  /** Pointers currently pressed, by pointer id, in canvas CSS pixels. */
  private pointers = new Map<number, Pointer>()
  /** Where the current press started, and whether it moved too far to be a tap. */
  private pressStart: Pointer | null = null
  private moved = false
  /** Finger distance at the last pinch step (0 = not pinching). */
  private pinchDist = 0

  constructor(
    canvas: HTMLCanvasElement,
    view: ViewState,
    onLevelKey: (levelIndex: number) => void,
    onTap: (x: number, y: number, touch: boolean) => void,
  ) {
    const local = (e: MouseEvent): Pointer => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const camera = () => currentCamera(view)

    canvas.addEventListener('pointerdown', (e) => {
      const p = local(e)
      this.pointers.set(e.pointerId, p)
      canvas.setPointerCapture(e.pointerId)
      if (this.pointers.size === 1) { this.pressStart = p; this.moved = false }
      else { this.moved = true; this.pinchDist = this.spread() } // a second finger: never a tap
    })

    canvas.addEventListener('pointermove', (e) => {
      const p = local(e)
      if (e.pointerType === 'mouse') view.mouse = p
      const last = this.pointers.get(e.pointerId)
      if (!last) return
      if (this.pressStart && Math.hypot(p.x - this.pressStart.x, p.y - this.pressStart.y) > CONFIG.render.tapSlopPx) this.moved = true

      if (this.pointers.size >= 2) {
        // Pinch: zoom by how much the fingers spread, around their midpoint, and pan with it.
        const before = this.midpoint()
        this.pointers.set(e.pointerId, p)
        const after = this.midpoint()
        const dist = this.spread()
        if (this.pinchDist > 0 && dist > 0) camera().zoomAt(dist / this.pinchDist, after.x, after.y, canvas.clientWidth, canvas.clientHeight)
        camera().panScreen(before.x - after.x, before.y - after.y)
        this.pinchDist = dist
        return
      }
      // Dragging moves the map with the pointer, so the camera goes the other way.
      if (this.moved) { camera().panScreen(last.x - p.x, last.y - p.y); view.following = false }
      this.pointers.set(e.pointerId, p)
    })

    const release = (e: PointerEvent, cancelled: boolean) => {
      if (!this.pointers.has(e.pointerId)) return
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinchDist = 0
      if (!cancelled && this.pointers.size === 0 && !this.moved && this.pressStart) onTap(this.pressStart.x, this.pressStart.y, e.pointerType !== 'mouse')
      if (this.pointers.size === 0) this.pressStart = null
    }
    canvas.addEventListener('pointerup', (e) => release(e, false))
    canvas.addEventListener('pointercancel', (e) => release(e, true))
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') view.mouse = null })

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const { x, y } = local(e)
      const factor = e.deltaY < 0 ? CONFIG.render.zoomStep : 1 / CONFIG.render.zoomStep
      camera().zoomAt(factor, x, y, canvas.clientWidth, canvas.clientHeight)
    }, { passive: false })

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code in PAN_KEYS || e.code === 'Space') e.preventDefault()
      if (e.code === 'Space') view.paused = !view.paused
      if (e.key === '+' || e.key === '=') stepSpeed(view, 1)
      if (e.key === '-' || e.key === '_') stepSpeed(view, -1)
      if (e.code === 'Escape') view.selected = null
      this.keysDown.add(e.code)
      if (e.code === 'KeyP') view.showPheromones = !view.showPheromones
      if (e.code === 'KeyG') view.art = view.art === 'sprites' ? 'shapes' : 'sprites'
      if (e.code === 'KeyF') toggleFollow(view)
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
      view.following = false // moving the camera by hand stops following
    }
  }

  private midpoint(): Pointer {
    let x = 0, y = 0
    for (const p of this.pointers.values()) { x += p.x; y += p.y }
    return { x: x / this.pointers.size, y: y / this.pointers.size }
  }

  /** Distance between the first two pointers. */
  private spread(): number {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
}

/** Follow the selected agent with the camera (or stop following). */
export function toggleFollow(view: ViewState): void {
  view.following = !view.following && view.selected?.agentId !== undefined
}
