// Sprite generator: draws every tile and unit sprite as 16x16 pixel art (the
// Brood Mother is 32x32) and packs them into one sprite sheet.
//
//   npm run sprites
//
// Writes:
//   assets/sprites.png          the sheet the game loads
//   assets/sprites_preview.png  every sprite at 4x with a dark background, for looking at
//   src/render/spriteRects.ts   where each named sprite sits on the sheet
//
// Everything is drawn with code (no image editor), from a fixed seed, so running
// it again gives the same sheet. To use hand-made art instead, replace
// assets/sprites.png with a sheet laid out the same way.
//
// Walls are autotiled: each wall sprite comes in 16 versions, one per mix of
// open sides (north, east, south, west). The game picks the one that matches a
// tile's neighbours, so edges facing a corridor get an outline, and a wall with
// open floor to its south shows its front face.

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

type RGBA = [number, number, number, number?]
const T = 16

// ---------------------------------------------------------------- tiny image library

let seed = 7
function rand(): number {
  // mulberry32
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
function pick<T>(items: T[], weights?: number[]): T {
  if (!weights) return items[Math.floor(rand() * items.length)]
  let roll = rand() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) if ((roll -= weights[i]) <= 0) return items[i]
  return items[items.length - 1]
}

class Img {
  w: number
  h: number
  data: Uint8Array
  constructor(w = T, h = T) {
    this.w = w
    this.h = h
    this.data = new Uint8Array(w * h * 4)
  }

  /** Paint one pixel, blending by alpha. */
  set(x: number, y: number, c: RGBA): this {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this
    const i = (y * this.w + x) * 4, a = (c[3] ?? 255) / 255
    const d = this.data, da = d[i + 3] / 255, out = a + da * (1 - a)
    if (out <= 0) return this
    for (let k = 0; k < 3; k++) d[i + k] = Math.round((c[k] * a + d[i + k] * da * (1 - a)) / out)
    d[i + 3] = Math.round(out * 255)
    return this
  }
  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }
  rect(x0: number, y0: number, x1: number, y1: number, fill?: RGBA, outline?: RGBA): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1
      if (edge && outline) this.set(x, y, outline)
      else if (fill) this.set(x, y, fill)
    }
    return this
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let k = 0; k <= n; k++) this.set(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c)
    return this
  }
  /** Ellipse inside the box (x0,y0)-(x1,y1), inclusive. */
  ellipse(x0: number, y0: number, x1: number, y1: number, fill?: RGBA, outline?: RGBA): this {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5
    const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      if (edge && outline) this.set(x, y, outline)
      else if (fill) this.set(x, y, fill)
    }
    return this
  }
  noise(colors: RGBA[], weights?: number[]): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, pick(colors, weights))
    return this
  }
  paste(src: Img, dx: number, dy: number): this {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y)
      if (c[3]) this.set(dx + x, dy + y, c)
    }
    return this
  }
  /** A copy turned a quarter turn clockwise. */
  rotated(): Img {
    const out = new Img(this.h, this.w)
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.get(x, y)
      if (c[3]) out.set(this.h - 1 - y, x, c)
    }
    return out
  }
  copy(): Img {
    const out = new Img(this.w, this.h)
    out.data.set(this.data)
    return out
  }
}

// ---------------------------------------------------------------- palette

const ROCK: RGBA[] = [[46, 40, 36], [54, 48, 43], [62, 55, 49], [38, 33, 30]]
const ROCK_FACE: RGBA[] = [[30, 26, 23], [35, 30, 27], [40, 35, 31]]
const DIRT: RGBA[] = [[114, 96, 74], [122, 103, 80], [106, 89, 68], [130, 110, 86]]
const GROUND: RGBA[] = [[78, 72, 56], [86, 79, 61], [70, 65, 51], [92, 86, 66]]
const PAVED: RGBA[] = [[96, 94, 90], [104, 102, 97], [88, 86, 82]]
const METAL: RGBA[] = [[96, 100, 104], [108, 112, 116], [84, 88, 92]]
const RESIN: RGBA[] = [[62, 44, 84], [76, 54, 102], [52, 36, 70], [96, 70, 128]]
const BLACK: RGBA = [20, 18, 16]
const SKIN: RGBA = [222, 182, 142]
const SHADOW: RGBA = [0, 0, 0, 90]

