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

  world: {
    /** Number of levels, top to bottom. */
    levelCount: 3,
    /** Every level uses this grid size, in tiles.  */
    levelWidth: 160,
    levelHeight: 100,
    /** A room bigger than this is reported as a map mistake (usually a missing door). */
    maxRoomTiles: 700,
  },

  movement: {
    /** Walking speed in tiles per second. */
    humanSpeed: 2.5,
    myrrSpeed: 3.2,
    /** Myrr move this many times faster on resin. */
    resinSpeedMultiplier: 1.6,
    /** Seconds to travel a link between levels. */
    linkSeconds: { elevator: 8, ladder: 4, chute: 3, vent: 3 },
  },

  /** Test wanderers for Phase 2. Replaced by real units in later phases. */
  wanderers: {
    humans: 30,
    myrr: 12,
    /** Chance a new destination is on another level (exercises the links). */
    otherLevelChance: 0.35,
    /** Rest between walks, in seconds (min, max). */
    pauseSeconds: [1, 5] as [number, number],
  },

  resin: {
    /** Resin covers this many tiles around the hive core at the start. */
    startRadius: 14,
  },

  render: {
    /** Tile size in pixels at zoom 1. */
    tileSize: 16,
    /** Room names are drawn once a tile is at least this many screen pixels. */
    roomLabelMinTilePx: 9,
    /** Link arrows are drawn once a tile is at least this many screen pixels. */
    linkLabelMinTilePx: 12,
    minZoom: 0.2,
    maxZoom: 4,
    /** Zoom change per mouse-wheel notch. */
    zoomStep: 1.15,
    /** Keyboard pan speed, in screen pixels per second. */
    panSpeed: 900,
  },
} as const
