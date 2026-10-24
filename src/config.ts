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

  clock: {
    /** Real (sim) minutes for one 24-hour colony day. */
    dayLengthMinutes: 12,
    /** Colony hour when a run starts. */
    startHour: 6,
  },

  health: {
    human: 100,
    /** Health regained per second while calm (routine). */
    regenPerSecond: 0.2,
  },

  civilians: {
    count: 50,
    /** Hour each shift's day starts. Each civilian is on one shift. */
    shiftStartHours: [6, 18],
    /**
     * The day, in hours from shift start. Activities: eat, work, free, sleep.
     * Must add up to 24.
     */
    schedule: [
      { activity: 'eat', hours: 1 },
      { activity: 'work', hours: 5 },
      { activity: 'eat', hours: 1 },
      { activity: 'work', hours: 4 },
      { activity: 'eat', hours: 1 },
      { activity: 'free', hours: 3 },
      { activity: 'sleep', hours: 9 },
    ],
    /** Jobs: chance of each, and where they work (level number + room types). */
    jobs: {
      miner: { weight: 0.45, level: 2, roomTypes: ['workshop', 'other', 'supply'] },
      tech: { weight: 0.3, level: 1, roomTypes: ['workshop', 'generator', 'other'] },
      staff: { weight: 0.25, level: 1, roomTypes: ['command', 'medbay', 'supply', 'mess', 'security'] },
    },
    /** Seconds to stay put before moving to another spot in the same room (min, max). */
    millSeconds: [4, 12] as [number, number],
    /** Running speed when fleeing or panicking, as a multiple of walking speed. */
    runMultiplier: 1.3,
  },

  perception: {
    /** How often senses are checked, in ticks. */
    intervalTicks: 5,
    /** How far a civilian can see, in tiles (walls, rock and doors block sight). */
    sightRange: 9,
    /** Sound loses this share of its range through walls. */
    wallMuffle: 0.5,
  },

  noise: {
    /** How far each kind of noise carries, in tiles. */
    radius: { skitter: 5, scream: 12 },
    /** Myrr make a skittering noise this often while moving, in seconds. */
    skitterEverySeconds: 2,
    /** Panicking humans scream this often, in seconds. */
    screamEverySeconds: 2.5,
  },

  fear: {
    /** Fear added per sense check while a Myrr is in sight (more when closer). */
    sight: 0.25,
    /** Fear added by hearing a scream or skittering. */
    scream: 0.08,
    skitter: 0.05,
    /** Hearing alone never raises fear above this (enough to hide, not to flee). */
    hearingCap: 0.35,
    /** Fear lost per second when nothing scary is sensed. */
    decayPerSecond: 0.02,
    /** Fear is multiplied by this when alone, or when 2+ others are near. */
    aloneMultiplier: 1.5,
    groupMultiplier: 0.7,
    /** "Near" for the alone/group check, in tiles. */
    companyRadius: 5,
    /** Mode thresholds (fear 0 to 1). Below `calm` a civilian returns to routine. */
    calm: 0.15,
    hide: 0.25,
    flee: 0.4,
    panic: 0.85,
    /** Fleeing continues while a threat was seen this recently, in seconds. */
    fleeMemorySeconds: 4,
    /** Flee destination is searched this far away, in tiles (min, max). */
    fleeDistance: [12, 28] as [number, number],
  },

  hive: {
    takers: 6,
    /** Spinebacks at the start. They guard the Brood Mother (combat comes in Phase 6). */
    spinebacks: 2,
    /** How far Myrr see, in tiles (same blockers as for humans). */
    sightRange: 10,
    /** A human counts as "alone" with no other free human within this many tiles. */
    loneRadius: 5,
    /** Takers back off from a human with this many or more others nearby. */
    groupSize: 2,
    /** Seconds of contact needed to grab a lone human. */
    /** Damage per second a Taker's claws do to a human it is in contact with. */
    clawDamagePerSecond: 20,
    /** A human at or below this health can be stung. */
    stingHealth: 40,
    /** How long a sting paralyses, in seconds (if nobody carries them off). */
    paralysisSeconds: 60,
    /** Within this many tiles of its target a Taker pounces, moving faster. */
    pounceRange: 3,
    pounceMultiplier: 1.3,
    /** A hunt that lasts longer than this is dropped, in seconds. */
    maxHuntSeconds: 25,
    /** After giving up, a Taker ignores that human for this long, in seconds. */
    ignoreSeconds: 60,
    /** Carrying someone slows a Taker to this share of its speed. */
    carrySpeedMultiplier: 0.7,
    /** Rest in the hive between trips, in seconds (min, max). */
    restSeconds: [4, 12] as [number, number],
    /** Scouting trips without finding prey before going home to rest. */
    tripsBeforeReturn: 3,
    /** Chance a scout follows the strongest trail scent instead of exploring. */
    followTrailChance: 0.6,
    /** Where exploring scouts go: chance of Level 1, 2, 3. */
    scoutLevelWeights: [0.35, 0.45, 0.2],
    /** A hunt is dropped if the target is out of sight this long, in seconds. */
    huntGiveUpSeconds: 6,
    /** Hunters re-plan their route this often, in seconds. */
    repathSeconds: 1,
    /** Chance a rested Taker spreads resin instead of scouting. */
    resinTaskChance: 0.3,
  },

  lifecycle: {
    /** Seconds the Brood Mother needs to inject one captive. */
    injectSeconds: 6,
    /** Seconds from injection until the Broodling bursts out (about 8 colony hours). */
    incubationSeconds: 240,
    /** Seconds a Broodling grows in the hive before becoming a Taker or Spineback. */
    growSeconds: 120,
    /** The hive aims for this share of Spinebacks among its fighters and workers. */
    spinebackShare: 0.3,
    /** Each recent Spineback loss raises that share by this much (Phase 6 adds losses). */
    lossBias: 0.1,
    /** Spinebacks stay within this many tiles of the Brood Mother. */
    guardRadius: 6,
  },

  pheromones: {
    /** Scent laid per tile while carrying prey home. */
    carryTrail: 1,
    /** Scent laid where prey is seen, and where it is caught. */
    sighting: 3,
    capture: 8,
    /** Scent halves this often, in seconds. */
    halfLifeSeconds: 180,
    /** Scent weaker than this is ignored by scouts. */
    minFollow: 0.5,
  },

  /** Test Myrr wanderers from Phase 2 (0 now that the hive has real Takers). */
  wanderers: {
    myrr: 0,
    /** Chance a new destination is on another level (exercises the links). */
    otherLevelChance: 0.35,
    /** Rest between walks, in seconds (min, max). */
    pauseSeconds: [1, 5] as [number, number],
  },

  resin: {
    /** Resin covers this many tiles around the hive core at the start. */
    startRadius: 14,
    /** Seconds a Taker spends coating one patch of resin. */
    patchSeconds: 4,
    /** Size of a resin patch: tiles out from the centre. */
    patchRadius: 1,
    /** Resin stops spreading once this many tiles are covered (all levels). */
    maxTiles: 3000,
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