// ---------------------------------------------------------------- tiles

/** Open sides of a wall tile: bit 1 north, 2 east, 4 south, 8 west. */
const N = 1, E = 2, S = 4, W = 8

function edges(im: Img, open: number, line: RGBA, light: RGBA, faceColors: RGBA[], faceTop: RGBA): Img {
  // A wall with open floor to its south shows its front face (seen from above at an angle).
  if (open & S) {
    for (let y = 11; y < 16; y++) for (let x = 0; x < 16; x++) im.set(x, y, pick(faceColors))
    im.line(0, 11, 15, 11, faceTop)
    for (let x = 2; x < 16; x += ri(3, 5)) im.line(x, 12, x, 14, line)
    im.line(0, 15, 15, 15, BLACK)
  }
  if (open & N) { im.line(0, 0, 15, 0, line); im.line(0, 1, 15, 1, light) }
  if (open & W) { im.line(0, 0, 0, open & S ? 10 : 15, line); im.line(1, open & N ? 2 : 0, 1, open & S ? 10 : 15, light) }
  if (open & E) { im.line(15, 0, 15, open & S ? 10 : 15, line); im.line(14, open & N ? 2 : 0, 14, open & S ? 10 : 15, light) }
  return im
}

function rock(open: number): Img {
  const im = new Img().noise(ROCK, [3, 3, 2, 2])
  for (let k = 0; k < 3; k++) { // cracks
    const x = ri(0, 15), y = ri(0, 10)
    im.line(x, y, x + ri(-3, 3), y + ri(2, 4), BLACK)
  }
  return edges(im, open, [30, 26, 22], [104, 92, 80], ROCK_FACE, [92, 80, 68])
}

function buildingWall(open: number): Img {
  const im = new Img().rect(0, 0, 15, 15, [60, 66, 74])
  for (let x = 3; x < 16; x += 4) im.line(x, 0, x, 15, [52, 57, 64])
  im.line(0, 7, 15, 7, [68, 75, 84])
  return edges(im, open, [30, 34, 40], [92, 100, 110], [[78, 86, 96], [84, 92, 102]], [110, 118, 128])
}

const mineFloor = () => {
  const im = new Img().noise(DIRT, [5, 3, 3, 1])
  for (let k = 0; k < 4; k++) im.set(ri(0, 15), ri(0, 15), [70, 60, 50])
  return im
}
const colonyFloor = () => {
  const im = new Img().noise(METAL.slice(0, 2), [4, 1]).rect(0, 0, 15, 15, undefined, METAL[2])
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) im.set(x, y, [140, 144, 148])
  return im
}
const ground = () => {
  const im = new Img().noise(GROUND, [4, 3, 2, 1])
  for (let k = 0; k < 3; k++) { const x = ri(1, 14), y = ri(1, 14); im.set(x, y, [96, 104, 62]); im.set(x + 1, y - 1, [110, 118, 70]) } // weeds
  return im
}
const paved = () => {
  const im = new Img().noise(PAVED, [4, 3, 2])
  im.line(0, 15, 15, 15, [74, 72, 68]).line(15, 0, 15, 15, [74, 72, 68])
  for (let k = 0; k < 2; k++) im.set(ri(0, 14), ri(0, 14), [70, 68, 64])
  return im
}
const resin = () => {
  const im = new Img().noise(RESIN, [4, 3, 2, 1])
  for (let k = 0; k < 3; k++) { const x = ri(0, 15), y = ri(0, 15); im.line(x, y, x + ri(2, 5), y + ri(-2, 2), [128, 96, 160]) }
  return im
}

