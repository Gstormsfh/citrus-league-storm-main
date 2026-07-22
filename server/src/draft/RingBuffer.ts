// Phase 4.5 chunk 11g.4 step 3 — generic ring buffer for the
// LobbyManager's recent-events store.
//
// Eviction-aware semantics: when the buffer has been at capacity
// and evicted older items, `getEventsSinceSeq` returns `too_old`
// for clients whose `sinceSeq` references events the buffer no
// longer holds. When the buffer has never evicted, all queries
// return `ok` (the buffer has the full history from its first
// item onwards), so fresh lobbies don't force unnecessary DB
// resyncs on routine reconnects.
//
// Used by `LobbyManager` to back the resync protocol's
// `last_seen_seq` cursor (chunk 11g.5).

/**
 * Generic discriminated-union return type of
 * `RingBuffer.getEventsSinceSeq`. Specialized in
 * `server/src/draft/types.ts` as `GetEventsSinceSeqResult` for the
 * concrete `BufferedDraftEvent` case used by `LobbyManager`.
 *
 * `oldestAvailableSeq` on the `too_old` branch is the seq of the
 * oldest item still buffered — useful for client-side telemetry
 * (how big the gap was) but not load-bearing for the resync
 * protocol (the client just falls back to a full snapshot).
 */
export type GetSinceSeqResult<T> =
  | { ok: true; events: ReadonlyArray<T> }
  | { ok: false; reason: 'too_old'; oldestAvailableSeq: number };

/**
 * Bounded FIFO buffer of items keyed on a monotonic `seq`.
 *
 * Items are appended in seq-order; once size exceeds `capacity`,
 * the oldest item is evicted. Once any eviction occurs, the buffer
 * sets `hasEvicted` permanently so `getEventsSinceSeq` can
 * distinguish "client missed events the buffer no longer holds"
 * from "buffer is fresh and has everything since startup."
 *
 * The eviction-aware semantic — rather than "any sinceSeq <
 * oldestSeq returns too_old" — avoids forcing fresh lobbies to
 * fall back to DB resync on routine resume, while still correctly
 * reporting too_old once the buffer has lost events.
 */
export class RingBuffer<T extends { seq: number }> {
  private readonly items: T[] = [];
  private readonly cap: number;
  private hasEvicted = false;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `RingBuffer capacity must be a positive integer (got ${capacity})`,
      );
    }
    this.cap = capacity;
  }

  /**
   * Append an item. If the buffer is at capacity, the oldest item
   * is evicted to make room and the `hasEvicted` flag is set
   * permanently to true for the lifetime of this buffer.
   */
  append(item: T): void {
    if (this.items.length >= this.cap) {
      this.items.shift();
      this.hasEvicted = true;
    }
    this.items.push(item);
  }

  /**
   * Return the events strictly after `sinceSeq`, or a `too_old`
   * signal if the buffer has evicted events the client wanted.
   *
   * - Empty buffer: `{ ok: true, events: [] }` — there's nothing
   *   to send; the client is up to date.
   * - No eviction yet: `{ ok: true, events: <items.filter(e => e.seq > sinceSeq)> }`
   *   even when `sinceSeq` is below the buffer's oldest. The buffer
   *   never lost anything, so a sinceSeq before its first item just
   *   means the client should accept everything we have.
   * - Eviction occurred AND `sinceSeq < oldest`:
   *   `{ ok: false, reason: 'too_old', oldestAvailableSeq }`.
   */
  getEventsSinceSeq(sinceSeq: number): GetSinceSeqResult<T> {
    if (this.items.length === 0) {
      return { ok: true, events: [] };
    }
    const oldestSeq = this.items[0].seq;
    if (this.hasEvicted && sinceSeq < oldestSeq) {
      return { ok: false, reason: 'too_old', oldestAvailableSeq: oldestSeq };
    }
    return { ok: true, events: this.items.filter((e) => e.seq > sinceSeq) };
  }

  /**
   * Snapshot of the current contents in append order. Returns a
   * shallow copy so callers can't mutate internal state.
   */
  snapshot(): ReadonlyArray<T> {
    return [...this.items];
  }

  /** Number of items currently held. */
  size(): number {
    return this.items.length;
  }

  /** Maximum number of items this buffer will hold. */
  capacity(): number {
    return this.cap;
  }

  /**
   * Seq of the oldest item currently held, or `undefined` if the
   * buffer is empty.
   */
  oldestSeq(): number | undefined {
    return this.items[0]?.seq;
  }

  /**
   * The most recently appended item, or `undefined` if the buffer is
   * empty. Chunk 11g.10 sub-step 10c-1a uses this from the live
   * external-event apply path to determine whether an applier
   * appended a client-visible event — if `peekLast().seq === event.seq`
   * after `applyEventDuringBootstrap(event)`, the apply produced a
   * buffered event and the LobbyManager broadcasts it. Read-only
   * tail access; does not mutate buffer contents.
   */
  peekLast(): T | undefined {
    return this.items[this.items.length - 1];
  }
}
