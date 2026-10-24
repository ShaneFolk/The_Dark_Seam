// The med bay: a limited number of beds. A patient in a bed heals, and an
// infection is cured after cureSeconds. If the larva hatches first, it hatches
// right there in the med bay (handled by the normal infection timer).

import { CONFIG } from '../config.ts'
import type { Agent } from '../agents/agent.ts'
import type { World } from '../world/loadWorld.ts'
import { findRooms, roomAt, sameRoom, type RoomRef } from '../world/rooms.ts'
import { tileOf } from '../agents/agent.ts'

export interface MedBay {
  room: RoomRef
  /** Patient ids in beds. */
  beds: number[]
}

export function createMedBays(world: World): MedBay[] {
  return findRooms(world, ['medbay']).map((room) => ({ room, beds: [] }))
}

const TPS = CONFIG.sim.ticksPerSecond

/** Does this person need the med bay? (Infected people only know if they were rescued or stabilized.) */
export function needsMedBay(agent: Agent): boolean {
  const civ = agent.civ
  if (!civ || agent.dead) return false
  const knowsInfected = !!civ.infection && (civ.rescued || civ.infection.stabilizedUntilTick > 0)
  return knowsInfected || agent.health < CONFIG.medbay.seekBelowHealth
}

/** Fill free beds with patients standing in the room; heal and cure those in beds. */
export function updateMedBays(medbays: MedBay[], agents: Agent[], world: World): void {
  for (const bay of medbays) {
    // Patients who left, died, or are fully better give up their bed.
    bay.beds = bay.beds.filter((id) => {
      const a = agents[id]
      return a && !a.dead && sameRoom(roomAt(world, tileOf(a)), bay.room) && (a.civ?.infection || a.health < a.maxHealth)
    })
    if (bay.beds.length < CONFIG.medbay.beds) {
      for (const a of agents) {
        if (bay.beds.length >= CONFIG.medbay.beds) break
        if (a.dead || bay.beds.includes(a.id) || !needsMedBay(a)) continue
        if (!sameRoom(roomAt(world, tileOf(a)), bay.room)) continue
        bay.beds.push(a.id)
        a.civ!.cureTicks = 0
      }
    }
    for (const id of bay.beds) {
      const a = agents[id]
      a.health = Math.min(a.maxHealth, a.health + CONFIG.medbay.healPerSecond / TPS)
      const civ = a.civ!
      if (civ.infection && ++civ.cureTicks >= CONFIG.medbay.cureSeconds * TPS) {
        civ.infection = null
        civ.cured = true
      }
    }
  }
}

/** The med bay to head for (the first one; the map has one). */
export function medBayFor(medbays: MedBay[]): RoomRef | null {
  return medbays[0]?.room ?? null
}
