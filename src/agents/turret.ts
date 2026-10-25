// Sentry turrets: start packed in the armory. Squads carry them out and set them
// up at defence points. They shoot the nearest Myrr in reach while the colony has
// power and they have ammo. Squads reload them.

import { CONFIG } from '../config.ts'
import type { World } from '../world/loadWorld.ts'
import { Tile } from '../world/tiles.ts'
import { roomTiles } from '../world/rooms.ts'
import { strongest } from '../systems/pheromones.ts'
import type { PathNode } from '../world/pathfinding.ts'
import { createAgent, type Agent } from './agent.ts'
import { makeWeapon, nearestVisible, tryAttack, type CombatContext } from './combat.ts'
import { hasPower } from '../systems/power.ts'

/**
 * Where should the next turret go? A defence point near recent fighting on
 * Levels 1-2 (danger scent), else the next default room (Mine Head, Elevator
 * Station, ...). Never within `spacing` tiles of another turret or of a spot
 * another squad is already carrying one to (`reserved`).
 */
export function deploySite(ctx: CombatContext, reserved: PathNode[] = []): PathNode | null {
  const C = CONFIG.turrets
  // Taken: turrets already standing, and spots other squads are carrying one to.
  const taken: PathNode[] = [...ctx.agents.filter((a) => a.kind === 'turret' && !a.dead).map((a) => ({ levelIndex: a.levelIndex, x: a.x, y: a.y })), ...reserved]
  const free = (p: PathNode) => !taken.some((x) => x.levelIndex === p.levelIndex && Math.hypot(x.x - p.x, x.y - p.y) < C.spacing)

  for (const hot of strongest(ctx.pheromones, 'danger', ctx.world, 10, C.deployDanger)) {
    if (hot.at.levelIndex > 1) continue
    const spot = standableNear(ctx.world, hot.at)
    if (spot && free(spot)) return spot
  }
  for (const name of C.defaultSpots) {
    const room = ctx.world.levels.flatMap((l, li) => l.rooms.map((r) => ({ levelIndex: li, room: r }))).find((r) => r.room.name === name)
    if (!room) continue
    const tiles = roomTiles(ctx.world, room).filter((p) => ctx.world.levels[p.levelIndex].tiles[p.y * ctx.world.levels[p.levelIndex].width + p.x] === Tile.Floor)
    const centre = tiles.sort((a, b) => Math.hypot(a.x - room.room.centerX, a.y - room.room.centerY) - Math.hypot(b.x - room.room.centerX, b.y - room.room.centerY))[0]
    if (centre && free(centre)) return centre
  }
  return null
}

/**
 * Where to put a turret to defend the Landing Pad: an edge tile of the pad,
 * nearest the Mine Head first (the way up from the mines), spaced apart.
 */
export function padSite(ctx: CombatContext, reserved: PathNode[] = []): PathNode | null {
  const level = ctx.world.levels[0]
  const pad = level.rooms.find((r) => r.name === 'Landing Pad')
  if (!pad) return null
  const ref = { levelIndex: 0, room: pad }
  const from = level.rooms.find((r) => r.name === 'Mine Head') ?? pad
  const taken: PathNode[] = [...ctx.agents.filter((a) => a.kind === 'turret' && !a.dead).map((a) => ({ levelIndex: a.levelIndex, x: a.x, y: a.y })), ...reserved]
  const spacing = CONFIG.commander.evacuation.padTurretSpacing
  const edge = roomTiles(ctx.world, ref).filter((t) => {
    if (level.linksAt.has(t.y * level.width + t.x)) return false
    // On the edge: a neighbour is outside the pad.
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => level.roomOf[(t.y + dy) * level.width + t.x + dx] !== pad.index)
  })
  edge.sort((a, b) => Math.hypot(a.x - from.centerX, a.y - from.centerY) - Math.hypot(b.x - from.centerX, b.y - from.centerY))
  return edge.find((p) => !taken.some((x) => x.levelIndex === 0 && Math.hypot(x.x - p.x, x.y - p.y) < spacing)) ?? null
}

/** A plain floor tile a human can stand on, close to a spot. */
function standableNear(world: World, at: PathNode): PathNode | null {
  const level = world.levels[at.levelIndex]
  for (let r = 0; r <= 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = at.x + dx, y = at.y + dy
        if (x < 1 || y < 1 || x >= level.width - 1 || y >= level.height - 1) continue
        const tile = level.tiles[y * level.width + x]
        if ((tile === Tile.Floor || tile === Tile.Ground) && !level.linksAt.has(y * level.width + x)) return { levelIndex: at.levelIndex, x, y }
      }
  return null
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
