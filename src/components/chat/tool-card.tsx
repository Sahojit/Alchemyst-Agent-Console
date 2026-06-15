"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { ToolSegmentModel } from "@/lib/session/chat-store";
import type { LinkRegistry } from "@/lib/session/link-registry";
import { safeStringify, truncate } from "@/lib/utils/format";

export const ToolCardView = memo(function ToolCardView({
  segment,
  links,
}: {
  segment: ToolSegmentModel;
  links: LinkRegistry;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [argsOpen, setArgsOpen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    return links.registerChatTarget(`tool:${segment.callId}`, el);
  }, [links, segment.callId]);

  const waiting = segment.status === "waiting";
  const resultJson = waiting ? "" : safeStringify(segment.result, 2);

  return (
    <div
      ref={containerRef}
      className="my-3 overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-950 shadow-sm"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => links.focusTimelineCall(segment.callId)}
        title="Jump to timeline"
        className="flex w-full items-center gap-2.5 bg-zinc-900/80 px-3.5 py-2.5 text-left transition-colors hover:bg-zinc-800/60"
      >
        <div
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
            waiting
              ? "bg-amber-500/20 text-amber-400"
              : "bg-emerald-500/20 text-emerald-400"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5.5L4 7.5L8 2.5"
              stroke={waiting ? "#fbbf24" : "#34d399"}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ opacity: waiting ? 0 : 1 }}
            />
            {waiting && (
              <circle
                cx="5"
                cy="5"
                r="3"
                stroke="#fbbf24"
                strokeWidth="1.2"
                strokeDasharray="4 2"
                style={{ animation: "spin 1.5s linear infinite", transformOrigin: "center" }}
              />
            )}
            {!waiting && (
              <circle cx="5" cy="5" r="3.5" stroke="#34d399" strokeWidth="1" strokeOpacity="0.4" />
            )}
          </svg>
        </div>

        <span className="font-mono text-sm font-semibold text-violet-300">
          {segment.toolName}
        </span>

        {segment.recovered && (
          <span className="rounded-full border border-rose-700/50 bg-rose-950/60 px-2 py-0.5 text-[10px] font-medium text-rose-300">
            recovered
          </span>
        )}

        <span className="ml-auto font-mono text-[10px] text-zinc-600">
          {segment.callId}
        </span>

        <span
          className={`flex items-center gap-1 text-[10px] font-medium ${
            waiting ? "text-amber-400" : "text-emerald-400"
          }`}
        >
          {waiting ? (
            <>
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              waiting
            </>
          ) : (
            "done"
          )}
        </span>

        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className="shrink-0 text-zinc-600"
        >
          <path
            d="M3 4l2 2 2-2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Args */}
      <div className="border-t border-zinc-800/60">
        <button
          type="button"
          onClick={() => setArgsOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            className={`shrink-0 transition-transform ${argsOpen ? "rotate-90" : ""}`}
          >
            <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold uppercase tracking-wider">args</span>
        </button>
        {argsOpen && (
          <pre className="border-t border-zinc-800/40 bg-zinc-950/60 px-3.5 pb-2.5 pt-2 font-mono text-xs leading-relaxed text-zinc-400">
            {safeStringify(segment.args, 2)}
          </pre>
        )}
      </div>

      {/* Result */}
      <div className="border-t border-zinc-800/60">
        <div className="flex items-center gap-2 px-3.5 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            result
          </span>
          {!waiting && resultJson.length > 400 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto text-[10px] text-violet-400 hover:text-violet-300"
            >
              {expanded ? "collapse" : `show all (${resultJson.length} chars)`}
            </button>
          )}
        </div>
        <div className="min-h-8 border-t border-zinc-800/40 bg-zinc-950/60 px-3.5 pb-2.5 pt-2">
          {waiting ? (
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600" />
              awaiting TOOL_RESULT…
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-300">
              {expanded || resultJson.length <= 400 ? resultJson : truncate(resultJson, 400)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
});
