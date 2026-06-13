import {
  decodeFrame,
  encodeClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "./types";

/**
 * Minimal structural interface over the native WebSocket so tests can inject
 * a fake without a DOM environment.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

const WS_OPEN = 1;

export type ConnectionManagerEvent =
  | { type: "connecting"; attempt: number }
  | { type: "open"; resumed: boolean }
  | { type: "reconnect_scheduled"; attempt: number; delayMs: number }
  | { type: "closed_by_user" };

type TimerHandle = unknown;

export interface ConnectionManagerOptions {
  url: string;
  /**
   * Source of `last_seq` for RESUME — must return the SequenceBuffer's
   * highestProcessedSeq (what the UI consumed), not highestReceivedSeq.
   */
  getResumeSeq: () => number;
  /** Raw, possibly out-of-order messages; feed these into a SequenceBuffer. */
  onMessage: (msg: ServerMessage) => void;
  /** Connection lifecycle events; feed these into the FSM. */
  onEvent?: (ev: ConnectionManagerEvent) => void;
  /** Socket injection for tests; defaults to the native WebSocket. */
  createSocket?: (url: string) => WebSocketLike;
  /** Backoff schedule; the last entry repeats (the cap). */
  backoffMs?: readonly number[];
  /**
   * Auto-send TOOL_ACK on raw TOOL_CALL receipt (default true). This runs
   * BEFORE reordering: in chaos mode a TOOL_CALL can sit in the
   * SequenceBuffer behind a gap for seconds, but the 2s ACK deadline is on
   * receipt — so the ACK must not wait for ordered delivery.
   */
  autoToolAck?: boolean;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10_000] as const;

/**
 * Owns the WebSocket lifecycle: exponential-backoff reconnection, RESUME as
 * the first frame on every reconnect, and the two time-critical fast paths
 * (PONG within 3s, TOOL_ACK within 2s) which are answered on raw receipt,
 * bypassing the SequenceBuffer entirely.
 *
 * All messages — including PINGs and TOOL_CALLs already answered on the fast
 * path — are still forwarded to `onMessage` so the SequenceBuffer's seq
 * accounting stays gapless.
 */
export class ConnectionManager {
  private readonly options: ConnectionManagerOptions;
  private readonly backoffMs: readonly number[];
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  private socket: WebSocketLike | null = null;
  private attempt = 0;
  private hasConnectedBefore = false;
  private closedByUser = false;
  private retryTimer: TimerHandle | null = null;
  /** User messages sent while disconnected, flushed after RESUME on reopen. */
  private readonly outbox: ClientMessage[] = [];
  /** TOOL_CALLs already ACKed, so chaos-mode duplicates aren't re-ACKed. */
  private readonly ackedCallIds = new Set<string>();

  constructor(options: ConnectionManagerOptions) {
    this.options = options;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.createSocket =
      options.createSocket ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as TimerHandle);
    this.clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WS_OPEN;
  }

  connect(): void {
    if (this.socket !== null) return;
    // An explicit connect() revives a close()d manager (e.g. React StrictMode
    // unmount/remount in dev); close() stays permanent only until then.
    this.closedByUser = false;
    this.cancelRetry();
    this.options.onEvent?.({ type: "connecting", attempt: this.attempt });

    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = () => this.handleClose();
    // Browsers always follow `error` with `close`; reconnection is driven
    // solely by `close` to avoid double-scheduling.
    socket.onerror = null;
  }

  /** Queues while disconnected; queued messages flush right after RESUME. */
  send(msg: ClientMessage): void {
    if (this.isOpen) {
      this.sendRaw(msg);
    } else {
      this.outbox.push(msg);
    }
  }

  /** Permanently closes the connection; no reconnection will be attempted. */
  close(): void {
    this.closedByUser = true;
    this.cancelRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    }
    this.options.onEvent?.({ type: "closed_by_user" });
  }

  private handleOpen(): void {
    this.attempt = 0;
    const resumed = this.hasConnectedBefore;
    if (resumed) {
      // MUST be the first frame on every reconnect.
      this.sendRaw({ type: "RESUME", last_seq: this.options.getResumeSeq() });
    }
    this.hasConnectedBefore = true;
    while (this.outbox.length > 0) {
      const queued = this.outbox.shift();
      if (queued !== undefined) this.sendRaw(queued);
    }
    this.options.onEvent?.({ type: "open", resumed });
  }

  private handleFrame(data: unknown): void {
    const msg = decodeFrame(data);
    if (msg === null) return; // malformed frame: ignore, never crash

    // Fast paths answered on raw receipt — see class doc.
    if (msg.type === "PING") {
      // Echo verbatim; corrupt PINGs may have an empty or missing challenge.
      this.sendRaw({ type: "PONG", echo: msg.challenge === undefined ? "" : msg.challenge });
    } else if (msg.type === "TOOL_CALL" && (this.options.autoToolAck ?? true)) {
      if (!this.ackedCallIds.has(msg.call_id)) {
        this.ackedCallIds.add(msg.call_id);
        this.sendRaw({ type: "TOOL_ACK", call_id: msg.call_id });
      }
    }

    this.options.onMessage(msg);
  }

  private handleClose(): void {
    if (this.socket !== null) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket = null;
    }
    if (!this.closedByUser) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.socket = null;
    const index = Math.min(this.attempt, this.backoffMs.length - 1);
    const delayMs = this.backoffMs[index] ?? 10_000;
    this.attempt += 1;
    this.options.onEvent?.({
      type: "reconnect_scheduled",
      attempt: this.attempt,
      delayMs,
    });
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      this.connect();
    }, delayMs);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.socket !== null && this.socket.readyState === WS_OPEN) {
      this.socket.send(encodeClientMessage(msg));
    }
  }
}
