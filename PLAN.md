# The Dark Seam — Design & Build Plan

A top-down 2D simulation of an alien hive waking up beneath a mining colony. The focus is the AI: every run should play out differently. Graphics stay simple (colored shapes and tiles), with pan and zoom.

---

## 1. The Setting: Carrow Deep

A mining colony built over a deep mine. The hive starts at the bottom.

Three levels, viewed one at a time (number keys / tabs), with a sidebar showing activity counts on each level.

| Level | Name | Contents | Role |
|---|---|---|---|
| 1 | **Surface Colony** | Quarters, mess hall, command, med bay, armory, generator(s), supply rooms | Human home base |
| 2 | **Upper Mine — "the Fighting Grounds"** | Mazelike work tunnels, equipment bays, supply rooms, lockers | Where most clashes happen |
| 3 | **Deep Mine** | Old tunnels, caverns, the hive core | Myrr home base |

**Connections between levels:** main elevator, ladders/stairwells, ore chutes, ventilation shafts.

### Avoiding the choke-point problem
- **Many routes up:** elevator, side tunnels, ore chutes, and vent shafts reach different rooms. No single door holds everything.
- **Mazelike hallways** on Level 2 so there's always a flank.
- **Vents:** hidden links between rooms that only the Myrr can path through. No separate map layer.
- **The hive learns:** Myrr that die leave a *danger pheromone*. Others avoid that route and look for another way.
- **Digging:** Takers can slowly tunnel a new connection near a fortified spot. Humans can notice and respond.

---

## 2. The Myrr (the hive)

| Unit | Role | Behavior |
|---|---|---|
| **Brood Mother** | Queen | Starts stationary in the hive core. Injects captured humans with an embryo. Egg rate depends on captives brought in. Relocates with a Spineback escort if the hive is badly threatened. Her death starts hive collapse. |
| **Takers** | Workers/drones | Scout, lay trail pheromones, ambush lone humans, carry captives to the Brood Mother, spread resin, dig tunnels. Weak in a straight fight; avoid armed groups. |
| **Spinebacks** | Warriors | Guard the Brood Mother, answer alarm pheromones, hunt armed squads. Kill rather than capture (except stings). |
| **Broodlings** | Larvae | Hatch from injected hosts. Grow into Takers or Spinebacks based on hive needs (losing fighters → more Spinebacks). |

### Hive rules
- **Sting:** Takers and Spinebacks can sting a **low-health** human, paralyzing them for a timer. Paralyzed humans can't act and are easy to carry.
- **Resin:** Takers spread resin across tiles. **Myrr move faster on resin**, so the hive is their home turf. Flamethrowers burn resin away.
- **Pheromones:** a *trail* marks routes to prey and back home; *danger* marks kill zones; *alarm* calls Spinebacks to defend.
- **Strategic targets:** the hive can go after generators to knock out turrets, doors, and lights, and it targets medics as high-value captures.

---

## 3. The Humans

| Unit | Behavior |
|---|---|
| **Civilians** (miners, techs, staff) | Daily routines (work, eat, sleep). Notice threats by sight and sound. Flee, hide, or barricade when scared. Panic more alone, less near soldiers. Can grab weapons from the armory or lockers at **reduced skill**. Can build barricades. |
| **Soldiers / security** | Patrol, investigate, fight. Track health, ammo, and morale. Work in squads. Attempt rescues. Retreat when morale breaks. |
| **Medic** (one per squad) | Wakes paralyzed humans. Gives a stabilizer that **pauses larva growth**. Limited supplies. |
| **Commander** | Colony-wide decisions: sound the alarm, lock down sections, send search-and-destroy or rescue teams, order evacuation. |

---

## 4. The Capture Cycle (the core loop)

```
Taker finds human → (fight / sting if low health → paralyzed) → captured
→ carried to Brood Mother → injected → cocooned in hive
→ incubation timer → Broodling bursts out → grows into Taker or Spineback
```

**Humans can break it at any step:**
1. Fight off the capture.
2. Intercept the carrier.
3. Rescue the cocooned human from the hive.
4. Medic stabilizes them (pauses the timer).
5. Get them to the med bay, which **cures any human**, but takes time and a bed. If the timer runs out mid-cure, the Broodling hatches *inside* the med bay.
6. Kill the Brood Mother.

---

## 5. Gear & Facility Systems

**Supplies are finite but plentiful at the start**, spread across the **armory** (main stock), plus **lockers** and **supply rooms** on Levels 1–2.

