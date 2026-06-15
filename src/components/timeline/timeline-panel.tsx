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
  tokens: "Tokens",
  tool_call: "Tool call",
  tool_result: "Tool result",
  snapshot: "Snapshot",
  ping: "Ping",
  stream_end: "Stream end",
  error: "Error",
  connection: "Connection",
};

const KIND_COLORS: Record<TimelineRowKind, { badge: string; dot: string }> = {
  tokens: { badge: "bg-zinc-800 text-zinc-400", dot: "bg-zinc-500" },
  tool_call: { badge: "bg-sky-950/60 text-sky-400 border border-sky-800/40", dot: "bg-sky-400" },
  tool_result: { badge: "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40", dot: "bg-emerald-400" },
  snapshot: { badge: "bg-violet-950/60 text-violet-400 border border-violet-800/40", dot: "bg-violet-400" },
  ping: { badge: "bg-zinc-900 text-zinc-600", dot: "bg-zinc-600" },
  stream_end: { badge: "bg-zinc-900 text-zinc-500", dot: "bg-zinc-500" },
  error: { badge: "bg-rose-950/60 text-rose-400 border border-rose-800/40", dot: "bg-rose-400" },
  connection: { badge: "bg-amber-950/60 text-amber-400 border border-amber-800/40", dot: "bg-amber-400" },
};

const CALL_COLORS = [
  "border-sky-500/60",
  "border-emerald-500/60",
  "border-fuchsia-500/60",
  "border-amber-500/60",
  "border-rose-500/60",
  "border-indigo-500/60",
] as const;

function callColor(callId: string): string {
  let hash = 0;
  for (let i = 0; i < callId.length; i++)
    hash = (hash * 31 + callId.charCodeAt(i)) | 0;
  return CALL_COLORS[Math.abs(hash) % CALL_COLORS.length] ?? "border-sky-500/60";
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
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
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
    estimateSize: () => 38,
    overscan: 12,
    getItemKey: (index) => filtered[index]?.id ?? index,
  });

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
            1400,
          );
        }
      }),
    [session, virtualizer],
  );

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
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-zinc-600">No events yet.</p>
        </div>
      ) : (
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
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
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
                      else if (row.kind === "tool_call" || row.kind === "tool_result")
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
      )}
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
    <div className="space-y-2 border-b border-zinc-800/80 bg-zinc-950 p-2.5">
      <div className="relative">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
        >
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`Search ${total} events…`}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-1.5 pl-7 pr-3 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {ALL_ROW_KINDS.map((kind) => {
          const on = enabledKinds.has(kind);
          const { badge, dot } = KIND_COLORS[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onToggle(kind)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity ${
                on ? badge : "bg-zinc-900 text-zinc-600 opacity-50"
              }`}
            >
              <span className={`inline-block h-1 w-1 rounded-full ${on ? dot : "bg-zinc-600"}`} />
              {KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>
      {search !== "" && (
        <p className="text-right text-[10px] text-zinc-600">
          {shown} / {total} events
        </p>
      )}
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
  const { dot } = KIND_COLORS[row.kind];

  return (
    <div
      className={`border-b border-zinc-900/60 text-xs transition-colors ${
        flashing
          ? "bg-violet-900/20"
          : "hover:bg-zinc-900/40"
      } ${linked ? `border-l-2 pl-1 ${callColor(row.callId)}` : "pl-0"}`}
    >
      <div className="flex items-start gap-1.5 px-2.5 py-2">
        {/* Expand toggle */}
        {expandable ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-px w-3 shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              className={`transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              <path
                d="M2 1.5l3 2.5-3 2.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="mt-px w-3 shrink-0 text-center">
            <span className={`inline-block h-1 w-1 rounded-full ${dot}`} />
          </span>
        )}

        {/* Main content */}
        <button
          type="button"
          onClick={onActivate}
          className="min-w-0 flex-1 text-left"
        >
          <RowSummary row={row} />
        </button>

        {/* Timestamp */}
        <span className="shrink-0 font-mono text-[10px] text-zinc-700">
          {row.kind === "tokens"
            ? `#${row.firstSeq}–${row.lastSeq} ${formatClock(row.endedAt)}`
            : `${"seq" in row ? `#${row.seq} ` : ""}${formatClock(row.at)}`}
        </span>
      </div>

      {expanded && (
        <div className="mx-2.5 mb-2 overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-950">
          <pre className="max-h-52 overflow-y-auto p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
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
        <span className="text-zinc-400">
          <span className="mr-1 text-zinc-700">▍</span>
          <span className="font-medium text-zinc-300">{row.count}</span> token
          {row.count === 1 ? "" : "s"}{" "}
          <span className="text-zinc-600">({formatDurationMs(row.endedAt - row.startedAt)})</span>
          {" · "}
          <span className="text-zinc-600">{truncate(row.text.replaceAll("\n", " "), 44)}</span>
        </span>
      );
    case "tool_call":
      return (
        <span className="text-sky-300">
          <span className="mr-1 text-sky-600">⟨fn⟩</span>
          <span className="font-mono font-semibold">{row.toolName}</span>{" "}
          <span className="font-mono text-[10px] text-zinc-600">{row.callId}</span>
        </span>
      );
    case "tool_result":
      return (
        <span className="text-emerald-300">
          <span className="mr-1 text-emerald-600">↩</span>
          <span className="font-mono text-[10px] text-zinc-600">{row.callId}</span>{" "}
          <span className="text-zinc-500">
            {truncate(safeStringify(row.result).replaceAll("\n", " "), 36)}
          </span>
        </span>
      );
    case "snapshot":
      return (
        <span className="text-violet-300">
          <span className="mr-1 text-violet-600">◈</span>
          <span className="font-mono">{row.contextId}</span>{" "}
          <span className="text-zinc-600">({formatBytes(row.bytes)})</span>
        </span>
      );
    case "ping":
      return (
        <span className={row.corrupt ? "text-rose-400" : "text-zinc-600"}>
          <span className="mr-1">◦</span>
          PING{row.corrupt ? " — corrupt challenge" : ""}
        </span>
      );
    case "stream_end":
      return (
        <span className="text-zinc-500">
          <span className="mr-1">■</span>
          Stream ended{" "}
          <span className="font-mono text-zinc-600">{row.streamId}</span>
        </span>
      );
    case "error":
      return (
        <span className="text-rose-400">
          <span className="mr-1">⚠</span>
          {row.code}: {row.message}
        </span>
      );
    case "connection":
      return (
        <span className="italic text-amber-300/80">
          <span className="mr-1 not-italic text-amber-600">◉</span>
          {row.label}
        </span>
      );
  }
}
