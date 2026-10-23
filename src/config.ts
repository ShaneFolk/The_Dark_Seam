// All tuning values live here. Logic files import from this file
// instead of using raw numbers.

export const CONFIG = {
  sim: {
    /** Simulation updates per second (independent of screen frame rate). */
    ticksPerSecond: 20,
    /** Most ticks we'll run in one frame, so a long pause can't freeze the tab. */
    maxTicksPerFrame: 10,
    /** Seed used when none is given in the URL (?seed=123). */
    defaultSeed: 12345,
  },

  grid: {
    /** Test grid size, in tiles. */
    width: 64,
    height: 40,
    /** Chance that a test-grid tile is drawn as a "wall". */
    testWallChance: 0.15,
  },

  render: {
    /** Tile size in pixels at zoom 1. */
    tileSize: 16,
  },
} as const
