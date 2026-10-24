// Fixed-timestep game loop.
//
// The sim always advances in equal steps (e.g. 1/20th of a second),
// no matter how fast the screen redraws. Each frame we add the real time
// that passed to an "accumulator", run as many whole ticks as fit, then
// draw once. Leftover time carries over to the next frame.

export interface LoopCallbacks {
  /** Advance the simulation one tick. */
  update: () => void
  /** Draw the current state. Gets the real time since the last frame. */
  render: (frameMs: number) => void
  /** How fast the sim runs: 1 = normal, 2 = twice as fast, 0 = paused. */
  speed: () => number
}

export function startLoop(
  ticksPerSecond: number,
  maxTicksPerFrame: number,
  callbacks: LoopCallbacks,
): void {
  let lastTime = performance.now()
  let accumulator = 0

  function frame(now: number): void {
    const frameMs = now - lastTime
    accumulator += frameMs
    lastTime = now

    // Faster speeds just run more ticks per real second; paused runs none.
    const speed = callbacks.speed()
    const msPerTick = 1000 / (ticksPerSecond * Math.max(speed, 1e-9))
    const maxTicks = Math.ceil(maxTicksPerFrame * Math.max(speed, 1))
    if (speed <= 0) accumulator = 0

    let ticks = 0
    while (accumulator >= msPerTick && ticks < maxTicks) {
      callbacks.update()
      accumulator -= msPerTick
      ticks++
    }
    // If we fell far behind (e.g. tab was hidden), drop the backlog
    // instead of trying to catch up all at once.
    if (ticks === maxTicks) accumulator = 0

    callbacks.render(frameMs)
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
