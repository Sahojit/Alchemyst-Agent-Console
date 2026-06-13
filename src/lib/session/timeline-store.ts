import { ExternalStore } from "./external-store";
import type { ServerMessage } from "@/lib/protocol/types";

export type TimelineRowModel =
  | {
      kind: "tokens";
      id: string;
      streamId: string;
      count: number;
      text: string;
      firstSeq: number;
      lastSeq: number;
      startedAt: number;
      endedAt: number;
    }
  | {
      kind: "tool_call";
      id: string;
      seq: number;
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      at: number;
    }
  | {
      kind: "tool_result";
      id: string;
      seq: number;
      callId: string;
      result: unknown;
      at: number;
    }
  | {
      kind: "snapshot";
      id: string;
      seq: number;
      contextId: string;
      bytes: number;
      at: number;
    }
  | { kind: "ping"; id: string; seq: number; corrupt: boolean; at: number }
  | { kind: "stream_end"; id: string; seq: number; streamId: string; at: number }
  | {
      kind: "error";
      id: string;
      seq: number;
      code: string;
      message: string;
      at: number;
    }
  | { kind: "connection"; id: string; label: string; at: number };

export type TimelineRowKind = TimelineRowModel["kind"];

export const ALL_ROW_KINDS: readonly TimelineRowKind[] = [
  "tokens",
  "tool_call",
  "tool_result",
  "snapshot",
  "ping",
  "stream_end",
  "error",
  "connection",
];

export interface TimelineState {
  readonly rows: readonly TimelineRowModel[];
}

interface TokenDraft {
  rowId: string;
  streamId: string;
  count: number;
  text: string;
  firstSeq: number;
  lastSeq: number;
  startedAt: number;
  endedAt: number;
  dirty: boolean;
}

const TOKEN_FLUSH_INTERVAL_MS = 100;

/**
 * Event log for Task 2. Consecutive TOKEN events for a stream collapse into
 * a single batch row: the row is committed once when the batch starts, then
 * updated at most every 100ms while tokens stream — so 30+ events/sec cost
 * ≤10 state updates/sec, and the virtualizer only re-renders visible rows.
 * Any non-TOKEN event finalizes the open batch first, preserving order.
 */
export class TimelineStore {
  readonly store = new ExternalStore<TimelineState>({ rows: [] });
  private counter = 0;
  private draft: TokenDraft | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  handleOrdered(msg: ServerMessage): void {
    const at = Date.now();
    if (msg.type === "TOKEN") {
      this.handleToken(msg.seq, msg.stream_id, msg.text, at);
      return;
    }

    this.finalizeDraft();
    switch (msg.type) {
      case "TOOL_CALL":
        this.push({
          kind: "tool_call",
          id: this.nextId(),
          seq: msg.seq,
          callId: msg.call_id,
          toolName: msg.tool_name,
          args: msg.args,
          at,
        });
        break;
      case "TOOL_RESULT":
        this.push({
          kind: "tool_result",
          id: this.nextId(),
          seq: msg.seq,
          callId: msg.call_id,
          result: msg.result,
          at,
        });
        break;
      case "CONTEXT_SNAPSHOT":
        this.push({
          kind: "snapshot",
          id: this.nextId(),
          seq: msg.seq,
          contextId: msg.context_id,
          bytes: approximateJsonBytes(msg.data),
          at,
        });
        break;
      case "PING":
        this.push({
          kind: "ping",
          id: this.nextId(),
          seq: msg.seq,
          corrupt:
            msg.challenge === undefined ||
            msg.challenge === null ||
            msg.challenge === "",
          at,
        });
        break;
      case "STREAM_END":
        this.push({
          kind: "stream_end",
          id: this.nextId(),
          seq: msg.seq,
          streamId: msg.stream_id,
          at,
        });
        break;
      case "ERROR":
        this.push({
          kind: "error",
          id: this.nextId(),
          seq: msg.seq,
          code: msg.code,
          message: msg.message,
          at,
        });
        break;
    }
  }

  /** Connection lifecycle markers (reconnects, resumes, abandoned gaps). */
  addConnectionNote(label: string): void {
    this.finalizeDraft();
    this.push({ kind: "connection", id: this.nextId(), label, at: Date.now() });
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private handleToken(
    seq: number,
    streamId: string,
    text: string,
    at: number,
  ): void {
    if (this.draft !== null && this.draft.streamId === streamId) {
      this.draft.count += 1;
      this.draft.text += text;
      this.draft.lastSeq = seq;
      this.draft.endedAt = at;
      this.draft.dirty = true;
      this.scheduleFlush();
      return;
    }

    this.finalizeDraft();
    const rowId = this.nextId();
    this.draft = {
      rowId,
      streamId,
      count: 1,
      text,
      firstSeq: seq,
      lastSeq: seq,
      startedAt: at,
      endedAt: at,
      dirty: false,
    };
    // Commit the batch row immediately so the timeline feels live; further
    // tokens only mutate the draft until the throttled flush.
    this.push(this.draftToRow(this.draft));
  }

  private draftToRow(draft: TokenDraft): TimelineRowModel {
    return {
      kind: "tokens",
      id: draft.rowId,
      streamId: draft.streamId,
      count: draft.count,
      text: draft.text,
      firstSeq: draft.firstSeq,
      lastSeq: draft.lastSeq,
      startedAt: draft.startedAt,
      endedAt: draft.endedAt,
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushDraft();
    }, TOKEN_FLUSH_INTERVAL_MS);
  }

  private flushDraft(): void {
    const draft = this.draft;
    if (draft === null || !draft.dirty) return;
    draft.dirty = false;
    const row = this.draftToRow(draft);
    this.store.update((s) => ({
      rows: s.rows.map((r) => (r.id === row.id ? row : r)),
    }));
  }

  private finalizeDraft(): void {
    this.flushDraft();
    this.draft = null;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private push(row: TimelineRowModel): void {
    this.store.update((s) => ({ rows: [...s.rows, row] }));
  }

  private nextId(): string {
    this.counter += 1;
    return `row-${this.counter}`;
  }
}

function approximateJsonBytes(data: unknown): number {
  try {
    const json = JSON.stringify(data);
    return json === undefined ? 0 : json.length;
  } catch {
    return 0;
  }
}
