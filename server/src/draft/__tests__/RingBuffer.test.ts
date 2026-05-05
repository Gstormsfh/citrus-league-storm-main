// Phase 4.5 chunk 11g.4 step 3 — RingBuffer unit tests.
//
// 5 tests covering: append below capacity, eviction at capacity,
// `getEventsSinceSeq` strict-after semantics with no eviction,
// empty-buffer ok-with-empty, and `too_old` after eviction.
//
// The eviction-aware semantic is the key invariant — see RingBuffer.ts
// for why fresh buffers (no eviction yet) always return ok rather than
// `too_old`, even when the client's `sinceSeq` is below the buffer's
// oldest item.

import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../RingBuffer';

interface SeqItem {
  seq: number;
  payload: string;
}

const item = (seq: number, payload = `p${seq}`): SeqItem => ({ seq, payload });

describe('RingBuffer (chunk 11g.4 step 3)', () => {
  it('appends items below capacity without eviction', () => {
    const buf = new RingBuffer<SeqItem>(5);
    buf.append(item(1));
    buf.append(item(2));
    buf.append(item(3));

    expect(buf.size()).toBe(3);
    expect(buf.capacity()).toBe(5);
    expect(buf.oldestSeq()).toBe(1);
    expect(buf.snapshot().map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it('evicts oldest when capacity exceeded; size stays at cap, oldestSeq advances', () => {
    const buf = new RingBuffer<SeqItem>(2);
    buf.append(item(10));
    buf.append(item(11));
    buf.append(item(12)); // evicts seq=10

    expect(buf.size()).toBe(2);
    expect(buf.capacity()).toBe(2);
    expect(buf.oldestSeq()).toBe(11);
    expect(buf.snapshot().map((i) => i.seq)).toEqual([11, 12]);
  });

  it('getEventsSinceSeq returns events strictly after sinceSeq when no eviction has occurred', () => {
    const buf = new RingBuffer<SeqItem>(10);
    buf.append(item(10));
    buf.append(item(11));
    buf.append(item(12));

    // Standard case: sinceSeq within the window, get the events strictly after.
    const since10 = buf.getEventsSinceSeq(10);
    expect(since10.ok).toBe(true);
    if (since10.ok) {
      expect(since10.events.map((e) => e.seq)).toEqual([11, 12]);
    }

    // sinceSeq below buffer's oldest — without eviction, the buffer
    // never lost anything, so return all events instead of too_old.
    const since0 = buf.getEventsSinceSeq(0);
    expect(since0.ok).toBe(true);
    if (since0.ok) {
      expect(since0.events.map((e) => e.seq)).toEqual([10, 11, 12]);
    }

    // sinceSeq at-or-after the newest event — empty events, still ok.
    const since12 = buf.getEventsSinceSeq(12);
    expect(since12.ok).toBe(true);
    if (since12.ok) {
      expect(since12.events).toHaveLength(0);
    }
  });

  it('getEventsSinceSeq returns ok with empty events for an empty buffer', () => {
    const buf = new RingBuffer<SeqItem>(5);

    expect(buf.getEventsSinceSeq(0)).toEqual({ ok: true, events: [] });
    expect(buf.getEventsSinceSeq(42)).toEqual({ ok: true, events: [] });
  });

  it('getEventsSinceSeq returns too_old after eviction when sinceSeq < oldestSeq', () => {
    const buf = new RingBuffer<SeqItem>(2);
    buf.append(item(10));
    buf.append(item(11));
    buf.append(item(12)); // evicts seq=10; oldest is now 11; hasEvicted=true

    // Client at sinceSeq=5 missed events the buffer evicted (would have
    // wanted seq=10 onwards). Falls back to DB resync.
    const stale = buf.getEventsSinceSeq(5);
    expect(stale).toEqual({
      ok: false,
      reason: 'too_old',
      oldestAvailableSeq: 11,
    });

    // Client at sinceSeq=11 (caught up to current oldest) is fine —
    // buffer still holds everything strictly after 11.
    const fresh = buf.getEventsSinceSeq(11);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.events.map((e) => e.seq)).toEqual([12]);
    }
  });
});
