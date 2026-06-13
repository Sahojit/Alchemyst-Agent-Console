"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ConsoleSession } from "@/lib/session/console-session";
import {
  ALL_ROW_KINDS,
  type TimelineRowKind,
  type TimelineRowModel,
} from "@/lib/session/timeline-store";
import {
  formatBytes,
  formatClock,
  formatDurationMs,
  safeStringify,
  truncate,
} from "@/lib/utils/format";

export interface ContextFocusRequest {
  contextId: string;
  seq: number;
}

const KIND_LABELS: Record<TimelineRowKind, string> = {
  tokens: "tokens",
  tool_call: "tool call",
  tool_result: "tool result",
  snapshot: "snapshot",
  ping: "ping",
  stream_end: "stream end",
  error: "error",
  connection: "connection",
};

/** Stable per-call color so TOOL_CALL ↔ TOOL_RESULT pairs read as linked. */
const CALL_COLORS = [
  "border-sky-400",
  "border-emerald-400",
  "border-fuchsia-400",
  "border-amber-400",
  "border-rose-400",
  "border-indigo-400",
] as const;

function callColor(callId: string): string {
  let hash = 0;
  for (let i = 0; i < callId.length; i++)
    hash = (hash * 31 + callId.charCodeAt(i)) | 0;
  return CALL_COLORS[Math.abs(hash) % CALL_COLORS.length] ?? "border-sky-400";
}

function rowSearchText(row: TimelineRowModel): string {
  switch (row.kind) {
    case "tokens":
      return row.text;
    case "tool_call":
      return `${row.toolName} ${row.callId} ${safeStringify(row.args)}`;
    case "tool_result":
      return `${row.callId} ${safeStringify(row.result)}`;
    case "snapshot":
      return row.contextId;
    case "ping":
      return "ping";
    case "stream_end":
      return row.streamId;
    case "error":
      return `${row.code} ${row.message}`;
    case "connection":
      return row.label;
  }
}