/** A door seen from above, across a gap running left to right. Rotate for the other way. */
const doorH = () => new Img().rect(0, 5, 15, 10, [150, 120, 60], [90, 70, 30]).line(7, 6, 7, 9, [90, 70, 30]).line(8, 6, 8, 9, [176, 142, 76])
const windowH = () => {
  const im = new Img().rect(0, 0, 15, 15, [60, 66, 74])
  im.rect(0, 5, 15, 10, [143, 211, 232], [40, 46, 54])
  im.line(1, 6, 6, 6, [210, 240, 250])
  return im
}
/** Doorway (no door): two posts marking the room's edge. Transparent, drawn over the floor. */
const doorwayH = () => new Img().rect(0, 6, 1, 9, [60, 66, 74]).rect(14, 6, 15, 9, [60, 66, 74])

const boulder = () => new Img().ellipse(2, 3, 13, 14, [124, 117, 107], [60, 54, 48]).ellipse(4, 4, 8, 7, [150, 143, 132]).ellipse(3, 12, 14, 15, SHADOW)
const elevator = () => {
  const im = new Img().rect(0, 0, 15, 15, [40, 40, 44], [200, 170, 40])
  return im.line(1, 1, 14, 14, [200, 170, 40]).line(14, 1, 1, 14, [200, 170, 40])
}
const ladder = () => {
  const im = new Img().rect(0, 0, 15, 15, BLACK)
  im.line(4, 0, 4, 15, [150, 110, 60]).line(11, 0, 11, 15, [150, 110, 60])
  for (let y = 2; y < 16; y += 4) im.line(4, y, 11, y, [180, 140, 80])
  return im
}
const chute = () => new Img().ellipse(2, 2, 13, 13, BLACK, [120, 100, 80]).ellipse(4, 4, 11, 8, [34, 30, 26])
const vent = () => {
  const im = new Img().rect(0, 0, 15, 15, [30, 28, 34]).rect(2, 2, 13, 13, [40, 42, 46], [130, 134, 138])
  for (let y = 4; y < 13; y += 2) im.line(3, y, 12, y, [90, 94, 98])
  return im
}

// Barriers, drawn over a door or window.
const barricade = () => {
  const im = new Img()
  ;[3, 7, 11].forEach((y, i) => im.rect(1, y, 14, y + 2, i % 2 ? [130, 96, 56] : [112, 82, 46], [70, 50, 28]))
  return im.line(2, 2, 13, 14, [150, 150, 156]).line(13, 2, 2, 14, [150, 150, 156])
}
const weld = () => {
  const im = new Img()
  for (let x = 1; x < 15; x++) { im.set(x, 7 + (x % 2), [255, 140, 50]); im.set(x, 8 - (x % 2), [200, 80, 30]) }
  return im
}
const boards = () => new Img().rect(1, 3, 14, 5, [138, 98, 56], [80, 56, 30]).rect(1, 10, 14, 12, [138, 98, 56], [80, 56, 30])
const lock = () => new Img().rect(5, 7, 10, 12, [77, 163, 255], [20, 50, 90]).rect(6, 4, 9, 7, undefined, [20, 50, 90]).set(7, 9, [20, 50, 90])

// ---------------------------------------------------------------- units

interface HumanLook { shirt: RGBA; hat?: RGBA; cross?: boolean; gun?: boolean; torch?: boolean; beret?: boolean }
function human(o: HumanLook): Img {
  const im = new Img()
  im.ellipse(3, 12, 12, 15, SHADOW)
  im.rect(5, 7, 10, 12, o.shirt, BLACK)
  im.rect(6, 2, 9, 6, SKIN, BLACK)
  if (o.hat) im.rect(5, 1, 10, 3, o.hat)
  if (o.beret) im.rect(5, 1, 9, 2, o.hat ?? [220, 180, 60]).set(10, 2, o.hat ?? [220, 180, 60])
  if (o.cross) im.line(7, 8, 7, 11, [220, 40, 40]).line(6, 9, 8, 9, [220, 40, 40])
  if (o.gun) im.line(11, 6, 11, 12, [40, 40, 40]).set(11, 5, [60, 60, 60])
  if (o.torch) im.line(11, 7, 11, 12, [90, 90, 96]).set(11, 6, [255, 150, 40]).set(11, 5, [255, 220, 120])
  return im
}
/** Lying down (stung, carried or held): the standing sprite turned on its side, a little paler. */
function lying(im: Img): Img {
  const out = im.rotated()
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3]) for (let k = 0; k < 3; k++) out.data[i + k] = Math.min(255, out.data[i + k] + 40)
  return out
}

