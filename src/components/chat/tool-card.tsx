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
    if (!el) return;
    return links.registerChatTarget(`tool:${segment.callId}`, el);
  }, [links, segment.callId]);

  const waiting = segment.status === "waiting";
  const resultJson = waiting ? "" : safeStringify(segment.result, 2);

  return (
    <div
      ref={containerRef}
      className="my-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#080809] shadow-lg"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => links.focusTimelineCall(segment.callId)}
        title="Jump to timeline"
        className="flex w-full items-center gap-2.5 border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        {/* Status icon */}
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] ${
          waiting ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
        }`}>
          {waiting ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="animate-spin" style={{ animationDuration: "1.5s" }}>
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1" strokeOpacity="0.3" />
              <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2.5 5.5L4.5 7.5L7.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Tool name */}
        <span className="font-mono text-[13px] font-semibold text-violet-300">{segment.toolName}</span>

        {segment.recovered && (
          <span className="rounded-full border border-rose-700/40 bg-rose-950/50 px-2 py-px text-[10px] font-medium text-rose-400">
            recovered
          </span>
        )}

        {/* Call ID */}
        <span className="ml-auto font-mono text-[10px] text-zinc-700">{segment.callId}</span>

        {/* Status label */}
        <span className={`text-[11px] font-medium ${waiting ? "text-amber-500" : "text-emerald-500"}`}>
          {waiting ? "pending" : "done"}
        </span>

        {/* Arrow */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-zinc-700">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Args (collapsible) */}
      <div className="border-b border-white/[0.05]">
        <button
          type="button"
          onClick={() => setArgsOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`shrink-0 transition-transform duration-150 ${argsOpen ? "rotate-90" : ""}`}>
            <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-mono text-[10px] uppercase tracking-wider">arguments</span>
        </button>
        {argsOpen && (
          <div className="border-t border-white/[0.04] bg-black/20">
            <SyntaxPre content={safeStringify(segment.args, 2)} />
          </div>
        )}
      </div>

      {/* Result */}
      <div>
        <div className="flex items-center gap-2 px-3.5 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">result</span>
          {!waiting && resultJson.length > 400 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto text-[10px] text-violet-500 hover:text-violet-400"
            >
              {expanded ? "collapse" : `expand (${resultJson.length} chars)`}
            </button>
          )}
        </div>
        <div className="min-h-9 border-t border-white/[0.04] bg-black/20">
          {waiting ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] text-zinc-600">
              <span className="flex gap-0.5">
                {[0,1,2].map((i) => (
                  <span key={i} className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-700"
                    style={{ animationDelay: `${i * 0.12}s`, animationDuration: "0.9s" }} />
                ))}
              </span>
              awaiting TOOL_RESULT…
            </div>
          ) : (
            <SyntaxPre content={expanded || resultJson.length <= 400 ? resultJson : truncate(resultJson, 400)} />
          )}
        </div>
      </div>
    </div>
  );
});

function SyntaxPre({ content }: { content: string }) {
  return (
    <pre className="overflow-x-auto px-3.5 py-2.5 font-mono text-[11.5px] leading-5 text-zinc-400">
      {content.split("\n").map((line, i) => (
        <span key={i} className="block">
          {colorizeJsonLine(line)}
        </span>
      ))}
    </pre>
  );
}

function colorizeJsonLine(line: string) {
  // Simple JSON syntax highlight: strings, numbers, booleans, null, keys
  const keyMatch = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)(.*)/);
  if (keyMatch) {
    const indent = keyMatch[1] ?? "";
    const key = keyMatch[2] ?? "";
    const colon = keyMatch[3] ?? "";
    const rest = keyMatch[4] ?? "";
    return (
      <>
        {indent}
        <span className="text-violet-300">{key}</span>
        <span className="text-zinc-600">{colon}</span>
        {colorizeValue(rest)}
      </>
    );
  }
  return colorizeValue(line);
}

function colorizeValue(s: string) {
  const trimmed = s.trim();
  if (trimmed.startsWith('"')) return <span className="text-emerald-300">{s}</span>;
  if (!Number.isNaN(Number(trimmed.replace(/[,\]}]/g, "")))) return <span className="text-sky-300">{s}</span>;
  if (trimmed === "true" || trimmed === "false") return <span className="text-amber-300">{s}</span>;
  if (trimmed === "null" || trimmed === "null,") return <span className="text-zinc-500">{s}</span>;
  return <span className="text-zinc-400">{s}</span>;
}
