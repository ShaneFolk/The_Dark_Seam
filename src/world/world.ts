// Builds the world from the hand-made maps in data/maps/.

import { LEVEL_1 } from '../data/maps/level1.ts'
import { loadWorld, type World } from './loadWorld.ts'

export type { World }

export function createWorld(): World {
  // Levels 2 and 3 are being redrawn for the new map format.
  return loadWorld([LEVEL_1])
}
