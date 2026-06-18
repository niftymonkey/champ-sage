/**
 * A three-tier FIFO discovery queue for the snowball collector.
 *
 * The snowball walks players to find recent matches in a mode (ARAM, Arena).
 * Not all candidates are equally likely to have played that mode recently, so
 * they drain in priority order:
 *
 *   1. frontier - priority seeds (e.g. the user's own account) and every player
 *      just discovered inside the freshness window. These are proven or likely
 *      mode-players, so chasing them first lets the cascade lock onto the
 *      mode-playing population immediately.
 *   2. seed - high-elo fallback seeds. Reliable accounts, but mostly ranked
 *      players who rarely touch ARAM/Arena, so they serve as entry points used
 *      to discover new frontier players, not as the main source.
 *   3. stale - the prior-run discovered pool. A backstop drained last.
 *
 * Each tier is FIFO; the queue always returns frontier before seed before
 * stale. In-memory only: no I/O. The collector owns persistence of the
 * cross-run discovered pool and re-seeds this queue on each run.
 */
export class DiscoveryQueue {
  private readonly frontier: string[] = [];
  private readonly seed: string[] = [];
  private readonly stale: string[] = [];

  // Every id ever admitted, retained after dequeue so re-enqueues stay deduped.
  private readonly known = new Set<string>();

  /**
   * Admit an id to a tier, unless it is already known to any tier. v1
   * simplification: no promotion. An id already sitting in a lower tier that is
   * enqueued to a higher one stays put; the cascade still reaches it.
   */
  private admit(id: string, tier: string[]): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    tier.push(id);
  }

  enqueueFrontier(id: string): void {
    this.admit(id, this.frontier);
  }

  enqueueSeed(id: string): void {
    this.admit(id, this.seed);
  }

  enqueueStale(id: string): void {
    this.admit(id, this.stale);
  }

  /** Next id: frontier before seed before stale, FIFO within a tier. */
  next(): string | undefined {
    if (this.frontier.length > 0) return this.frontier.shift();
    if (this.seed.length > 0) return this.seed.shift();
    if (this.stale.length > 0) return this.stale.shift();
    return undefined;
  }

  has(id: string): boolean {
    return this.known.has(id);
  }

  /**
   * Iterate the ids still waiting, frontier first then seed then stale, FIFO
   * within each. A snapshot view: do not enqueue or dequeue while iterating.
   */
  *pending(): IterableIterator<string> {
    yield* this.frontier;
    yield* this.seed;
    yield* this.stale;
  }

  get size(): number {
    return this.frontier.length + this.seed.length + this.stale.length;
  }

  get frontierSize(): number {
    return this.frontier.length;
  }

  get seedSize(): number {
    return this.seed.length;
  }

  get staleSize(): number {
    return this.stale.length;
  }
}
