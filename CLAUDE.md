# CLAUDE.md — The Dark Seam

## What this project is
The Dark Seam is a top-down 2D simulation of an alien hive (the Myrr) waking up beneath a three-level mining colony. The graphics are deliberately simple (colored shapes and tiles). The real work is the AI for the Myrr and the humans, so that every run ends differently.

**PLAN.md is the source of truth** for the design and the build phases. Read it before starting work, and keep it updated when decisions change.

## Tech stack
- TypeScript + Vite
- HTML Canvas 2D for rendering (PixiJS only if Canvas becomes too slow)
- No game engine and no UI framework
- Developer is on **Windows** using VS Code. Give commands that work in PowerShell.

## Commands
- `npm install` — install dependencies
- `npm run dev` — start the dev server
- `npm run build` — production build

## How we work
- **Build one phase at a time**, in the order in PLAN.md. Don't jump ahead or add features from later phases.
- Each phase should end in a runnable state. Check off the PLAN.md boxes when a step works.
- Before a big change, explain the approach briefly and confirm it.
- Explain new concepts (state machines, A*, pheromone maps, etc.) in plain language when they first come up. The developer is learning as we go.
- Keep commits small and focused, with clear messages.
- **Keep the build log updated.** After every step, update the "The Dark Seam — Build Log" doc: https://claude.ai/artifact/PQkf1jWYCKp5Rygs1E2e7v (a Claude Doc, edited through the Claude Docs connector). Add a Log row (date · phase · what was done · commit), refresh "Where we are", and record new concepts and decisions. This log becomes the final README / explainer page.

## Architecture rules
- **Simulation and rendering are separate.** The sim runs on a fixed tick and never touches the canvas. The renderer only reads sim state. This lets the sim run headless for batch testing.
- **All randomness goes through the seeded RNG.** Never call `Math.random()` in sim code. The same seed must produce the same run.
- **All tuning numbers live in `src/config.ts`** (unit counts, speeds, health, timers, ammo, etc.). No magic numbers in logic.
- Agent behavior uses **state machines** first; utility-AI scoring comes in Phase 9.
- Keep files small and focused, one system per file.

## Folder layout
```
src/
  main.ts          entry point, wires everything together
  config.ts        all tuning values
  core/            game loop, seeded RNG, event log
  world/           tiles, levels, maps, level links, pathfinding
  agents/          base agent, humans, Myrr units, state machines
  systems/         pheromones, resin, combat, medical, power, gear, commander
  render/          camera, renderer, sidebar/UI
  data/maps/       hand-built level layouts
```

## Names and terms
- **Myrr** — the alien species
- **Brood Mother** — the queen
- **Takers** — workers/drones (capture and carry humans)
- **Spinebacks** — warriors
- **Broodlings** — larvae
- **Carrow Deep** — the colony
- **Levels:** 1 Surface Colony, 2 Upper Mine ("the Fighting Grounds"), 3 Deep Mine (hive)

## Design guardrails
- The Myrr are an original species. Don't copy names, designs, or terms from any existing franchise.
- Avoid easy choke-point wins for humans: multiple routes between levels, mazelike Level 2, alien-only vents, danger-pheromone avoidance, and digging.
- Neither side should win every time. Balance is tested with batch runs (Phase 9).
