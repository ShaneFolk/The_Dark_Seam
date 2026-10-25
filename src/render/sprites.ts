// The sprite sheet: loads assets/sprites.png (made by `npm run sprites`) and
// draws named sprites from it. Until it has loaded (or if it fails), the
// renderer keeps using the coloured shapes.

import sheetUrl from '../../assets/sprites.png'
import { SPRITE_RECTS, type SpriteName } from './spriteRects.ts'

let sheet: HTMLImageElement | null = null

/** Start loading the sheet. Resolves true once it's ready to draw. */
export function loadSprites(): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => { sheet = img; resolve(true) }
    img.onerror = () => resolve(false)
    img.src = sheetUrl
  })
}

export function spritesReady(): boolean {
  return sheet !== null
}

/** Draw a sprite into the box (dx, dy, dw, dh). Pixel art: no smoothing. */
export function drawSprite(ctx: CanvasRenderingContext2D, name: SpriteName, dx: number, dy: number, dw: number, dh: number): void {
  if (!sheet) return
  const [sx, sy, sw, sh] = SPRITE_RECTS[name]
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh)
}
