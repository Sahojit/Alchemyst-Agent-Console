"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ConsoleSession } from "@/lib/session/console-session";
import { ALL_ROW_KINDS, type TimelineRowKind, type TimelineRowModel } from "@/lib/session/timeline-store";
import { formatBytes, formatClock, formatDurationMs, safeStringify, truncate } from "@/lib/utils/format";

export interface ContextFocusRequest { contextId: string; seq: number; }

const KIND_LABELS: Record<TimelineRowKind, string> = {
  tokens: "Tokens", tool_call: "Tool call", tool_result: "Result",
  snapshot: "Snapshot", ping: "Ping", stream_end: "Stream end",
  error: "Error", connection: "Connection",
};

const KIND_STYLE: Record<TimelineRowKind, { pill: string; dot: string; row: string }> = {
  tokens:      { pill: "border-zinc-800 bg-zinc-900 text-zinc-500",           dot: "bg-zinc-600",    row: "" },
  tool_call:   { pill: "border-sky-900/60 bg-sky-950/40 text-sky-400",        dot: "bg-sky-400",     row: "border-l-2 border-l-sky-500/50" },
  tool_result: { pill: "border-emerald-900/60 bg-emerald-950/40 text-emerald-400", dot: "bg-emerald-400", row: "border-l-2 border-l-emerald-500/50" },
  snapshot:    { pill: "border-violet-900/60 bg-violet-950/40 text-violet-400", dot: "bg-violet-400", row: "" },
  ping:        { pill: "border-zinc-800 bg-zinc-900/40 text-zinc-600",         dot: "bg-zinc-700",    row: "" },
  stream_end:  { pill: "border-zinc-800 bg-zinc-900/40 text-zinc-600",         dot: "bg-zinc-600",    row: "" },
  error:       { pill: "border-rose-900/60 bg-rose-950/40 text-rose-400",      dot: "bg-rose-500",    row: "" },
  connection:  { pill: "border-amber-900/60 bg-amber-950/40 text-amber-400",   dot: "bg-amber-400",   row: "" },
};

const CALL_COLORS = ["border-l-sky-500/60","border-l-emerald-500/60","border-l-fuchsia-500/60","border-l-amber-500/60","border-l-rose-500/60","border-l-indigo-500/60"] as const;

function callColor(callId: string): string {
  let h = 0;
  for (let i = 0; i < callId.length; i++) h = (h * 31 + callId.charCodeAt(i)) | 0;
  return CALL_COLORS[Math.abs(h) % CALL_COLORS.length] ?? "border-l-sky-500/60";
}

function rowSearchText(row: TimelineRowModel): string {
  switch (row.kind) {
    case "tokens": return row.text;
    case "tool_call": return `${row.toolName} ${row.callId} ${safeStringify(row.args)}`;
    case "tool_result": return `${row.callId} ${safeStringify(row.result)}`;
    case "snapshot": return row.contextId;
    case "ping": return "ping";
    case "stream_end": return row.streamId;
    case "error": return `${row.code} ${row.message}`;
    case "connection": return row.label;
  }
}

