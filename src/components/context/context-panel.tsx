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
  const [cursor, setCursor] = useState<number | null>(null);

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
      effectiveId === null ? [] : (contextState.contexts.get(effectiveId) ?? []),
    [contextState, effectiveId],
  );
  const effectiveIndex =
    cursor === null ? snapshots.length - 1 : Math.min(cursor, snapshots.length - 1);
  const current = effectiveIndex >= 0 ? snapshots.at(effectiveIndex) : undefined;
  const previous =
    effectiveIndex > 0 ? snapshots.at(effectiveIndex - 1) : undefined;

  const [diff, setDiff] = useState<StructuralDiff | null>(null);
  const [diffing, setDiffing] = useState(false);

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
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-2 flex justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-950/50 text-violet-600 ring-1 ring-violet-800/30">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <rect x="7.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <rect x="7.5" y="7.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-zinc-600">No CONTEXT_SNAPSHOT received yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="shrink-0 space-y-2.5 border-b border-zinc-800/80 p-2.5">
        <select
          value={effectiveId ?? ""}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setCursor(null);
          }}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
        >
          {contextState.ids.map((id) => (
            <option key={id} value={id}>
              {id} ({contextState.contexts.get(id)?.length ?? 0} snapshots)
            </option>
          ))}
        </select>

        {/* Scrubber */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={effectiveIndex <= 0}
            onClick={() => setCursor(Math.max(0, effectiveIndex - 1))}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-30"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M5 1.5L2 4l3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
            className="flex-1 accent-violet-500"
          />
          <button
            type="button"
            disabled={effectiveIndex >= snapshots.length - 1}
            onClick={() => {
              const next = effectiveIndex + 1;
              setCursor(next >= snapshots.length - 1 ? null : next);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-30"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M3 1.5L6 4 3 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="text-zinc-600">
            {Math.max(0, effectiveIndex) + 1} / {snapshots.length}
          </span>
          {cursor === null && (
            <span className="rounded-full border border-emerald-800/40 bg-emerald-950/40 px-1.5 py-px text-[10px] font-medium text-emerald-400">
              live
            </span>
          )}
          {current !== undefined && (
            <>
              <span className="font-mono text-zinc-600">#{current.seq}</span>
              <span className="text-zinc-600">{formatClock(current.at)}</span>
              <span className="rounded bg-zinc-900 px-1 text-zinc-500">
                {formatBytes(current.bytes)}
              </span>
            </>
          )}
          {diffing && (
            <span className="flex items-center gap-1 text-violet-400">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="animate-spin">
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
                <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              diffing…
            </span>
          )}
          {diff !== null && (
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-emerald-400">+{diff.added.size}</span>
              <span className="font-mono text-rose-400">−{diff.removed.size}</span>
              <span className="font-mono text-amber-400">~{diff.changed.size}</span>
            </span>
          )}
          {diff === null && !diffing && previous === undefined && (
            <span className="text-zinc-700">first snapshot</span>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {current !== undefined ? (
          <JsonTree value={current.data} diff={diff} />
        ) : (
          <p className="text-xs text-zinc-600">No snapshot selected.</p>
        )}
      </div>
    </div>
  );
}
