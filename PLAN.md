# The Dark Seam — Design & Build Plan

A top-down 2D simulation of an alien hive waking up beneath a mining colony. The focus is the AI: every run should play out differently. Graphics start simple (colored shapes and tiles), with pan and zoom; a pixel-art pass comes later (Phase 10).

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

### Level size
- All three levels use the **same grid size: 160 × 100 tiles** (`world.levelWidth` / `world.levelHeight` in `config.ts`). No level is noticeably bigger than the others.
- Level 3 (Deep Mine) fills the whole grid. It was the smallest in the first draft and grows to match.

### Map shapes
The map is a square tile grid underneath, but rooms are **not** all rectangles: angled corners, octagonal or rounded rooms, L-shapes, alcoves and irregular outlines wherever they fit.

- **Level 1 — Surface Colony:** mostly **open outdoor terrain**, with the colony compound taking up only part of the map.
  - The compound is **modular, hub-and-spoke**: separate wings/modules (quarters, mess hall, command, med bay, armory, generator, supply) joined by narrow corridors and junction hubs, with angled and octagonal rooms. Think blueprint of a space station or research outpost, **not** one big square building.
  - Outdoor terrain: open ground with scattered rocks and boulders, plus one or two small caves.
- **Level 2 — Upper Mine ("the Fighting Grounds"):** organic and irregular. Winding tunnels, uneven caverns, dead ends, side pockets, varying tunnel widths. Man-made rooms (equipment bays, supply rooms, locker rooms) also get unique, non-square shapes. Stays mazelike with multiple routes, so there are no choke points.
- **Level 3 — Deep Mine:** organic caverns and old tunnels filling the full grid, with the hive core deep inside.

### Surface entry rules (Level 1)
- **No vents open inside human buildings.** Vent shafts from the mine surface **outside**, in the open terrain (and inside the surface caves).
- To get into a building, the Myrr must use:
  - **Doors:** normal, barricaded, or welded. Breaking through takes time (see Gear).
  - **Windows** (new tile type): Myrr can smash through, slower than an open door and faster than a wall. Humans can **board up** windows like a barricade.
  - **Chewing through walls:** very slow, done by Takers. Humans can notice it (noise / event log) and respond.
- On **Levels 2 and 3**, vents still link areas directly as alien-only routes.

### Avoiding the choke-point problem
- **Many routes up:** elevator, side tunnels, ore chutes, and vent shafts reach different areas. No single door holds everything.
- **Many ways into the surface buildings:** vents surface outside, so the Myrr cross open ground and then pick an entry: doors, windows, or chewing through a wall. Every building has several possible breach points.
- **Mazelike, irregular tunnels** on Level 2 so there's always a flank.
- **Vents (Levels 2–3):** hidden links between areas that only the Myrr can path through. No separate map layer.
- **The hive learns:** Myrr that die leave a *danger pheromone*. Others avoid that route and look for another way.
- **Digging:** Takers can slowly tunnel a new connection near a fortified spot. Humans can notice and respond.

### Map format
Levels are hand-built as text files in `src/data/maps/` (one per level), one character per tile, easy to edit by hand.

| Char | Meaning | Char | Meaning |
|---|---|---|---|
| `#` | Rock / cave wall | `L` | Ladder |
| `X` | Building wall | `C` | Ore chute |
| `.` | Floor (indoor or tunnel) | `V` | Vent |
| `,` | Outdoor ground | `A` | Armory |
| `o` | Boulder | `M` | Med bay |
| `D` | Door | `G` | Generator |
| `W` | Window | `S` | Supply room / locker |
| `E` | Elevator | `H` | Hive core |
| `:` | Open doorway (room edge, no door) | `K` | Command |
| | | `Q` | Quarters |
| | | `F` | Mess hall |
| | | `T` | Workshop |
| | | `P` | Security |
| | | `R` | Any other room or named area |

Resin, barricades, boarded windows and welds are **not** map characters: they change during a run and live in the sim state.