const taker = () => {
  const im = new Img().ellipse(2, 12, 13, 15, SHADOW)
  for (const y of [6, 9, 12]) im.line(2, y - 1, 13, y + 1, [30, 22, 26])
  im.ellipse(4, 4, 11, 13, [150, 66, 44], [60, 24, 16]).ellipse(5, 1, 10, 6, [170, 80, 54], [60, 24, 16])
  return im.set(6, 3, [255, 220, 120]).set(9, 3, [255, 220, 120])
}
const spineback = () => {
  const im = new Img().ellipse(1, 12, 14, 15, SHADOW)
  for (const y of [5, 9, 13]) im.line(0, y - 1, 15, y + 1, [30, 18, 18])
  im.ellipse(3, 3, 12, 14, [160, 36, 36], [60, 10, 10])
  for (let x = 5; x < 11; x += 2) im.line(x, 5, x, 2, [230, 210, 190])
  return im.set(6, 6, [255, 230, 120]).set(9, 6, [255, 230, 120])
}
const broodling = () => {
  const im = new Img().ellipse(4, 11, 11, 14, SHADOW).ellipse(4, 6, 11, 12, [220, 200, 170], [120, 90, 70])
  for (const x of [6, 8, 10]) im.line(x, 7, x, 11, [190, 160, 130])
  return im
}
const cocoon = () => {
  const im = new Img().ellipse(3, 1, 12, 15, [120, 90, 150], [50, 34, 66])
  for (let y = 3; y < 14; y += 3) im.line(4, y, 11, y + 1, [80, 56, 104])
  return im.rect(6, 3, 9, 5, SKIN)
}
const turret = () => {
  const im = new Img().ellipse(2, 12, 13, 15, SHADOW).rect(3, 9, 12, 13, [70, 76, 84], [36, 40, 44])
  im.ellipse(3, 4, 12, 13, [90, 96, 104], [40, 44, 48]).rect(7, 0, 8, 7, [40, 44, 48])
  return im.set(7, 9, [255, 60, 60])
}
const broodMother = () => {
  const im = new Img(32, 32).ellipse(3, 24, 29, 31, [0, 0, 0, 100])
  for (const y of [10, 15, 20]) { im.line(0, y - 2, 31, y + 2, [30, 16, 30]); im.line(0, y - 1, 31, y + 3, [30, 16, 30]) }
  im.ellipse(6, 12, 26, 30, [110, 50, 120], [44, 16, 50])
  for (let y = 15; y < 29; y += 3) im.line(9, y, 23, y, [140, 76, 150])
  im.ellipse(9, 3, 23, 15, [150, 46, 46], [60, 12, 12]).ellipse(12, 0, 20, 7, [170, 60, 50], [60, 12, 12])
  return im.set(14, 3, [255, 230, 120]).set(18, 3, [255, 230, 120])
}

// ---------------------------------------------------------------- the list

const sprites: [string, Img][] = []
const add = (name: string, im: Img) => sprites.push([name, im])

