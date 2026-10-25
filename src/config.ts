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
    /** Speed buttons (times normal speed). Space pauses; + and - step through these. */
    speeds: [1, 2, 4, 8],
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
    myrrSpeed: 4.5,
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
    taker: 80,
    spineback: 160,
    broodling: 30,
    broodMother: 1200,
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
    /**
     * Personality, rolled per civilian from the seed (chance of each; the rest have none):
     *   brave     fear builds slower (braveFear); brave miners carry a cutting torch and fight with it
     *   panicky   fear builds faster (panickyFear)
     *   stubborn  ignores the alarm and keeps to their routine; only heads for the ship once it has landed
     */
    traits: { brave: 0.15, panicky: 0.15, stubborn: 0.1 },
    braveFear: 0.6,
    panickyFear: 1.5,
  },

  perception: {
    /** How often senses are checked, in ticks. */
    intervalTicks: 5,
    /** How far a civilian can see, in tiles (walls, rock and doors block sight). */
    sightRange: 9,
    /** Sound loses this share of its range through walls. */
    wallMuffle: 0.5,
  },

  spinebacks: {
    /** Spinebacks that always stay home guarding the Brood Mother; the rest go raiding. */
    homeGuards: 2,
    /** A spare guard sets off on a raid about this often, in seconds. */
    raidEverySeconds: 40,
    /** Raiders sting at this health (Takers wait for lower), so they rarely kill. */
    stingHealth: 60,
    /** Carrying someone barely slows a Spineback. */
    carrySpeedMultiplier: 0.9,
    /** A raider takes on a person with up to this many others nearby (Takers: hive.groupSize). */
    groupSize: 3,
    /** Below this share of its own health a Spineback stops taking prisoners and fights to kill. */
    killBelowHealth: 0.4,
  },

  swarm: {
    /** Myrr this far away answer a screech, in tiles (another level counts as levelDistance). */
    callRange: 80,
    levelDistance: 15,
    /** They rush once this many have gathered within gatherRadius of the caller... */
    size: 4,
    gatherRadius: 5,
    /** ...or after waitSeconds with at least two; after maxWaitSeconds the swarm breaks up. */
    waitSeconds: 20,
    maxWaitSeconds: 40,
    /** People within this many tiles of the rally point are rushed. */
    preyRange: 14,
    /** Seconds before the hive can call another swarm. */
    cooldownSeconds: 30,
    /**
     * The swarm on the Landing Pad when the ship is heard: every Myrr not guarding goes.
     * They gather approachTiles short of the pad (along their route), then rush everyone within preyRange.
     */
    ship: { approachTiles: 16, waitSeconds: 25, maxWaitSeconds: 70, preyRange: 30 },
  },

  utility: {
    /** Random picks favour better scores: chance grows with score ^ sharpness. */
    sharpness: 2,
    /** A rested Taker's (or raider's) next job (see chooseNextJob in myrr.ts). */
    taker: {
      /** scout = scoutBase + scoutHunger x hunger (1 with nothing held, 0 at fullAt captives + cocoons). */
      scoutBase: 0.45,
      scoutHunger: 0.4,
      fullAt: 10,
      /** spread = spreadBase x the share of the resin limit still uncovered. */
      spreadBase: 0.55,
      /** Losses count from power.sabotageAfterLosses up to lossesFull (0 to 1): "the humans fight back". */
      lossesFull: 10,
      /** sabotage = sabotageMax x losses + turretBonus x (turrets standing, up to 3). */
      sabotageMax: 0.35,
      turretBonus: 0.15,
      /** commander = commanderMax x losses, halved while the command squad is with them. */
      commanderMax: 0.35,
      /** Shot recently: sabotage and the Commander hunt score lower, recovering over shakenSeconds. */
      shakenSeconds: 90,
    },
    /**
     * The Brood Mother, every few seconds while rooted: keep laying (lay) or shriek for her
     * raiding Spinebacks to come home (recall = recall x threat). Threat grows with free humans
     * in her chamber (0 to 1 over intruders) and with lost health. At most once per recallCooldownSeconds.
     */
    mother: { lay: 0.5, recall: 0.9, intruders: [0, 4] as [number, number], recallCooldownSeconds: 120 },
    /**
     * The Commander's assault choice (see planAssault in commander.ts). Urgency is the
     * largest of: cocoons (0 at cocoons[0], 1 at cocoons[1]), hive size (same, hiveSize),
     * and finish (when the hive is down to assault.finishHiveAtOrBelow Myrr).
     *   probe = urgency x probe      force = urgency x (0.6 to 1 by soldiers) x (0.5 to 1 by morale)
     *   must  = must x (people about to hatch, mustHatching range)      wait = wait (secondWait for the second-in-command)
     * After an assault breaks off, force and must are scaled down (to failedScale), recovering over memorySeconds.
     */
    commanderMemory: { failedScale: 0.5, memorySeconds: 480 },
    commander: { cocoons: [1, 8] as [number, number], hiveSize: [12, 24] as [number, number], finish: 0.9, probe: 0.9, forceBonusSoldiers: 6, mustHatching: [0, 4] as [number, number], must: 0.8, wait: 0.45, secondWait: 0.6 },
  },

  myrrHealing: {
    /** Health a Myrr regains per second while holding still on resin. */
    onResinPerSecond: 1,
    /** Health the Brood Mother regains per second while rooted (resin or not). */
    motherRootedPerSecond: 3,
  },

  camouflage: {
    /** Humans spot a hidden Myrr (holding still on resin) only within this many tiles. */
    sightRange: 2.5,
    /** Seconds a Myrr must hold still on resin before it blends in. Moving, attacking or getting hurt starts the count again. */
    hideSeconds: 10,
    /** A Myrr that was hidden this recently still strikes as an ambush, in seconds (it has to move to reach you). */
    ambushWindowSeconds: 3,
    /** Hidden guards wait until a human is this close before striking, in tiles. */
    ambushRange: 4,
    /** The first blow from hiding does this many times normal damage. */
    ambushDamage: 2,
  },

  noise: {
    /** How far each kind of noise carries, in tiles. */
    radius: { skitter: 5, scream: 12, gunshot: 16, dig: 14, smash: 14, chew: 10, blast: 30, sensor: 0, screech: 22 },
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
    gunshot: 0.04,
    dig: 0.03,
    smash: 0.06,
    chew: 0.04,
    blast: 0.1,
    sensor: 0,
    screech: 0.1,
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
    spinebacks: 4,
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
    /** Digging (Levels 2 and 3 only): starts where danger scent reaches this strength... */
    digTriggerDanger: 15,
    /** ...at most once per this many seconds. */
    digCooldownSeconds: 180,
    /** Seconds to dig through one rock tile, and the longest tunnel the hive will try. */
    digSecondsPerTile: 15,
    maxDigLength: 5,
    /** A tunnel is only worth digging if it saves at least this many tiles of walking. */
    minDigSavings: 25,
    /** How far from the danger spot to look for a place to dig, in tiles. */
    digSearchRadius: 15,
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
    lossBias: 0.05,
    /** Spinebacks stay within this many tiles of the Brood Mother. */
    guardRadius: 6,
    /** Broodlings crawl about within this many tiles of where they hatched while they grow. */
    broodlingRoam: 3,
    /** Guards that stay with the Brood Mother; the others hide in the resin by the cocoons and Broodlings, within cocoonGuardRadius tiles. */
    motherGuards: 1,
    cocoonGuardRadius: 3,
    /** Spinebacks that always stay with the Brood Mother when others answer an alarm. */
    minGuards: 1,
    /** Answering Spinebacks go back to guarding after this long without a human in sight, in seconds. */
    alarmGiveUpSeconds: 15,
    /** The Brood Mother retreats (to the Deep Chamber, then by burrowing) when below this share of health, or when humans are in the hive with fewer Spinebacks than this. */
    fleeBelowHealth: 0.5,
    fleeWhenGuardsBelow: 1,
    /** ...but unguarded she only flees once below this share of health (she fights first). */
    fleeUnguardedBelowHealth: 0.75,
    /** How fast she moves when fleeing, in tiles per second. */
    motherFleeSpeed: 2.2,
    /** Driven out of her Deep Chamber, she burrows into the deep rock: the Escape ending unless she's killed within this many seconds. */
    burrowSeconds: 30,
    /** At zero health she would flee at only this share of that speed (scales with her health). */
    woundedFleeShare: 0.5,
    /** She is rooted in her chamber. To move at all (to fight or to flee) she must first uproot, in seconds. */
    uprootSeconds: 20,
    /** Seconds to root herself again once back home. */
    rerootSeconds: 8,
    /** How fast she moves when hunting intruders in the hive core, in tiles per second. */
    motherSpeed: 1.4,
    /** Uprooted, she goes home after this long without an intruder in the hive core, in seconds. */
    motherCalmSeconds: 12,
    /** Her inner chamber: cocoons are placed farther than this from her home, in tiles. */
    chamberRadius: 7,
    /** Guards shift position about this often when nothing is happening, in seconds. */
    guardWanderSeconds: 30,
    /** After she dies, the other Myrr lose this much health per second. */
    collapseDecayPerSecond: 2,
  },

  combat: {
    /**
     * Weapons. range in tiles, damage per hit, shots (or swings) per second,
     * magazine size and reload time (magazine 0 = melee, no ammo).
     */
    weapons: {
      rifle: { range: 9, damage: 12, perSecond: 2, magazine: 30, reloadSeconds: 2.5 },
      pistol: { range: 7, damage: 12, perSecond: 1.5, magazine: 12, reloadSeconds: 1.5 },
      fists: { range: 1.2, damage: 4, perSecond: 1, magazine: 0, reloadSeconds: 0 },
      claws: { range: 1.2, damage: 10, perSecond: 2, magazine: 0, reloadSeconds: 0 },
      spines: { range: 1.4, damage: 22, perSecond: 1.5, magazine: 0, reloadSeconds: 0 },
      turret: { range: 10, damage: 10, perSecond: 3, magazine: 120, reloadSeconds: 0 },
      flamethrower: { range: 3.5, damage: 18, perSecond: 2, magazine: 40, reloadSeconds: 4 },
      /** A miner's cutting torch (brave miners): a strong melee weapon. */
      torch: { range: 1.2, damage: 14, perSecond: 1, magazine: 0, reloadSeconds: 0 },
      /** The Brood Mother's crushing bite: slow, but three bites kill a soldier. */
      maw: { range: 1.8, damage: 40, perSecond: 0.75, magazine: 0, reloadSeconds: 0 },
    },
    /** Chance to hit at point blank. Falls off with distance (see hitFalloff). */
    skill: { soldier: 0.6, medic: 0.5, civilian: 0.35, myrr: 0.8 },
    /** At full range, hit chance is multiplied by (1 - hitFalloff). */
    hitFalloff: 0.5,
    /** Spare magazines a soldier carries (refilled at the armory). */
    spareMagazines: 4,
    /** Tracer lines stay on screen this long, in seconds. */
    tracerSeconds: 0.15,
  },

  soldiers: {
    /** Soldiers at the start (2 squads), not counting the command squad. Reinforcements come later. */
    count: 6,
    /** Soldiers per squad. The last member of each squad is its medic. */
    squadSize: 3,
    /** Members further than this from their leader catch up, in tiles. */
    followDistance: 3,
    /** Seconds at the armory to restock. */
    resupplySeconds: 6,
    /** Seconds to cut a cocoon open. */
    cutSeconds: 5,
    /** Someone cut from a cocoon is weak: health at most this, walking at this share of normal speed until cured. */
    rescuedHealth: 30,
    rescuedSpeed: 0.6,
    /** A brave civilian who survives being taken (free again, not infected) volunteers: joins the smallest squad with a rifle, at this skill. */
    volunteerSkill: 0.45,
    /** Medics: stabilizers carried (refilled at the armory for now), and how long each job takes. */
    stabilizers: 3,
    wakeSeconds: 3,
    stabilizeSeconds: 4,
    /** A stabilizer pauses the larva this long, in seconds (about 16 colony hours). */
    stabilizerPauseSeconds: 480,
    /** Medics look for patients this far away, in tiles, and won't go if a Myrr is this close. */
    patientRange: 12,
    unsafeRange: 6,
    /** A response is dropped when no Myrr has been seen for this long, in seconds. */
    respondGiveUpSeconds: 20,
    /** Morale (0 to 1): changes per event or per second. */
    morale: {
      squadmateDown: 0.3,
      hitTaken: 0.03,
      outnumberedPerSecond: 0.02,
      recoverPerSecond: 0.01,
      /** Below breakAt the squad retreats; above regroupAt it returns to duty. */
      breakAt: 0.3,
      regroupAt: 0.6,
    },
  },

  supplies: {
    /**
     * Starting stock per room type: rifle and pistol magazines, spare pistols
     * (for civilians to grab) and stabilizers. Each amount varies by up to
     * `variation` either way, by seed. Lockers and supply rooms share type "supply".
     */
    stock: {
      armory: { rifleMags: 60, pistolMags: 30, pistols: 10, stabilizers: 6, turrets: 6, incendiaries: 24, flares: 16 },
      supply: { rifleMags: 6, pistolMags: 6, pistols: 2, stabilizers: 1, turrets: 0, incendiaries: 0, flares: 0 },
      medbay: { rifleMags: 0, pistolMags: 0, pistols: 0, stabilizers: 8, turrets: 0, incendiaries: 0, flares: 0 },
      security: { rifleMags: 10, pistolMags: 6, pistols: 2, stabilizers: 0, turrets: 0, incendiaries: 4, flares: 4 },
    },
    variation: 0.3,
    /** A scared civilian goes for a pistol if a room with one is within this many tiles. */
    armRange: 25,
    /** Pistol magazines a civilian takes with a pistol. */
    civilianMags: 2,
  },

  power: {
    /** Health of each generator. 0 = broken; power is on while any generator works. */
    generatorHp: 300,
    /** Damage per second a Taker does to a generator. */
    sabotageDps: 10,
    /** Health a tech restores per second when repairing. */
    repairPerSecond: 4,
    /** Without power (and always on Level 3), human sight is multiplied by this. */
    darkSightMultiplier: 0.5,
    /** Levels with lights (Level 3 never has any). Numbers are level indexes (0 = Level 1). */
    litLevels: [0, 1],
    /** Once the hive has lost this many Myrr, the humans count as fighting back: sabotage and hunting the Commander become options (see utility.taker). */
    sabotageAfterLosses: 2,
  },

  turrets: {
    /**
     * Sentry turrets start packed in the armory (see supplies.stock.armory.turrets).
     * A squad on patrol fetches one, carries it (slower) and sets it up at a defence point.
     */
    pickupSeconds: 3,
    setupSeconds: 6,
    /** Seconds to pack up a turret that's already set up (to move it to the Landing Pad on evacuation). */
    packSeconds: 5,
    carrySpeedMultiplier: 0.7,
    /** Defence points: where danger scent (fighting) is at least this strong... */
    deployDanger: 3,
    /** ...or else these rooms, in order. */
    defaultSpots: ['Mine Head', 'Elevator Station', 'Security', 'Mess Hall', 'Supply Depot', 'Med Bay'],
    /** Turrets are kept at least this many tiles apart. */
    spacing: 8,
    health: 150,
    skill: 0.7,
    /** Squads reload a turret below this share of its magazine, spending this many spare rifle magazines. */
    reloadBelow: 0.5,
    reloadMags: 2,
    reloadSeconds: 4,
    /** Backup battery: with the colony's power out, a turret keeps firing for this many seconds of use. It recharges as fast while the power is on. */
    batterySeconds: 240,
  },

  flamethrower: {
    /** Flamethrowers carried (by soldiers in the first squads). */
    count: 1,
    /** Myrr within this many tiles of the target are also burned. */
    splash: 1.5,
    /** Resin is burned away this many tiles around the target. */
    burnRadius: 1,
  },

  incendiaries: {
    /** Incendiary grenades each squad carries (restocked at the armory). */
    perSquad: 4,
    /** How far ahead along its route a squad throws one, in tiles. */
    throwRange: 6,
    /** Seconds the squad stops to throw. */
    throwSeconds: 3,
    /** Resin burns away this many tiles around where it lands; Myrr there take fire damage. */
    radius: 2,
    damage: 30,
    /** Without grenades, the flamethrower can burn resin instead, using this much fuel each time. */
    flamerFuel: 8,
  },

  flares: {
    /** Flares each squad carries (restocked at the armory). A lit flare shows hidden Myrr within radius tiles. */
    perSquad: 2,
    radius: 6,
    burnSeconds: 25,
    /** A squad on Levels 2-3 lights one when resin is near and no flare burns within this many tiles. */
    spacing: 10,
  },

  decoy: {
    /**
     * Once the hive has lost afterLosses Myrr, it may stage a diversion (chance per 5 s check,
     * at most once per cooldownSeconds): a Taker paces around a motion sensor on Level 2,
     * smashing things, for holdSeconds. raidAfterSeconds after the noise starts, a swarm raids
     * the Level 1 room with the most people (minPrey+) and no soldier within soldierClear tiles.
     * The hive needs minFree free Takers and Spinebacks. The decoy runs if humans come within fleeRange.
     */
    afterLosses: 3,
    cooldownSeconds: 900,
    chance: 0.1,
    minFree: 5,
    minPrey: 3,
    soldierClear: 15,
    paceRadius: 4,
    noiseEverySeconds: 2,
    holdSeconds: 70,
    fleeRange: 7,
    raidAfterSeconds: 25,
    /** The whole diversion is forgotten after this long. */
    maxSeconds: 240,
    raid: { approachTiles: 10, waitSeconds: 20, maxWaitSeconds: 60, preyRange: 16 },
  },

  nest: {
    /**
     * The hive adapts: after soldiers have been among the cocoons, it moves them to
     * another room on Level 3 (Takers carry them), at most maxMoves times, cooldownSeconds apart.
     */
    maxMoves: 2,
    cooldownSeconds: 600,
    /** Carrying a cocoon slows a Taker to this share of its speed. */
    haulSpeedMultiplier: 0.7,
  },

  charges: {
    /** Mining charges, one each for the first squads. */
    count: 2,
    /** Danger scent on Level 2 that makes a squad blast the tunnel nearby. */
    trigger: 15,
    /** Seconds to set a charge. */
    setSeconds: 15,
    /** Tunnel tiles within this many tiles of the charge collapse into rock. */
    radius: 1,
  },

  sensors: {
    /** Motion sensors near the Upper Mine's vent shafts and ladders. */
    count: 5,
    /** A Myrr moving within this many tiles sets one off. */
    range: 6,
    /** A sensor can alert again after this many seconds. */
    cooldownSeconds: 20,
  },

  commander: {
    /** The Commander reviews the situation this often, in seconds. */
    intervalSeconds: 5,
    /** The command squad (extra, on top of soldiers.count) stays with the Commander and fights Myrr within guardRange tiles of them. */
    guardSquadSize: 3,
    guardRange: 10,
    /** If the Commander is killed or taken, the second-in-command takes over: slower decisions, more cautious assaults, a morale blow. */
    second: { slowerBy: 3, assaultMinMorale: 0.85, moraleHit: 0.3 },
    /** The alarm (and any lockdown) clears after this long with no Myrr seen, in seconds. */
    alarmClearSeconds: 300,
    /** Health of a locked powered door (Myrr must break it; humans open it). */
    lockHp: 200,
    /** Squads skip burning resin when someone in a cocoon would hatch within this many seconds. */
    riskHatchSeconds: 60,
    assault: {
      /** A known hive down to this many Myrr or fewer is urgent to finish off (see utility.commander). */
      finishHiveAtOrBelow: 8,
      /** Squads sent need this morale and members. */
      minMorale: 0.6,
      minMembers: 2,
      /**
       * The first assault is a probe: one squad. After that the Commander only attacks
       * in force (every ready squad, at least forceMinSoldiers soldiers together)...
       */
      forceMinSoldiers: 8,
      /** ...unless he deems it a must (people about to hatch, see utility.commander): then one squad goes, at most once per mustCooldownSeconds. */
      mustCooldownSeconds: 360,
      /** At the hive with nothing to fight or cut for this long: the assault is over, in seconds. */
      quietSeconds: 10,
    },
    reinforcements: {
      /**
       * One call, once the Commander realizes people are being taken: missingToCall
       * people known to be missing. A capture is known at once if someone saw it,
       * otherwise after noticeSeconds (they don't turn up for their shift).
       */
      missingToCall: 3,
      noticeSeconds: 120,
      /** Also called if soldiers alive fall below this share of the starting number. */
      belowShare: 0.5,
      /** Seconds from the call until the drop ship lands at the Landing Pad (half a colony day). */
      delaySeconds: 360,
      /** What it brings: this many squads of this size. */
      squads: 2,
      squadSize: 4,
    },
    evacuation: {
      /** Ordered when free civilians fall below this share of the starting number. */
      civiliansBelow: 0.3,
      /**
       * First everyone falls back to the Landing Pad and the squads set up turrets around it;
       * the ship is called once padTurrets stand there (or none are left), or after fortifySeconds.
       */
      fortifySeconds: 180,
      /** Turrets wanted around the pad. The armory keeps this many back for it (patrols don't take them). */
      padTurrets: 3,
      /** Turrets around the pad stand at least this many tiles apart. */
      padTurretSpacing: 5,
      /** Seconds until the ship lands at the Landing Pad, and how long it waits there. */
      shipDelaySeconds: 240,
      shipWaitSeconds: 90,
      /** The hive hears the ship coming down this many seconds before it lands, and swarms the pad. */
      swarmLeadSeconds: 60,
    },
  },

  barriers: {
    /** Health of each obstacle. Windows and walls start with their own; barricades, welds and boards add on top. */
    windowHp: 30,
    wallHp: 400,
    barricadeHp: 120,
    weldHp: 250,
    boardsHp: 80,
    /** Damage per second a Myrr does to an obstacle in its way. */
    myrrBreakDps: 8,
    /** How fast humans take their own barriers down: barricades and boards, and welds (cutting). */
    humanRemoveDps: 20,
    humanCutDps: 6,
    /** Seconds for a human to put up each barrier. */
    barricadeSeconds: 6,
    weldSeconds: 8,
    boardSeconds: 4,
    /** Breaking noises are made this often, in seconds. */
    noiseEverySeconds: 2,
  },

  medbay: {
    /** Patients treated at once (per med bay). */
    beds: 4,
    /** Seconds in a bed to cure an infection. */
    cureSeconds: 60,
    /** Health regained per second in a bed. */
    healPerSecond: 2,
    /** Civilians below this health go to the med bay when calm. */
    seekBelowHealth: 50,
  },

  pheromones: {
    /** Scent laid per tile while carrying prey home. */
    carryTrail: 1,
    /** Scent laid where prey is seen, and where it is caught. */
    sighting: 3,
    capture: 8,
    /** Scent halves this often, in seconds. */
    halfLifeSeconds: 180,
    /** Alarm scent: laid when a Myrr is hurt or killed; fades fast. */
    alarmOnHurt: 4,
    alarmOnDeath: 10,
    alarmHalfLifeSeconds: 30,
    /** Spinebacks answer alarm at least this strong. */
    alarmRespond: 1.5,
    /** Spinebacks only answer alarms within this many tiles, on their level or the one above. */
    alarmRange: 45,
    /** Danger scent: laid where a Myrr is shot or killed (spread over a small area); fades slowly. */
    dangerOnHurt: 2,
    dangerOnDeath: 12,
    dangerSpread: 2,
    dangerHalfLifeSeconds: 600,
    /** Each unit of danger makes a tile cost this many extra seconds in a Taker's route planning. */
    dangerCost: 1.5,
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