| Item | Notes |
|---|---|
| **Ammo** | Main resource. Soldiers travel to resupply. |
| **Barricades** | Built in doorways/hallways, have health. Myrr claw through them eventually. Civilians can build them. |
| **Sentry turrets** | Placed in hallways. Limited ammo, **reloadable** by humans. Need power. Myrr can drain them with sacrificial Takers or route around them. |
| **Flamethrower** | Short range, area denial, burns resin. |
| **Welders** | **Weld doors shut.** Myrr take a long time to break through. Humans can cut them back open, which also takes time. A panic-weld can trap your own people. |
| **Mining charges** | Collapse a tunnel to seal it permanently. Very few, and slow to set. |
| **Motion sensors** | Early warning for a zone; feeds the Commander. |
| **Medkits / stabilizers** | Medic supplies. |

**Power:** generators run turrets, powered doors, the med bay, and lights. The Myrr can damage them, and humans can **repair** them. A dark colony is very bad for humans.

---

## 6. Endings

- **Overrun:** the hive takes the colony.
- **Extermination:** the humans wipe out the hive.
- **Evacuation:** some survivors escape.
- **Escape:** the Brood Mother flees into the deep tunnels.
- **Self-destruct:** last resort *(to be confirmed)*.

Every run produces a **run summary**: the ending, how long it lasted, casualties, captures, cures, and key moments (when the alarm sounded, when the generator went down, and so on).

---

## 7. Starting Numbers (tuning targets)

- Civilians: **40–60**
- Soldiers: **8–12**, in squads, each with a medic
- Hive: Brood Mother + ~6 Takers + ~2 Spinebacks *(to be tuned)*

All numbers live in one config file so balancing is just editing values.

---

## 8. Build Phases

Each phase ends with something runnable. Don't start the next phase until the current one works.

### Phase 0 — Setup
- [x] Vite + TypeScript project
- [x] Fixed-rate simulation tick, separate from rendering
- [x] Canvas renderer drawing a test grid
- [x] Seeded random number generator

### Phase 1 — The World
- [ ] Tile types (floor, wall, door, resin, vent, shaft)
- [ ] Hand-built maps for all 3 levels
- [ ] Level connections (elevator, ladders, chutes, vents)
- [ ] Camera: pan (drag / WASD) and zoom (scroll)
- [ ] Level switching + level activity sidebar

### Phase 2 — Movement
- [ ] Base agent (position, speed, level)
- [ ] A* pathfinding across levels
- [ ] Wandering agents
- [ ] Speed modifiers (Myrr faster on resin)

### Phase 3 — Humans v1
- [ ] Civilian routines (work / eat / sleep by room)
- [ ] Sight and hearing
- [ ] Flee, hide, panic

### Phase 4 — Hive v1
- [ ] Brood Mother in the hive core
- [ ] Takers: scout, hunt, capture, carry
- [ ] Trail pheromones
- [ ] Resin spread

### Phase 5 — The Lifecycle
- [ ] Sting + paralysis
- [ ] Injection, cocoons, incubation timer
- [ ] Broodlings hatch and grow by hive needs

### Phase 6 — Combat
- [ ] Health, weapons, skill (civilian vs. soldier), ammo
- [ ] Soldier squads, morale, retreat, rescues
- [ ] Medic: wake paralyzed, stabilize
- [ ] Spinebacks: guard, alarm response
- [ ] Danger pheromones, flanking, digging

### Phase 7 — Facility & Gear
- [ ] Armory, lockers, supply rooms with stock
- [ ] Barricades, welding, cutting doors open
- [ ] Sentry turrets + reloading
- [ ] Flamethrower, mining charges, motion sensors
- [ ] Generators, power, repairs
- [ ] Med bay cures

### Phase 8 — Commander & Endings
- [ ] Commander decisions (alarm, lockdown, teams, evacuation)
- [ ] Ending detection
- [ ] Run summary / event log

### Phase 9 — Tuning
- [ ] Speed controls (pause, 1x, 2x, 4x)
- [ ] Batch mode: run many seeds headless and report who won
- [ ] Utility-AI scoring for smarter decisions
- [ ] Balance passes

### Phase 10 — Player Interference
- [ ] Tools TBD (lock a door, cut power, send a squad, trigger an alarm, etc.)

---

## 9. Open Questions
- Self-destruct: in or out?
- Should the mine tunnels be partly randomized each run, or always hand-built?
- Which player-interference tools come first?
