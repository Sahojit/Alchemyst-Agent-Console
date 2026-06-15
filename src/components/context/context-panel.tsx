"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { structuralDiff, type CancelToken, type StructuralDiff } from "@/lib/diff/structural-diff";
import type { ConsoleSession } from "@/lib/session/console-session";
import type { ContextFocusRequest } from "@/components/timeline/timeline-panel";
import { formatBytes, formatClock } from "@/lib/utils/format";
import { JsonTree } from "./json-tree";

export function ContextPanel({ session, focus }: { session: ConsoleSession; focus: ContextFocusRequest | null }) {
  const contextState = useSyncExternalStore(
    session.context.store.subscribe, session.context.store.get, session.context.store.get,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    if (!focus) return;
    setSelectedId(focus.contextId);
    const snaps = session.context.store.get().contexts.get(focus.contextId);
    if (!snaps) return;
    const idx = snaps.findIndex((s) => s.seq === focus.seq);
    setCursor(idx >= 0 ? idx : null);
  }, [focus, session]);

  const effectiveId = selectedId ?? contextState.ids.at(0) ?? null;
  const snapshots = useMemo(
    () => effectiveId === null ? [] : (contextState.contexts.get(effectiveId) ?? []),
    [contextState, effectiveId],
  );
  const effectiveIndex = cursor === null ? snapshots.length - 1 : Math.min(cursor, snapshots.length - 1);
  const current = effectiveIndex >= 0 ? snapshots.at(effectiveIndex) : undefined;
  const previous = effectiveIndex > 0 ? snapshots.at(effectiveIndex - 1) : undefined;

  const [diff, setDiff] = useState<StructuralDiff | null>(null);
  const [diffing, setDiffing] = useState(false);

  useEffect(() => {
    setDiff(null);
    if (!current || !previous) return;
    const token: CancelToken = { cancelled: false };
    setDiffing(true);
    void structuralDiff(previous.data, current.data, token).then((result) => {
      if (!token.cancelled) { setDiff(result); setDiffing(false); }
    });
    return () => { token.cancelled = true; };
  }, [current, previous]);

  if (contextState.ids.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] text-zinc-700 ring-1 ring-white/[0.06]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <p className="text-[12px] text-zinc-600">No context snapshots received yet.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="shrink-0 space-y-2.5 border-b border-white/[0.06] p-3">
        {/* Context selector */}
        <select
          value={effectiveId ?? ""}
          onChange={(e) => { setSelectedId(e.target.value); setCursor(null); }}
          className="w-full rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-zinc-300 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
        >
          {contextState.ids.map((id) => (
            <option key={id} value={id}>{id} ({contextState.contexts.get(id)?.length ?? 0})</option>
          ))}
        </select>

        {/* Scrubber */}
        <div className="flex items-center gap-2">
          <button type="button" disabled={effectiveIndex <= 0}
            onClick={() => setCursor(Math.max(0, effectiveIndex - 1))}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.02] text-zinc-500 transition-colors hover:border-white/[0.12] hover:text-zinc-300 disabled:opacity-25">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M5 1.5L2 4l3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <input type="range" min={0} max={Math.max(0, snapshots.length - 1)}
            value={Math.max(0, effectiveIndex)}
            onChange={(e) => { const n = Number(e.target.value); setCursor(n >= snapshots.length - 1 ? null : n); }}
            className="flex-1 accent-violet-500" />
          <button type="button" disabled={effectiveIndex >= snapshots.length - 1}
            onClick={() => { const n = effectiveIndex + 1; setCursor(n >= snapshots.length - 1 ? null : n); }}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.02] text-zinc-500 transition-colors hover:border-white/[0.12] hover:text-zinc-300 disabled:opacity-25">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M3 1.5L6 4 3 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          <span className="text-zinc-600">{Math.max(0, effectiveIndex) + 1} / {snapshots.length}</span>
          {cursor === null && (
            <span className="rounded-full border border-emerald-800/40 bg-emerald-950/30 px-1.5 py-px text-[10px] font-medium text-emerald-500">live</span>
          )}
          {current && (
            <>
              <span className="font-mono text-zinc-700">#{current.seq}</span>
              <span className="text-zinc-700">{formatClock(current.at)}</span>
              <span className="rounded bg-white/[0.04] px-1.5 py-px text-zinc-500">{formatBytes(current.bytes)}</span>
            </>
          )}
          {diffing && (
            <span className="flex items-center gap-1 text-violet-500">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="animate-spin" style={{ animationDuration: "0.8s" }}>
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.25" />
                <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              diffing…
            </span>
          )}
          {diff && (
            <span className="flex items-center gap-1.5 font-mono">
              <span className="text-emerald-500">+{diff.added.size}</span>
              <span className="text-rose-500">−{diff.removed.size}</span>
              <span className="text-amber-500">~{diff.changed.size}</span>
            </span>
          )}
          {!diff && !diffing && !previous && <span className="text-zinc-700">first snapshot</span>}
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {current ? <JsonTree value={current.data} diff={diff} /> : <p className="text-[12px] text-zinc-600">No snapshot selected.</p>}
      </div>
    </div>
  );
}
