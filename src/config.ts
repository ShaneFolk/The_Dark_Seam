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
    /** Every level uses this grid size, in tiles.  */
    levelWidth: 160,
    levelHeight: 100,
    /** A room bigger than this is reported as a map mistake (usually a missing door). */
    maxRoomTiles: 700,
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