**Rules**
- **Link pairing:** a link tile (`E`, `L`, `C`, `V`) connects to the same tile at the same position on the level directly above or below. Shafts stack, so one elevator tile on Level 2 goes both up and down. An `E`/`L`/`C` with no partner is a map error.
- **Vents:** a paired `V` is a shaft between levels. An unpaired `V` is a duct inside the level (Levels 2–3 only). On Level 1 every `V` must be outdoors; the loader rejects one inside a building.
- **Rooms:** one room letter goes somewhere inside each room; the rest of its floor is `.`. The room is everything reachable from the letter without crossing a wall, door, window, doorway or open ground. Names come from a per-letter list in the map file, in reading order; unnamed rooms get "Generator 2" style names.
- **Outdoor areas** (landing pad, yards) are rooms of paved floor surrounded by open ground.
- Chute tops on the surface sit outdoors (ore yard), so chutes are not a way into buildings. The elevator and ladders land inside the Mine Head.
- **Boulders:** `o` on the map are fixed. Extra seeded boulders per run come with Run variety.

### Run variety
Maps stay hand-built. Each run varies through the **seeded RNG**:
- Human starting positions
- Supply / locker contents
- Which tunnels start collapsed
- Boulder placement on the surface
- Hive starting spot within the Deep Mine
- AI decisions

*Future idea:* fully random maps, using cellular-automata caves for the mine levels only.

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
| **Barricades** | Built in doorways/hallways, have health. Myrr claw through them eventually. Civilians can build them. Also used to **board up windows**. |
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
*Redone after the map redesign: all three levels at 160 × 100 in the new format.*
- [x] Tile types: rock wall, building wall, floor, outdoor ground, boulder, door, window, resin, vent, shaft / ladder / elevator / chute
- [x] Hand-built maps for all 3 levels at 160 × 100, using the new map format and shapes
- [x] Level connections (elevator, ladders, chutes, vents) under the new pairing rule
- [x] Camera: pan (drag / WASD) and zoom (scroll)
- [x] Level switching + level activity sidebar

### Phase 2 — Movement
- [x] Base agent (position, speed, level)
- [x] A* pathfinding across levels
- [x] Wandering agents
- [x] Speed modifiers (Myrr faster on resin)

### Phase 3 — Humans v1
- [x] Civilian routines (work / eat / sleep by room)
- [x] Sight and hearing
- [x] Flee, hide, panic

### Phase 4 — Hive v1
- [x] Brood Mother in the hive core
- [x] Takers: scout, hunt, capture, carry
- [x] Trail pheromones
- [x] Resin spread

### Phase 5 — The Lifecycle
- [x] Sting + paralysis
- [x] Injection, cocoons, incubation timer
- [x] Broodlings hatch and grow by hive needs

### Phase 6 — Combat
- [x] Health, weapons, skill (civilian vs. soldier), ammo
- [x] Soldier squads, morale, retreat, rescues
- [x] Medic: wake paralyzed, stabilize
- [x] Spinebacks: guard, alarm response
- [x] Danger pheromones, flanking, digging

### Phase 7 — Facility & Gear
- [ ] Armory, lockers, supply rooms with stock
- [ ] Barricades, welding, cutting doors open
- [ ] Boarding up windows; Myrr smashing through windows
- [ ] Takers chewing through walls, with noise humans can detect
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

### Phase 10 — Art Pass
Move from colored shapes to a Dwarf Fortress (Steam version) style.
- [ ] Pixel-art sprites from a sprite sheet (16×16 or 32×32)
- [ ] Autotiling: walls and edges connect based on their neighbours
- [ ] Small unit sprites
- [ ] Assets live in `assets/`. A placeholder tileset exists (`tileset.png`, `brood_mother.png`, `make_tiles.py`) and moves there for this phase.

### Phase 11 — Player Interference
- [ ] Tools TBD (lock a door, cut power, send a squad, trigger an alarm, etc.)

---

## 9. Open Questions
- Self-destruct: in or out?
- Which player-interference tools come first?
- Map format details: link pairing and room letters (see *Map format*).

*Closed:* mine tunnels stay hand-built; variety comes from the seeded RNG (see *Run variety*).
