// Supplies: finite stock kept in rooms (armory, lockers and supply rooms,
// security, med bay). Soldiers restock from it, medics refill stabilizers,
// scared civilians grab pistols. Starting amounts vary a little by seed.

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import { findRooms, type RoomRef } from '../world/rooms.ts'

export interface Stock {
  rifleMags: number
  pistolMags: number
  pistols: number
  stabilizers: number
  /** Packed sentry turrets. */
  turrets: number
}

export type StockItem = keyof Stock

/** Stock per room, keyed by "levelIndex:roomIndex". */
export type Supplies = Map<string, { room: RoomRef; stock: Stock }>

export const roomKey = (r: RoomRef) => `${r.levelIndex}:${r.room.index}`

export function createSupplies(world: World, rng: Rng): Supplies {
  const supplies: Supplies = new Map()
  const v = CONFIG.supplies.variation
  for (const [type, base] of Object.entries(CONFIG.supplies.stock)) {
    for (const room of findRooms(world, [type as keyof typeof CONFIG.supplies.stock])) {
      const vary = (n: number) => Math.max(0, Math.round(n * (1 + (rng.next() * 2 - 1) * v)))
      supplies.set(roomKey(room), {
        room,
        // Turrets don't vary: the armory always has its full set.
        stock: { rifleMags: vary(base.rifleMags), pistolMags: vary(base.pistolMags), pistols: vary(base.pistols), stabilizers: vary(base.stabilizers), turrets: base.turrets },
      })
    }
  }
  return supplies
}

export function stockIn(supplies: Supplies, room: RoomRef | null): Stock | null {
  return room ? supplies.get(roomKey(room))?.stock ?? null : null
}

/** Take up to `want` of an item from a room; returns how many were taken. */
export function take(stock: Stock, item: StockItem, want: number): number {
  const got = Math.min(want, stock[item])
  stock[item] -= got
  return got
}

/** Rooms that still have some of an item, nearest first (straight-line, same level preferred). */
export function roomsWith(supplies: Supplies, item: StockItem, from: { levelIndex: number; x: number; y: number }): RoomRef[] {
  return [...supplies.values()]
    .filter((s) => s.stock[item] > 0)
    .map((s) => s.room)
    .sort((a, b) => cost(a) - cost(b))

  function cost(r: RoomRef): number {
    return Math.abs(r.levelIndex - from.levelIndex) * 200 + Math.hypot(r.room.centerX - from.x, r.room.centerY - from.y)
  }
}

/** Totals across all rooms, for the sidebar. */
export function totalStock(supplies: Supplies): Stock {
  const t: Stock = { rifleMags: 0, pistolMags: 0, pistols: 0, stabilizers: 0, turrets: 0 }
  for (const { stock } of supplies.values()) for (const k of Object.keys(t) as StockItem[]) t[k] += stock[k]
  return t
}
