"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  structuralDiff,
  type CancelToken,
  type StructuralDiff,
} from "@/lib/diff/structural-diff";
import type { ConsoleSession } from "@/lib/session/console-session";
import type { ContextFocusRequest } from "@/components/timeline/timeline-panel";
import { formatBytes, formatClock } from "@/lib/utils/format";
import { JsonTree } from "./json-tree";

export function ContextPanel({
  session,
  focus,
}: {
  session: ConsoleSession;
  focus: ContextFocusRequest | null;
}) {
  const contextState = useSyncExternalStore(
    session.context.store.subscribe,
    session.context.store.get,
    session.context.store.get,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** null = pinned to the latest snapshot ("live"). */
  const [cursor, setCursor] = useState<number | null>(null);

  // Timeline snapshot rows can focus a specific context/seq here.
  useEffect(() => {
    if (focus === null) return;
    setSelectedId(focus.contextId);
    const snaps = session.context.store.get().contexts.get(focus.contextId);
    if (snaps === undefined) return;
    const index = snaps.findIndex((s) => s.seq === focus.seq);
    setCursor(index >= 0 ? index : null);
  }, [focus, session]);

  const effectiveId = selectedId ?? contextState.ids.at(0) ?? null;
  const snapshots = useMemo(
    () =>
      effectiveId === null
        ? []
        : (contextState.contexts.get(effectiveId) ?? []),
    [contextState, effectiveId],
  );
  const effectiveIndex =
    cursor === null
      ? snapshots.length - 1
      : Math.min(cursor, snapshots.length - 1);
  const current = effectiveIndex >= 0 ? snapshots.at(effectiveIndex) : undefined;
  const previous =
    effectiveIndex > 0 ? snapshots.at(effectiveIndex - 1) : undefined;

  const [diff, setDiff] = useState<StructuralDiff | null>(null);
  const [diffing, setDiffing] = useState(false);

  // Chunked diff off the critical path; cancelled when the scrubber moves on.
  useEffect(() => {
    setDiff(null);
    if (current === undefined || previous === undefined) return;
    const token: CancelToken = { cancelled: false };
    setDiffing(true);
    void structuralDiff(previous.data, current.data, token).then((result) => {
      if (!token.cancelled) {
        setDiff(result);
        setDiffing(false);
      }
    });
    return () => {
      token.cancelled = true;
    };
  }, [current, previous]);

  if (contextState.ids.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-zinc-600">
        No CONTEXT_SNAPSHOT received yet.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-zinc-800 p-2">
        <select
          value={effectiveId ?? ""}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setCursor(null);
          }}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
        >
          {contextState.ids.map((id) => (
            <option key={id} value={id}>
              {id} ({contextState.contexts.get(id)?.length ?? 0} snapshots)
            </option>
          ))}
        </select>

        {/* History scrubber */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={effectiveIndex <= 0}
            onClick={() => setCursor(Math.max(0, effectiveIndex - 1))}
            className="rounded border border-zinc-700 px-1.5 text-xs text-zinc-300 disabled:opacity-40"
          >
            ◀
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, snapshots.length - 1)}
            value={Math.max(0, effectiveIndex)}
            onChange={(e) => {
              const next = Number(e.target.value);
              setCursor(next >= snapshots.length - 1 ? null : next);
            }}
            className="flex-1 accent-sky-500"
          />
          <button
            type="button"
            disabled={effectiveIndex >= snapshots.length - 1}
            onClick={() => {
              const next = effectiveIndex + 1;
              setCursor(next >= snapshots.length - 1 ? null : next);
            }}
            className="rounded border border-zinc-700 px-1.5 text-xs text-zinc-300 disabled:opacity-40"
          >
            ▶
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
          <span>
            snapshot {Math.max(0, effectiveIndex) + 1}/{snapshots.length}
          </span>
          {cursor === null && (
            <span className="rounded bg-emerald-950 px-1 text-emerald-400">
              live
            </span>
          )}
          {current !== undefined && (
            <>
              <span>seq #{current.seq}</span>
              <span>{formatClock(current.at)}</span>
              <span>{formatBytes(current.bytes)}</span>
            </>
          )}
          {diffing && <span className="text-sky-400">diffing…</span>}
          {diff !== null && (
            <span>
              <span className="text-emerald-400">+{diff.added.size}</span>{" "}
              <span className="text-rose-400">−{diff.removed.size}</span>{" "}
              <span className="text-amber-400">~{diff.changed.size}</span>
            </span>
          )}
          {diff === null && !diffing && previous === undefined && (
            <span>first snapshot — nothing to diff against</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {current !== undefined ? (
          <JsonTree value={current.data} diff={diff} />
        ) : (
          <p className="text-sm text-zinc-600">No snapshot selected.</p>
        )}
      </div>
    </div>
  );
}
