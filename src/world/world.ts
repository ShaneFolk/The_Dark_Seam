// Builds the world from the hand-made maps in data/maps/.

import { LEVEL_1 } from '../data/maps/level1.ts'
import { LEVEL_2 } from '../data/maps/level2.ts'
import { loadWorld, type World } from './loadWorld.ts'

export type { World }

export function createWorld(): World {
  // Level 3 is being redrawn for the new map format.
  return loadWorld([LEVEL_1, LEVEL_2])
}
