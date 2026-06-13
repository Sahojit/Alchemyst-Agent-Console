import { ExternalStore } from "./external-store";
import type { ServerMessage } from "@/lib/protocol/types";

export interface SnapshotEntry {
  seq: number;
  at: number;
  data: unknown;
  bytes: number;
}

export interface ContextState {
  /** Snapshot history per context_id, in arrival (= seq) order. */
  readonly contexts: ReadonlyMap<string, readonly SnapshotEntry[]>;
  /** context_ids in order of first appearance, for the selector UI. */
  readonly ids: readonly string[];
}

export class ContextStore {
  readonly store = new ExternalStore<ContextState>({
    contexts: new Map(),
    ids: [],
  });

  handleOrdered(msg: ServerMessage): void {
    if (msg.type !== "CONTEXT_SNAPSHOT") return;
    const entry: SnapshotEntry = {
      seq: msg.seq,
      at: Date.now(),
      data: msg.data,
      bytes: approximateJsonBytes(msg.data),
    };
    this.store.update((s) => {
      const existing = s.contexts.get(msg.context_id);
      const contexts = new Map(s.contexts);
      contexts.set(
        msg.context_id,
        existing === undefined ? [entry] : [...existing, entry],
      );
      const ids =
        existing === undefined ? [...s.ids, msg.context_id] : s.ids;
      return { contexts, ids };
    });
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
