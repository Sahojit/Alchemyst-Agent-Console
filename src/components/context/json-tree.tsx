"use client";

import { memo, useState } from "react";
import { childPath, type StructuralDiff } from "@/lib/diff/structural-diff";

const PAGE_SIZE = 200;

export function JsonTree({ value, diff }: { value: unknown; diff: StructuralDiff | null }) {
  return (
    <div className="font-mono text-[12px] leading-[1.7]">
      <JsonNode name={null} value={value} path="" diff={diff} depth={0} />
    </div>
  );
}

type NodeStatus = "added" | "changed" | null;

function statusFor(diff: StructuralDiff | null, path: string): NodeStatus {
  if (!diff) return null;
  if (diff.added.has(path)) return "added";
  if (diff.changed.has(path)) return "changed";
  return null;
}

function statusBg(status: NodeStatus) {
  if (status === "added") return "rounded bg-emerald-500/10 px-0.5 ring-1 ring-emerald-500/20";
  if (status === "changed") return "rounded bg-amber-500/10 px-0.5 ring-1 ring-amber-500/20";
  return "";
}

function valueColor(value: unknown) {
  if (typeof value === "string") return "text-emerald-300";
  if (typeof value === "number") return "text-sky-300";
  if (typeof value === "boolean") return "text-amber-300";
  return "text-zinc-500";
}

function renderPrimitive(value: unknown): string {
  if (value === undefined) return "undefined";
  try { return JSON.stringify(value) ?? "undefined"; } catch { return String(value); }
}

function unescapePointerSegment(s: string) {
  return s.replace(/~1/g, "/").replace(/~0/g, "~");
}

function directRemovedChildren(diff: StructuralDiff | null, path: string) {
  if (!diff || diff.removed.size === 0) return [];
  const prefix = `${path}/`;
  const out: Array<{ key: string; value: unknown }> = [];
  for (const [p, value] of diff.removed) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (rest.includes("/")) continue;
    out.push({ key: unescapePointerSegment(rest), value });
  }
  return out;
}

const JsonNode = memo(function JsonNode({ name, value, path, diff, depth }: {
  name: string | null; value: unknown; path: string; diff: StructuralDiff | null; depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const status = statusFor(diff, path);
  const isArray = Array.isArray(value);
  const isObject = !isArray && typeof value === "object" && value !== null;

  if (!isArray && !isObject) {
    const changedEntry = diff?.changed.get(path);
    return (
      <div className="flex items-baseline gap-1">
        <span className="w-3.5 shrink-0" />
        <span className={statusBg(status)}>
          {name !== null && <span className="text-zinc-500">{name}<span className="text-zinc-700">: </span></span>}
          <span className={valueColor(value)}
            title={changedEntry !== undefined ? `was: ${renderPrimitive(changedEntry.before)}` : undefined}>
            {renderPrimitive(value)}
          </span>
        </span>
      </div>
    );
  }

  const entries: Array<[string | number, unknown]> = isArray
    ? (value as readonly unknown[]).map((v, i): [number, unknown] => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const removedChildren = expanded ? directRemovedChildren(diff, path) : [];
  const hasHiddenChanges = !expanded && diff !== null && diff.touched.has(path);

  return (
    <div>
      <div className="flex items-baseline gap-1">
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="flex w-3.5 shrink-0 items-center text-zinc-600 hover:text-zinc-300">
          <svg width="7" height="7" viewBox="0 0 7 7" fill="none" className={`transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}>
            <path d="M1.5 1.5l3 2-3 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className={statusBg(status)}>
          {name !== null && <span className="text-zinc-500">{name}<span className="text-zinc-700">: </span></span>}
          <span className="text-zinc-600">{isArray ? `[${entries.length}]` : `{${entries.length}}`}</span>
          {hasHiddenChanges && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" title="contains changes" />
          )}
        </span>
      </div>

      {expanded && (
        <div className="ml-2 border-l border-white/[0.06] pl-2.5">
          {entries.slice(0, visibleCount).map(([key, child]) => (
            <JsonNode key={String(key)} name={String(key)} value={child} path={childPath(path, key)} diff={diff} depth={depth + 1} />
          ))}
          {entries.length > visibleCount && (
            <button type="button" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="text-[11px] text-violet-500 hover:text-violet-400">
              show {Math.min(PAGE_SIZE, entries.length - visibleCount)} more ({entries.length - visibleCount} hidden)
            </button>
          )}
          {removedChildren.map(({ key, value: removedValue }) => (
            <div key={`removed:${key}`} className="flex items-baseline gap-1">
              <span className="w-3.5 shrink-0" />
              <span className="rounded bg-rose-500/10 px-0.5 text-rose-400 line-through ring-1 ring-rose-500/20">
                {key}<span className="text-rose-700">: </span>{renderPrimitive(summarize(removedValue))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).length}}`;
  return value;
}