for (let open = 0; open < 16; open++) for (let v = 0; v < 2; v++) add(`rock_${open}_${v}`, rock(open))
for (let open = 0; open < 16; open++) add(`wall_${open}`, buildingWall(open))
for (let v = 0; v < 4; v++) add(`mine_${v}`, mineFloor())
for (let v = 0; v < 2; v++) add(`colony_${v}`, colonyFloor())
for (let v = 0; v < 4; v++) add(`ground_${v}`, ground())
for (let v = 0; v < 2; v++) add(`paved_${v}`, paved())
for (let v = 0; v < 4; v++) add(`resin_${v}`, resin())
add('door_h', doorH()); add('door_v', doorH().rotated())
add('window_h', windowH()); add('window_v', windowH().rotated())
add('doorway_h', doorwayH()); add('doorway_v', doorwayH().rotated())
add('boulder', boulder()); add('elevator', elevator()); add('ladder', ladder()); add('chute', chute()); add('vent', vent())
add('barricade', barricade()); add('weld', weld()); add('boards', boards()); add('lock', lock())

const MINER: HumanLook = { shirt: [170, 110, 50], hat: [220, 190, 60] }
const TECH: HumanLook = { shirt: [70, 110, 170] }
const STAFF: HumanLook = { shirt: [196, 196, 190] }
for (const [job, look] of [['miner', MINER], ['tech', TECH], ['staff', STAFF]] as const) {
  add(`civ_${job}`, human(look))
  add(`civ_${job}_armed`, human({ ...look, gun: true }))
}
add('civ_miner_torch', human({ ...MINER, torch: true }))
add('soldier', human({ shirt: [70, 96, 50], hat: [50, 66, 36], gun: true }))
add('medic', human({ shirt: [220, 220, 214], hat: [50, 66, 36], cross: true }))
add('commander', human({ shirt: [44, 56, 96], hat: [220, 180, 60], beret: true, gun: true }))
add('human_down', lying(human({ shirt: [150, 150, 150] })))
add('taker', taker()); add('spineback', spineback()); add('broodling', broodling())
add('cocoon', cocoon()); add('turret', turret())

// ---------------------------------------------------------------- pack and write

const COLS = 16
const cells = sprites.length
const rows = Math.ceil(cells / COLS)
const sheet = new Img(COLS * T, (rows + 2) * T) // two more rows for the 32x32 Brood Mother
const rects: Record<string, [number, number, number, number]> = {}
sprites.forEach(([name, im], i) => {
  const x = (i % COLS) * T, y = Math.floor(i / COLS) * T
  sheet.paste(im, x, y)
  rects[name] = [x, y, T, T]
})
sheet.paste(broodMother(), 0, rows * T)
rects['brood_mother'] = [0, rows * T, 32, 32]

function png(im: Img): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(im.w, 0); header.writeUInt32BE(im.h, 4)
  header[8] = 8; header[9] = 6 // 8-bit RGBA
  const raw = Buffer.alloc((im.w * 4 + 1) * im.h)
  for (let y = 0; y < im.h; y++) Buffer.from(im.data.buffer, y * im.w * 4, im.w * 4).copy(raw, y * (im.w * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** The sheet at 4x on a dark background, for looking at. */
function preview(im: Img, scale: number): Img {
  const out = new Img(im.w * scale, im.h * scale).rect(0, 0, im.w * scale - 1, im.h * scale - 1, [24, 22, 20])
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const c = im.get(x, y)
    if (c[3]) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) out.set(x * scale + dx, y * scale + dy, c)
  }
  return out
}

writeFileSync('assets/sprites.png', png(sheet))
writeFileSync('assets/sprites_preview.png', png(preview(sheet, 4)))
const names = Object.keys(rects)
writeFileSync('src/render/spriteRects.ts', `// Generated by scripts/make-sprites.ts (npm run sprites). Don't edit by hand.
// Where each sprite sits on assets/sprites.png: [x, y, width, height] in pixels.

export type SpriteName =
${names.map((n) => `  | '${n}'`).join('\n')}

export const SPRITE_RECTS: Record<SpriteName, readonly [number, number, number, number]> = {
${names.map((n) => `  ${/^[a-z_][a-z0-9_]*$/.test(n) ? n : `'${n}'`}: [${rects[n].join(', ')}],`).join('\n')}
}
`)
console.log(`Wrote ${names.length} sprites to assets/sprites.png (${sheet.w}x${sheet.h})`)
