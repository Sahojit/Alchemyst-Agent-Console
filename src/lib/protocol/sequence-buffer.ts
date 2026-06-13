import { MinHeap } from "./min-heap";
import type { ServerMessage } from "./types";

export interface GapInfo {
  /** First missing seq (inclusive). */
  from: number;
  /** Last missing seq (inclusive). */
  to: number;
}

export interface SequenceBufferStats {
  highestProcessedSeq: number;
  highestReceivedSeq: number;
  pendingCount: number;
  duplicateCount: number;
  skippedCount: number;
}

type TimerHandle = unknown;

export interface SequenceBufferOptions {
  /** Receives messages strictly in seq order. */
  onMessage: (msg: ServerMessage) => void;
  /** Called when a gap is abandoned after gapTimeoutMs (chaos-mode loss). */
  onGap?: (gap: GapInfo) => void;
  /** First seq the server will send. Defaults to 1. */
  initialSeq?: number;
  /**
   * How long a missing seq may block delivery before we skip past it.
   * Chaos-mode latency spikes are 2-8s, so the default (10s) only fires for
   * genuinely lost messages, not late ones.
   */
  gapTimeoutMs?: number;
  /** Timer injection for tests; defaults to setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

/**
 * Reorders, deduplicates, and gap-tolerantly delivers server messages.
 *
 * Strategy: buffered messages live in a Map keyed by seq (O(1) dedup) with a
 * min-heap over seqs (O(1) access to the lowest buffered seq). Delivery is
 * contiguous: a message is emitted only when every seq before it has been
 * emitted or explicitly abandoned. If a gap blocks delivery for longer than
 * `gapTimeoutMs`, we abandon the missing seqs (reporting them via `onGap`)
 * and resume from the lowest buffered seq — chaos mode may genuinely never
 * deliver a seq, and stalling forever is worse than a documented skip.
 *
 * `highestProcessedSeq` (what the UI has consumed, including abandoned seqs —
 * see DECISIONS.md on why skips advance it) is tracked separately from
 * `highestReceivedSeq` (what the socket has seen). RESUME uses the former.
 */
export class SequenceBuffer {
  private readonly pending = new Map<number, ServerMessage>();
  private readonly heap = new MinHeap();
  private readonly onMessage: (msg: ServerMessage) => void;
  private readonly onGap: ((gap: GapInfo) => void) | undefined;
  private readonly gapTimeoutMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  private nextExpectedSeq: number;
  private _highestProcessedSeq: number;
  private _highestReceivedSeq = 0;
  private _duplicateCount = 0;
  private _skippedCount = 0;

  private gapTimer: TimerHandle | null = null;
  /** The seq the running gap timer is waiting on; stale timers are ignored. */
  private gapTimerWaitingOn: number | null = null;

  constructor(options: SequenceBufferOptions) {
    this.onMessage = options.onMessage;
    this.onGap = options.onGap;
    this.gapTimeoutMs = options.gapTimeoutMs ?? 10_000;
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as TimerHandle);
    this.clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.nextExpectedSeq = options.initialSeq ?? 1;
    this._highestProcessedSeq = this.nextExpectedSeq - 1;
  }

  /** Highest seq delivered to (or abandoned on behalf of) the consumer. */
  get highestProcessedSeq(): number {
    return this._highestProcessedSeq;
  }

  /** Highest seq ever seen on the socket, regardless of order. */
  get highestReceivedSeq(): number {
    return this._highestReceivedSeq;
  }

  get stats(): SequenceBufferStats {
    return {
      highestProcessedSeq: this._highestProcessedSeq,
      highestReceivedSeq: this._highestReceivedSeq,
      pendingCount: this.pending.size,
      duplicateCount: this._duplicateCount,
      skippedCount: this._skippedCount,
    };
  }

  ingest(msg: ServerMessage): void {
    const seq = msg.seq;
    if (!Number.isInteger(seq) || seq < 0) return;

    if (seq > this._highestReceivedSeq) this._highestReceivedSeq = seq;

    // Dedup: already delivered/abandoned, or already buffered.
    if (seq < this.nextExpectedSeq || this.pending.has(seq)) {
      this._duplicateCount += 1;
      return;
    }

    this.pending.set(seq, msg);
    this.heap.push(seq);
    this.drain();
  }

  /** Cancels any pending gap timer. Call when tearing the session down. */
  dispose(): void {
    this.cancelGapTimer();
  }

  private drain(): void {
    let msg = this.pending.get(this.nextExpectedSeq);
    while (msg !== undefined) {
      this.pending.delete(this.nextExpectedSeq);
      this._highestProcessedSeq = this.nextExpectedSeq;
      this.nextExpectedSeq += 1;
      // State is updated before emitting so reentrant reads (e.g. a handler
      // asking for highestProcessedSeq) are consistent.
      this.onMessage(msg);
      msg = this.pending.get(this.nextExpectedSeq);
    }

    // Drop heap entries for seqs already delivered.
    let top = this.heap.peek();
    while (top !== undefined && top < this.nextExpectedSeq) {
      this.heap.pop();
      top = this.heap.peek();
    }

    this.syncGapTimer();
  }

  private syncGapTimer(): void {
    if (this.pending.size === 0) {
      this.cancelGapTimer();
      return;
    }
    // A gap is blocking delivery. Keep an existing timer only if it is
    // waiting on the same seq; progress restarts the clock.
    if (this.gapTimer !== null && this.gapTimerWaitingOn === this.nextExpectedSeq)
      return;

    this.cancelGapTimer();
    this.gapTimerWaitingOn = this.nextExpectedSeq;
    this.gapTimer = this.setTimer(() => this.abandonGap(), this.gapTimeoutMs);
  }

  private cancelGapTimer(): void {
    if (this.gapTimer !== null) {
      this.clearTimer(this.gapTimer);
      this.gapTimer = null;
      this.gapTimerWaitingOn = null;
    }
  }

  private abandonGap(): void {
    this.gapTimer = null;
    this.gapTimerWaitingOn = null;
    const lowestBuffered = this.heap.peek();
    if (lowestBuffered === undefined || lowestBuffered <= this.nextExpectedSeq) {
      // Nothing buffered, or no actual gap (drain will handle it).
      this.drain();
      return;
    }

    this._skippedCount += lowestBuffered - this.nextExpectedSeq;
    this.onGap?.({ from: this.nextExpectedSeq, to: lowestBuffered - 1 });
    // Abandoned seqs count as processed: we will never deliver them, and
    // RESUME must not ask the server to replay into an already-advanced UI.
    this.nextExpectedSeq = lowestBuffered;
    this._highestProcessedSeq = lowestBuffered - 1;
    this.drain();
  }
}