export function TimelinePanel({
  session,
  onOpenContext,
}: {
  session: ConsoleSession;
  onOpenContext: (req: ContextFocusRequest) => void;
}) {
  const { rows } = useSyncExternalStore(
    session.timeline.store.subscribe,
    session.timeline.store.get,
    session.timeline.store.get,
  );

  const [enabledKinds, setEnabledKinds] = useState<ReadonlySet<TimelineRowKind>>(
    () => new Set(ALL_ROW_KINDS),
  );
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const followRef = useRef(true);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!enabledKinds.has(row.kind)) return false;
      if (needle === "") return true;
      return rowSearchText(row).toLowerCase().includes(needle);
    });
  }, [rows, enabledKinds, search]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
    getItemKey: (index) => filtered[index]?.id ?? index,
  });

  // Chat → timeline focus requests, resolved against the CURRENT filter.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  useEffect(
    () =>
      session.links.setTimelineScroller(({ callId }) => {
        const current = filteredRef.current;
        let index = current.findIndex(
          (r) => r.kind === "tool_call" && r.callId === callId,
        );
        if (index < 0)
          index = current.findIndex(
            (r) => r.kind === "tool_result" && r.callId === callId,
          );
        if (index < 0) return;
        followRef.current = false;
        virtualizer.scrollToIndex(index, { align: "center" });
        const row = current[index];
        if (row !== undefined) {
          setFlashRowId(row.id);
          window.setTimeout(
            () => setFlashRowId((cur) => (cur === row.id ? null : cur)),
            1600,
          );
        }
      }),
    [session, virtualizer],
  );

  // Auto-follow the newest row unless the user scrolled away.
  useEffect(() => {
    if (followRef.current && filtered.length > 0)
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
  }, [filtered.length, virtualizer, filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        enabledKinds={enabledKinds}
        onToggle={(kind) =>
          setEnabledKinds((prev) => {
            const next = new Set(prev);
            if (next.has(kind)) next.delete(kind);
            else next.add(kind);
            return next;
          })
        }
        search={search}
        onSearch={setSearch}
        shown={filtered.length}
        total={rows.length}
      />
      <div
        ref={parentRef}
        onScroll={() => {
          const el = parentRef.current;
          if (el === null) return;
          followRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = filtered[item.index];
            if (row === undefined) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <TimelineRowView
                  row={row}
                  expanded={expandedIds.has(row.id)}
                  flashing={flashRowId === row.id}
                  onToggleExpand={() =>
                    setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  onActivate={() => {
                    if (row.kind === "tokens" || row.kind === "stream_end")
                      session.links.focusChat(`stream:${row.streamId}`);
                    else if (
                      row.kind === "tool_call" ||
                      row.kind === "tool_result"
                    )
                      session.links.focusChat(`tool:${row.callId}`);
                    else if (row.kind === "snapshot")
                      onOpenContext({ contextId: row.contextId, seq: row.seq });
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FilterBar({
  enabledKinds,
  onToggle,
  search,
  onSearch,
  shown,
  total,
}: {
  enabledKinds: ReadonlySet<TimelineRowKind>;
  onToggle: (kind: TimelineRowKind) => void;
  search: string;
  onSearch: (value: string) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="border-b border-zinc-800 p-2">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={`Search ${total} events…`}
        className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {ALL_ROW_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex cursor-pointer items-center gap-1 text-xs text-zinc-400"
          >
            <input
              type="checkbox"
              checked={enabledKinds.has(kind)}
              onChange={() => onToggle(kind)}
              className="accent-sky-500"
            />
            {KIND_LABELS[kind]}
          </label>
        ))}
      </div>
      <div className="mt-1 text-right text-[10px] text-zinc-600">
        {shown}/{total} rows
      </div>
    </div>
  );
}

const TimelineRowView = memo(function TimelineRowView({
  row,
  expanded,
  flashing,
  onToggleExpand,
  onActivate,
}: {
  row: TimelineRowModel;
  expanded: boolean;
  flashing: boolean;
  onToggleExpand: () => void;
  onActivate: () => void;
}) {
  const expandable =
    row.kind === "tokens" ||
    row.kind === "tool_call" ||
    row.kind === "tool_result";
  const linked = row.kind === "tool_call" || row.kind === "tool_result";

  return (
    <div
      className={`border-b border-zinc-900 px-2 py-1.5 text-xs ${
        flashing ? "bg-amber-900/40" : "hover:bg-zinc-900/70"
      } ${linked ? `ml-3 border-l-2 ${callColor(row.callId)}` : ""}`}
    >
      <div className="flex items-start gap-1.5">
        {expandable ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-0.5 w-3 shrink-0 text-zinc-500 hover:text-zinc-200"
            aria-label={expanded ? "collapse" : "expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          type="button"
          onClick={onActivate}
          className="min-w-0 flex-1 text-left"
        >
          <RowSummary row={row} />
        </button>
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
          {row.kind === "tokens"
            ? `#${row.firstSeq}–${row.lastSeq} ${formatClock(row.endedAt)}`
            : `${"seq" in row ? `#${row.seq} ` : ""}${formatClock(row.at)}`}
        </span>
      </div>
      {expanded && (
        <div className="mt-1 pl-4">
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
            {row.kind === "tokens"
              ? row.text
              : row.kind === "tool_call"
                ? safeStringify(row.args, 2)
                : row.kind === "tool_result"
                  ? safeStringify(row.result, 2)
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
        <span className="text-zinc-300">
          <span className="text-zinc-500">▍</span> Streamed{" "}
          <span className="font-semibold">{row.count}</span> token
          {row.count === 1 ? "" : "s"} (
          {formatDurationMs(row.endedAt - row.startedAt)}) ·{" "}
          <span className="text-zinc-500">
            {truncate(row.text.replaceAll("\n", " "), 48)}
          </span>
        </span>
      );
    case "tool_call":
      return (
        <span className="text-sky-300">
          🔧 TOOL_CALL <span className="font-mono">{row.toolName}</span>{" "}
          <span className="font-mono text-[10px] text-zinc-500">
            {row.callId}
          </span>
        </span>
      );
    case "tool_result":
      return (
        <span className="text-emerald-300">
          ↩ TOOL_RESULT{" "}
          <span className="font-mono text-[10px] text-zinc-500">
            {row.callId}
          </span>{" "}
          <span className="text-zinc-500">
            {truncate(safeStringify(row.result).replaceAll("\n", " "), 40)}
          </span>
        </span>
      );
    case "snapshot":
      return (
        <span className="text-violet-300">
          📸 CONTEXT_SNAPSHOT{" "}
          <span className="font-mono">{row.contextId}</span>{" "}
          <span className="text-zinc-500">({formatBytes(row.bytes)})</span>
        </span>
      );
    case "ping":
      return (
        <span className={row.corrupt ? "text-rose-400" : "text-zinc-500"}>
          ● PING {row.corrupt ? "(corrupt challenge)" : ""}
        </span>
      );
    case "stream_end":
      return (
        <span className="text-zinc-400">
          ■ STREAM_END <span className="font-mono">{row.streamId}</span>
        </span>
      );
    case "error":
      return (
        <span className="text-rose-400">
          ⚠ ERROR {row.code}: {row.message}
        </span>
      );
    case "connection":
      return <span className="italic text-amber-300/80">{row.label}</span>;
  }
}
