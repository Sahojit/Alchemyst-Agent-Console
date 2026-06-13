"use client";

import { memo, useState } from "react";
import { childPath, type StructuralDiff } from "@/lib/diff/structural-diff";

/**
 * Lazy JSON tree (Task 3). Children of a node are rendered ONLY while it is
 * expanded, and large nodes paginate ("show more"), so a 500KB+ snapshot
 * costs render work proportional to what is on screen, not payload size.
 * Diff statuses: added (green), changed (amber, hover shows the previous
 * value), removed keys render as red ghost rows from the previous snapshot.
 */

const PAGE_SIZE = 200;

export function JsonTree({
  value,
  diff,
}: {
  value: unknown;
  diff: StructuralDiff | null;
}) {
  return (
    <div className="font-mono text-xs leading-5">
      <JsonNode name={null} value={value} path="" diff={diff} depth={0} />
    </div>
  );
}

type NodeStatus = "added" | "changed" | null;

function statusFor(diff: StructuralDiff | null, path: string): NodeStatus {
  if (diff === null) return null;
  if (diff.added.has(path)) return "added";
  if (diff.changed.has(path)) return "changed";
  return null;
}

function statusClass(status: NodeStatus): string {
  if (status === "added") return "bg-emerald-950/70 rounded px-0.5";
  if (status === "changed") return "bg-amber-950/70 rounded px-0.5";
  return "";
}

function primitiveClass(value: unknown): string {
  if (typeof value === "string") return "text-emerald-300";
  if (typeof value === "number") return "text-sky-300";
  if (typeof value === "boolean") return "text-violet-300";
  return "text-zinc-500"; // null / undefined
}

function renderPrimitive(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return String(value);
  }
}

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function directRemovedChildren(
  diff: StructuralDiff | null,
  path: string,
): Array<{ key: string; value: unknown }> {
  if (diff === null || diff.removed.size === 0) return [];
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

const JsonNode = memo(function JsonNode({
  name,
  value,
  path,
  diff,
  depth,
}: {
  name: string | null;
  value: unknown;
  path: string;
  diff: StructuralDiff | null;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const status = statusFor(diff, path);
  const isArray = Array.isArray(value);
  const isObject = !isArray && typeof value === "object" && value !== null;

  if (!isArray && !isObject) {
    const changedEntry = diff?.changed.get(path);
    return (
      <div className="flex items-start gap-1">
        <span className="w-3 shrink-0" />
        <span className={statusClass(status)}>
          {name !== null && <span className="text-zinc-400">{name}: </span>}
          <span
            className={primitiveClass(value)}
            title={
              changedEntry !== undefined
                ? `was: ${renderPrimitive(changedEntry.before)}`
                : undefined
            }
          >
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
  const hasHiddenChanges =
    !expanded && diff !== null && diff.touched.has(path);

  return (
    <div>
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-3 shrink-0 text-zinc-500 hover:text-zinc-200"
          aria-label={expanded ? "collapse" : "expand"}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span className={statusClass(status)}>
          {name !== null && <span className="text-zinc-400">{name}: </span>}
          <span className="text-zinc-500">
            {isArray ? `[ ${entries.length} ]` : `{ ${entries.length} }`}
          </span>
          {hasHiddenChanges && (
            <span
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle"
              title="contains changes"
            />
          )}
        </span>
      </div>
      {expanded && (
        <div className="ml-1.5 border-l border-zinc-800 pl-2">
          {entries.slice(0, visibleCount).map(([key, child]) => (
            <JsonNode
              key={String(key)}
              name={String(key)}
              value={child}
              path={childPath(path, key)}
              diff={diff}
              depth={depth + 1}
            />
          ))}
          {entries.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="text-[11px] text-sky-400 hover:underline"
            >
              show {Math.min(PAGE_SIZE, entries.length - visibleCount)} more (
              {entries.length - visibleCount} hidden)
            </button>
          )}
          {removedChildren.map(({ key, value: removedValue }) => (
            <div key={`removed:${key}`} className="flex items-start gap-1">
              <span className="w-3 shrink-0" />
              <span className="rounded bg-rose-950/70 px-0.5 text-rose-400 line-through">
                {key}: {renderPrimitive(summarize(removedValue))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return `[ ${value.length} items ]`;
  if (typeof value === "object" && value !== null)
    return `{ ${Object.keys(value).length} keys }`;
  return value;
}
