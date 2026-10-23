// Camera: which part of the level is on screen, and how zoomed in.
// Lives on the render side only; the sim never knows about it.

import { CONFIG } from '../config.ts'

export class Camera {
  /** World position (in pixels at zoom 1) shown at the centre of the screen. */
  x = 0
  y = 0
  zoom = 1
  /** Set once the camera has been fitted to its level for the first time. */
  fitted = false

  worldToScreen(wx: number, wy: number, viewW: number, viewH: number): [number, number] {
    return [(wx - this.x) * this.zoom + viewW / 2, (wy - this.y) * this.zoom + viewH / 2]
  }

  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): [number, number] {
    return [(sx - viewW / 2) / this.zoom + this.x, (sy - viewH / 2) / this.zoom + this.y]
  }

  /** Move by a distance in screen pixels. */
  panScreen(dx: number, dy: number): void {
    this.x += dx / this.zoom
    this.y += dy / this.zoom
  }

  /** Zoom by a factor, keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(factor: number, sx: number, sy: number, viewW: number, viewH: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy, viewW, viewH)
    const { minZoom, maxZoom } = CONFIG.render
    this.zoom = Math.min(maxZoom, Math.max(minZoom, this.zoom * factor))
    // Shift so the same world point stays under the cursor.
    this.x = wx - (sx - viewW / 2) / this.zoom
    this.y = wy - (sy - viewH / 2) / this.zoom
  }

  /** Show the whole level, centred. */
  fit(worldW: number, worldH: number, viewW: number, viewH: number): void {
    const { minZoom, maxZoom } = CONFIG.render
    this.zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(viewW / worldW, viewH / worldH)))
    this.x = worldW / 2
    this.y = worldH / 2
    this.fitted = true
  }

  /** Keep the centre of the screen over the level. */
  clamp(worldW: number, worldH: number): void {
    this.x = Math.min(worldW, Math.max(0, this.x))
    this.y = Math.min(worldH, Math.max(0, this.y))
  }
}
