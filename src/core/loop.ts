// Fixed-timestep game loop.
//
// The sim always advances in equal steps (e.g. 1/20th of a second),
// no matter how fast the screen redraws. Each frame we add the real time
// that passed to an "accumulator", run as many whole ticks as fit, then
// draw once. Leftover time carries over to the next frame.

export interface LoopCallbacks {
  /** Advance the simulation one tick. */
  update: () => void
  /** Draw the current state. */
  render: () => void
}

export function startLoop(
  ticksPerSecond: number,
  maxTicksPerFrame: number,
  callbacks: LoopCallbacks,
): void {
  const msPerTick = 1000 / ticksPerSecond
  let lastTime = performance.now()
  let accumulator = 0

  function frame(now: number): void {
    accumulator += now - lastTime
    lastTime = now

    let ticks = 0
    while (accumulator >= msPerTick && ticks < maxTicksPerFrame) {
      callbacks.update()
      accumulator -= msPerTick
      ticks++
    }
    // If we fell far behind (e.g. tab was hidden), drop the backlog
    // instead of trying to catch up all at once.
    if (ticks === maxTicksPerFrame) accumulator = 0

    callbacks.render()
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
