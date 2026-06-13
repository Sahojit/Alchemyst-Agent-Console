"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { ToolSegmentModel } from "@/lib/session/chat-store";
import type { LinkRegistry } from "@/lib/session/link-registry";
import { safeStringify, truncate } from "@/lib/utils/format";

/**
 * Tool call card (Task 1). The card has a fixed two-block structure (args,
 * result) from the moment it mounts: when TOOL_RESULT arrives only the
 * result block's *content* changes, never the surrounding structure — so
 * the frozen text above and segments below don't shift.
 */
export const ToolCardView = memo(function ToolCardView({
  segment,
  links,
}: {
  segment: ToolSegmentModel;
  links: LinkRegistry;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);

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
      className="my-2 rounded-md border border-zinc-700 bg-zinc-900 text-sm"
    >
      <button
        type="button"
        onClick={() => links.focusTimelineCall(segment.callId)}
        title="Show in timeline"
        className="flex w-full items-center gap-2 rounded-t-md px-3 py-2 text-left hover:bg-zinc-800"
      >
        <span aria-hidden>🔧</span>
        <span className="font-mono font-semibold text-sky-300">
          {segment.toolName}
        </span>
        {segment.recovered && (
          <span className="rounded bg-rose-950 px-1.5 py-0.5 text-xs text-rose-300">
            recovered result — call event was lost
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-zinc-500">
          {segment.callId}
        </span>
        <span
          className={
            waiting
              ? "flex items-center gap-1 text-xs text-amber-400"
              : "flex items-center gap-1 text-xs text-emerald-400"
          }
        >
          {waiting ? (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              waiting…
            </>
          ) : (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              done
            </>
          )}
        </span>
      </button>

      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-zinc-500">args</div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-300">
          {safeStringify(segment.args, 2)}
        </pre>
      </div>

      {/* Result block is always present (min-height reserved) so its arrival
          updates content in place instead of inserting a new block. */}
      <div className="min-h-10 border-t border-zinc-800 px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-zinc-500">
          result
        </div>
        {waiting ? (
          <div className="font-mono text-xs text-zinc-500">
            ⏳ awaiting TOOL_RESULT…
          </div>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-300">
            {expanded || resultJson.length <= 400
              ? resultJson
              : truncate(resultJson, 400)}
          </pre>
        )}
        {!waiting && resultJson.length > 400 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-sky-400 hover:underline"
          >
            {expanded ? "collapse" : `show all ${resultJson.length} chars`}
          </button>
        )}
      </div>
    </div>
  );
});
