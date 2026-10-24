// Sentry turrets: fixed guns in hallways. They shoot the nearest Myrr in reach
// while the colony has power and they have ammo. Squads reload them.

import { CONFIG } from '../config.ts'
import type { Rng } from '../core/rng.ts'
import type { World } from '../world/loadWorld.ts'
import { Tile } from '../world/tiles.ts'
import { findRooms, roomTiles } from '../world/rooms.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { createAgent, type Agent } from './agent.ts'
import { makeWeapon, nearestVisible, tryAttack, type CombatContext } from './combat.ts'
import { hasPower } from '../systems/power.ts'

/** Turret spots: built corridor tiles on the surface, and inside the Elevator Station. */
export function turretSpots(world: World, rng: Rng): PathNode[] {
  const spots: PathNode[] = []
  const surface = world.levels[0]
  const corridor: PathNode[] = []
  for (let i = 0; i < surface.tiles.length; i++) {
    // Corridor = built floor outside any room, with walls on two opposite sides.
    if (surface.tiles[i] !== Tile.Floor || surface.roomOf[i] >= 0 || surface.natural[i]) continue
    corridor.push({ levelIndex: 0, x: i % surface.width, y: Math.floor(i / surface.width) })
  }
  for (let n = 0; n < CONFIG.turrets.surface && corridor.length; n++) {
    // Spread them out: pick the candidate farthest from turrets already placed.
    let best = rng.pick(corridor), bestD = -1
    for (let k = 0; k < 40; k++) {
      const c = rng.pick(corridor)
      const d = Math.min(...spots.filter((s) => s.levelIndex === 0).map((s) => Math.hypot(s.x - c.x, s.y - c.y)), 999)
      if (d > bestD) { best = c; bestD = d }
    }
    spots.push(best)
  }
  const station = findRooms(world, ['other'], 1).find((r) => r.room.name === 'Elevator Station')
  if (station) {
    const tiles = roomTiles(world, station).filter((t) => world.levels[1].tiles[t.y * world.levels[1].width + t.x] === Tile.Floor)
    for (let n = 0; n < CONFIG.turrets.elevatorStation && tiles.length; n++) spots.push(rng.pick(tiles))
  }
  return spots
}

export function createTurret(id: number, at: PathNode): Agent {
  const t = createAgent(id, 'turret', 'human', at, 0, CONFIG.turrets.health)
  t.weapon = makeWeapon('turret', CONFIG.turrets.skill)
  t.weapon.spare = 0
  return t
}

/** Fire at the nearest Myrr in reach, if powered and loaded. */
export function updateTurret(turret: Agent, ctx: CombatContext): void {
  const w = turret.weapon!
  if (w.inMag <= 0 || !hasPower(ctx.power)) return
  if (w.cooldown > 0) return
  const target = nearestVisible(turret, ctx, CONFIG.combat.weapons.turret.range, (a) => a.side === 'myrr')
  if (target) tryAttack(turret, target, ctx)
}

/** Does this turret need reloading? */
export function needsReload(turret: Agent): boolean {
  const w = turret.weapon!
  return !turret.dead && w.inMag < CONFIG.combat.weapons.turret.magazine * CONFIG.turrets.reloadBelow
}
