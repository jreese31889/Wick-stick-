/**
 * Minimal free-list object pool (M14 Android optimization).
 *
 * High-frequency game objects (dust, sparks, blood, glass, coins) are created
 * and discarded several times a second. On mid-range Android that allocation
 * churn shows up as garbage-collector pauses in the middle of a combo, so the
 * hot paths instead recycle shells: acquire() pops a previously released
 * object (or falls back to the factory once), release() hands it back instead
 * of dropping it on the floor for the GC.
 *
 * Pools are bounded by maxFree so a one-off particle storm can never grow the
 * retained footprint past a known size.
 */
export class ObjectPool<T> {
  /** P6-02: cumulative acquires that recycled (hits) vs allocated (misses). */
  public static hits = 0;
  public static misses = 0;

  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly maxFree: number;

  constructor(factory: () => T, maxFree: number = 256) {
    this.factory = factory;
    this.maxFree = Math.max(0, maxFree);
  }

  /** Returns a recycled shell, allocating a fresh one only when empty. */
  public acquire(): T {
    const recycled = this.free.pop();
    if (recycled === undefined) {
      ObjectPool.misses++;
      return this.factory();
    }
    ObjectPool.hits++;
    return recycled;
  }

  /** Returns a shell for reuse. Silently drops it when the pool is full. */
  public release(item: T): void {
    if (this.free.length < this.maxFree) this.free.push(item);
  }

  /** Releases every element of an array (typically a splice result). */
  public releaseAll(items: T[]): void {
    for (let i = 0; i < items.length; i++) this.release(items[i]);
    items.length = 0;
  }
}
