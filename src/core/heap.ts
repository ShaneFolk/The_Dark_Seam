// Min-heap of numbers keyed by a priority. Pops the lowest priority first.
// Used by A* to always expand the most promising tile next.

export class MinHeap {
  private items: number[] = []
  private priorities: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, priority: number): void {
    const { items, priorities } = this
    items.push(item)
    priorities.push(priority)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (priorities[parent] <= priorities[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const { items, priorities } = this
    const top = items[0]
    const lastItem = items.pop()!
    const lastPriority = priorities.pop()!
    if (items.length) {
      items[0] = lastItem
      priorities[0] = lastPriority
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let smallest = i
        if (l < items.length && priorities[l] < priorities[smallest]) smallest = l
        if (r < items.length && priorities[r] < priorities[smallest]) smallest = r
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  clear(): void {
    this.items.length = 0
    this.priorities.length = 0
  }

  private swap(a: number, b: number): void {
    const { items, priorities } = this
    ;[items[a], items[b]] = [items[b], items[a]]
    ;[priorities[a], priorities[b]] = [priorities[b], priorities[a]]
  }
}