export function TimelinePanel({ session, onOpenContext }: {
  session: ConsoleSession;
  onOpenContext: (req: ContextFocusRequest) => void;
}) {
  const { rows } = useSyncExternalStore(session.timeline.store.subscribe, session.timeline.store.get, session.timeline.store.get);
  const [enabledKinds, setEnabledKinds] = useState<ReadonlySet<TimelineRowKind>>(() => new Set(ALL_ROW_KINDS));
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const followRef = useRef(true);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => enabledKinds.has(r.kind) && (needle === "" || rowSearchText(r).toLowerCase().includes(needle)));
  }, [rows, enabledKinds, search]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 12,
    getItemKey: (i) => filtered[i]?.id ?? i,
  });

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  useEffect(() => session.links.setTimelineScroller(({ callId }) => {
    const cur = filteredRef.current;
    let idx = cur.findIndex((r) => r.kind === "tool_call" && r.callId === callId);
    if (idx < 0) idx = cur.findIndex((r) => r.kind === "tool_result" && r.callId === callId);
    if (idx < 0) return;
    followRef.current = false;
    virtualizer.scrollToIndex(idx, { align: "center" });
    const row = cur[idx];
    if (row) {
      setFlashRowId(row.id);
      window.setTimeout(() => setFlashRowId((c) => c === row.id ? null : c), 1400);
    }
  }), [session, virtualizer]);

  useEffect(() => {
    if (followRef.current && filtered.length > 0) virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
  }, [filtered.length, virtualizer, filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar enabledKinds={enabledKinds}
        onToggle={(k) => setEnabledKinds((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; })}
        search={search} onSearch={setSearch} shown={filtered.length} total={rows.length} />

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-zinc-700 ring-1 ring-white/[0.06]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M1 7h9M1 11h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </div>
          <p className="text-[11px] text-zinc-700">No events yet</p>
        </div>
      ) : (
        <div ref={parentRef}
          onScroll={() => { const el = parentRef.current; if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
          className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = filtered[item.index];
              if (!row) return null;
              return (
                <div key={item.key} data-index={item.index} ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}>
                  <TimelineRowView row={row}
                    expanded={expandedIds.has(row.id)}
                    flashing={flashRowId === row.id}
                    onToggleExpand={() => setExpandedIds((p) => { const n = new Set(p); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; })}
                    onActivate={() => {
                      if (row.kind === "tokens" || row.kind === "stream_end") session.links.focusChat(`stream:${row.streamId}`);
                      else if (row.kind === "tool_call" || row.kind === "tool_result") session.links.focusChat(`tool:${row.callId}`);
                      else if (row.kind === "snapshot") onOpenContext({ contextId: row.contextId, seq: row.seq });
                    }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBar({ enabledKinds, onToggle, search, onSearch, shown, total }: {
  enabledKinds: ReadonlySet<TimelineRowKind>; onToggle: (k: TimelineRowKind) => void;
  search: string; onSearch: (v: string) => void; shown: number; total: number;
}) {
  return (
    <div className="space-y-2 border-b border-white/[0.06] p-2.5">
      <div className="relative">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600">
          <circle cx="4.5" cy="4.5" r="3.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7.5 7.5l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input type="search" value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder={`Search ${total} events…`}
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-1.5 pl-7 pr-3 text-[12px] text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20" />
      </div>
      <div className="flex flex-wrap gap-1">
        {ALL_ROW_KINDS.map((kind) => {
          const on = enabledKinds.has(kind);
          const { pill, dot } = KIND_STYLE[kind];
          return (
            <button key={kind} type="button" onClick={() => onToggle(kind)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-opacity ${on ? pill : "border-zinc-800 bg-zinc-900/50 text-zinc-700 opacity-40"}`}>
              <span className={`h-1 w-1 rounded-full ${on ? dot : "bg-zinc-700"}`} />
              {KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>
      {search !== "" && <p className="text-right text-[10px] text-zinc-700">{shown} / {total}</p>}
    </div>
  );
}

const TimelineRowView = memo(function TimelineRowView({ row, expanded, flashing, onToggleExpand, onActivate }: {
  row: TimelineRowModel; expanded: boolean; flashing: boolean; onToggleExpand: () => void; onActivate: () => void;
}) {
  const expandable = row.kind === "tokens" || row.kind === "tool_call" || row.kind === "tool_result";
  const linked = row.kind === "tool_call" || row.kind === "tool_result";
  const { row: rowCls, dot } = KIND_STYLE[row.kind];

  return (
    <div className={`border-b border-white/[0.04] text-[12px] transition-colors ${
      flashing ? "bg-violet-950/30" : "hover:bg-white/[0.02]"
    } ${linked ? `border-l-2 pl-1 ${callColor(row.callId)}` : rowCls}`}>
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        {/* Expand / dot */}
        {expandable ? (
          <button type="button" onClick={onToggleExpand}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-zinc-700 hover:text-zinc-400">
            <svg width="7" height="7" viewBox="0 0 7 7" fill="none" className={`transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}>
              <path d="M1.5 1.5l3 2-3 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <span className={`h-1 w-1 rounded-full ${dot}`} />
          </span>
        )}

        <button type="button" onClick={onActivate} className="min-w-0 flex-1 text-left">
          <RowSummary row={row} />
        </button>

        <span className="shrink-0 font-mono text-[10px] text-zinc-700">
          {row.kind === "tokens"
            ? `#${row.firstSeq}–${row.lastSeq} ${formatClock(row.endedAt)}`
            : `${"seq" in row ? `#${row.seq} ` : ""}${formatClock(row.at)}`}
        </span>
      </div>

      {expanded && (
        <div className="mx-2.5 mb-2 overflow-hidden rounded-lg border border-white/[0.06] bg-black/30">
          <pre className="max-h-48 overflow-y-auto p-2.5 font-mono text-[11px] leading-5 text-zinc-400">
            {row.kind === "tokens" ? row.text
              : row.kind === "tool_call" ? safeStringify(row.args, 2)
              : row.kind === "tool_result" ? safeStringify(row.result, 2)
              : ""}
          </pre>
        </div>
      )}
    </div>
  );
});

function RowSummary({ row }: { row: TimelineRowModel }) {
  switch (row.kind) {
    case "tokens":
      return (
        <span className="text-zinc-400">
          <span className="mr-1 text-zinc-700">▍</span>
          <span className="font-medium text-zinc-300">{row.count}</span>
          <span className="text-zinc-600"> tokens ({formatDurationMs(row.endedAt - row.startedAt)}) · </span>
          <span className="text-zinc-600">{truncate(row.text.replaceAll("\n", " "), 42)}</span>
        </span>
      );
    case "tool_call":
      return (
        <span>
          <span className="mr-1.5 font-mono text-[10px] text-sky-600">fn</span>
          <span className="font-mono font-semibold text-sky-300">{row.toolName}</span>
          <span className="ml-1.5 font-mono text-[10px] text-zinc-700">{row.callId}</span>
        </span>
      );
    case "tool_result":
      return (
        <span>
          <span className="mr-1.5 text-emerald-600">↩</span>
          <span className="font-mono text-[10px] text-zinc-600">{row.callId}</span>
          <span className="ml-1.5 text-zinc-600">{truncate(safeStringify(row.result).replaceAll("\n", " "), 34)}</span>
        </span>
      );
    case "snapshot":
      return (
        <span>
          <span className="mr-1.5 text-violet-600">◈</span>
          <span className="font-mono text-violet-300">{row.contextId}</span>
          <span className="ml-1.5 text-zinc-600">({formatBytes(row.bytes)})</span>
        </span>
      );
    case "ping":
      return <span className={row.corrupt ? "text-rose-400" : "text-zinc-600"}>◦ PING{row.corrupt ? " — corrupt" : ""}</span>;
    case "stream_end":
      return <span className="text-zinc-600">■ <span className="font-mono text-zinc-500">{row.streamId}</span></span>;
    case "error":
      return <span className="text-rose-400">⚠ {row.code}: {row.message}</span>;
    case "connection":
      return <span className="italic text-amber-400/80">◉ {row.label}</span>;
  }
}
