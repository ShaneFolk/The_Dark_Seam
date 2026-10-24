// Resin: the hive's home turf. Myrr move faster on it.
// Phase 2 only seeds the starting resin around the hive; Takers spread it in Phase 4.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import { canWalk } from '../world/pathfinding.ts'

/** Cover the hive core and the walkable tiles within `startRadius` steps of it. */
export function seedHiveResin(world: World): void {
  for (const level of world.levels) {
    const hives = level.rooms.filter((r) => r.type === 'hive').map((r) => r.index)
    if (!hives.length) continue
    const { width, height } = level
    const dist = new Int32Array(width * height).fill(-1)
    const queue: number[] = []
    for (let i = 0; i < level.roomOf.length; i++) {
      if (hives.includes(level.roomOf[i])) { dist[i] = 0; queue.push(i) }
    }
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k]
      level.resin[i] = 1
      if (dist[i] >= CONFIG.resin.startRadius) continue
      const x = i % width, y = (i - x) / width
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        const n = ny * width + nx
        if (!canWalk(level, nx, ny, 'myrr') || dist[n] !== -1) continue
        dist[n] = dist[i] + 1
        queue.push(n)
      }
    }
  }
}
