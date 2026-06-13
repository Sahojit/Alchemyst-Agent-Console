import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequenceBuffer, type GapInfo } from "../sequence-buffer";
import type { ServerMessage, TokenMessage } from "../types";

function token(seq: number, text = `t${seq}`): TokenMessage {
  return { type: "TOKEN", seq, text, stream_id: "s1" };
}

function makeBuffer(overrides: { gapTimeoutMs?: number; initialSeq?: number } = {}) {
  const emitted: ServerMessage[] = [];
  const gaps: GapInfo[] = [];
  const buffer = new SequenceBuffer({
    onMessage: (msg) => emitted.push(msg),
    onGap: (gap) => gaps.push(gap),
    gapTimeoutMs: overrides.gapTimeoutMs ?? 10_000,
    ...(overrides.initialSeq !== undefined
      ? { initialSeq: overrides.initialSeq }
      : {}),
  });
  return { buffer, emitted, gaps };
}

function emittedSeqs(emitted: ServerMessage[]): number[] {
  return emitted.map((m) => m.seq);
}

describe("SequenceBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("empty buffer: emits nothing and reports baseline stats", () => {
    const { buffer, emitted } = makeBuffer();
    expect(emitted).toEqual([]);
    expect(buffer.highestProcessedSeq).toBe(0);
    expect(buffer.highestReceivedSeq).toBe(0);
    expect(buffer.stats.pendingCount).toBe(0);
  });

  it("single element at the initial seq is emitted immediately", () => {
    const { buffer, emitted } = makeBuffer();
    buffer.ingest(token(1));
    expect(emittedSeqs(emitted)).toEqual([1]);
    expect(buffer.highestProcessedSeq).toBe(1);
    expect(buffer.highestReceivedSeq).toBe(1);
  });

  it("in-order stream is emitted in order with no buffering", () => {
    const { buffer, emitted } = makeBuffer();
    for (let seq = 1; seq <= 5; seq++) buffer.ingest(token(seq));
    expect(emittedSeqs(emitted)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.stats.pendingCount).toBe(0);
  });

  it("duplicates are dropped, both buffered and already-processed", () => {
    const { buffer, emitted } = makeBuffer();
    buffer.ingest(token(1));
    buffer.ingest(token(1)); // already processed
    buffer.ingest(token(3)); // buffered (gap at 2)
    buffer.ingest(token(3)); // duplicate of buffered
    buffer.ingest(token(2)); // fills the gap
    buffer.ingest(token(2)); // already processed
    expect(emittedSeqs(emitted)).toEqual([1, 2, 3]);
    expect(buffer.stats.duplicateCount).toBe(3);
  });

  it("fully reversed sequence is reordered and emitted contiguously", () => {
    const { buffer, emitted } = makeBuffer();
    for (const seq of [5, 4, 3, 2]) {
      buffer.ingest(token(seq));
      expect(emitted).toEqual([]); // nothing until seq 1 arrives
    }
    buffer.ingest(token(1));
    expect(emittedSeqs(emitted)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.highestProcessedSeq).toBe(5);
  });

  it("gap-then-fill: emits up to the gap, then the rest once filled", () => {
    const { buffer, emitted } = makeBuffer();
    buffer.ingest(token(1));
    buffer.ingest(token(2));
    buffer.ingest(token(4));
    buffer.ingest(token(5));
    expect(emittedSeqs(emitted)).toEqual([1, 2]);
    expect(buffer.highestProcessedSeq).toBe(2);
    expect(buffer.highestReceivedSeq).toBe(5);

    buffer.ingest(token(3));
    expect(emittedSeqs(emitted)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.highestProcessedSeq).toBe(5);
  });

  it("abandons a gap after gapTimeoutMs and resumes from the next seq", () => {
    const { buffer, emitted, gaps } = makeBuffer({ gapTimeoutMs: 3000 });
    buffer.ingest(token(1));
    buffer.ingest(token(4));
    buffer.ingest(token(5));
    expect(emittedSeqs(emitted)).toEqual([1]);

    vi.advanceTimersByTime(2999);
    expect(emittedSeqs(emitted)).toEqual([1]);

    vi.advanceTimersByTime(1);
    expect(gaps).toEqual([{ from: 2, to: 3 }]);
    expect(emittedSeqs(emitted)).toEqual([1, 4, 5]);
    expect(buffer.highestProcessedSeq).toBe(5);
    expect(buffer.stats.skippedCount).toBe(2);
  });

  it("late arrival into an abandoned gap is treated as a duplicate", () => {
    const { buffer, emitted } = makeBuffer({ gapTimeoutMs: 3000 });
    buffer.ingest(token(1));
    buffer.ingest(token(3));
    vi.advanceTimersByTime(3000); // abandons seq 2
    buffer.ingest(token(2)); // straggler after abandonment
    expect(emittedSeqs(emitted)).toEqual([1, 3]);
    expect(buffer.stats.duplicateCount).toBe(1);
  });

  it("gap timer restarts when partial progress is made", () => {
    const { buffer, emitted, gaps } = makeBuffer({ gapTimeoutMs: 3000 });
    buffer.ingest(token(2)); // gap at 1
    vi.advanceTimersByTime(2000);
    buffer.ingest(token(1)); // fills first gap → 1,2 emitted
    buffer.ingest(token(4)); // new gap at 3
    vi.advanceTimersByTime(2000); // old timer would have fired by now
    expect(gaps).toEqual([]);
    vi.advanceTimersByTime(1000); // full 3s for the NEW gap
    expect(gaps).toEqual([{ from: 3, to: 3 }]);
    expect(emittedSeqs(emitted)).toEqual([1, 2, 4]);
  });

  it("respects a custom initialSeq (post-RESUME construction)", () => {
    const { buffer, emitted } = makeBuffer({ initialSeq: 42 });
    buffer.ingest(token(41)); // replayed duplicate from before the resume point
    buffer.ingest(token(42));
    expect(emittedSeqs(emitted)).toEqual([42]);
    expect(buffer.highestProcessedSeq).toBe(42);
  });

  it("ignores non-integer and negative seqs without crashing", () => {
    const { buffer, emitted } = makeBuffer();
    buffer.ingest(token(Number.NaN));
    buffer.ingest(token(-3));
    buffer.ingest(token(1.5));
    buffer.ingest(token(1));
    expect(emittedSeqs(emitted)).toEqual([1]);
  });

  it("handles a large interleaved chaos burst (random order + duplicates)", () => {
    const { buffer, emitted } = makeBuffer();
    const seqs: number[] = [];
    for (let seq = 1; seq <= 500; seq++) seqs.push(seq, seq); // duplicate all
    // Deterministic shuffle
    let state = 1234567;
    for (let i = seqs.length - 1; i > 0; i--) {
      state = (state * 48271) % 2147483647;
      const j = state % (i + 1);
      const a = seqs[i];
      const b = seqs[j];
      if (a !== undefined && b !== undefined) {
        seqs[i] = b;
        seqs[j] = a;
      }
    }
    for (const seq of seqs) buffer.ingest(token(seq));
    expect(emittedSeqs(emitted)).toEqual(
      Array.from({ length: 500 }, (_, i) => i + 1),
    );
    expect(buffer.stats.duplicateCount).toBe(500);
  });
});
