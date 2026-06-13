/**
 * Structural diff between two JSON values (Task 3).
 *
 * Paths use JSON-Pointer-style strings: "" is the root, "/a/0/b~1c" is
 * `root.a[0]["b/c"]` ("/" → "~1", "~" → "~0").
 *
 * The walker is an explicit work stack rather than recursion so it can be
 * driven in bounded slices: `structuralDiff` processes `budget` nodes, then
 * yields a macrotask back to the event loop and checks for cancellation —
 * 500KB+ snapshots never block the main thread for one long stretch. The
 * synchronous variant drives the same runner to completion (tests, small
 * payloads).
 */

export interface StructuralDiff {
  /** path → new value */
  added: ReadonlyMap<string, unknown>;
  /** path → old value (so the tree can render ghost rows) */
  removed: ReadonlyMap<string, unknown>;
  /** path → before/after pair */
  changed: ReadonlyMap<string, { before: unknown; after: unknown }>;
  /** Ancestor paths of every change — drives "contains changes" badges. */
  touched: ReadonlySet<string>;
}

export function isEmptyDiff(diff: StructuralDiff): boolean {
  return (
    diff.added.size === 0 && diff.removed.size === 0 && diff.changed.size === 0
  );
}

export function escapePointerSegment(key: string | number): string {
  if (typeof key === "number") return String(key);
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function childPath(parent: string, key: string | number): string {
  return `${parent}/${escapePointerSegment(key)}`;
}

type JsonKind = "object" | "array" | "primitive";

function jsonKind(value: unknown): JsonKind {
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null) return "object";
  return "primitive";
}

interface DiffRunner {
  /** Processes up to `budget` nodes; returns true when finished. */
  step(budget: number): boolean;
  result(): StructuralDiff;
}

function createDiffRunner(before: unknown, after: unknown): DiffRunner {
  const added = new Map<string, unknown>();
  const removed = new Map<string, unknown>();
  const changed = new Map<string, { before: unknown; after: unknown }>();
  const touched = new Set<string>();
  const stack: Array<{ b: unknown; a: unknown; path: string }> = [
    { b: before, a: after, path: "" },
  ];

  const markAncestors = (path: string): void => {
    let p = path;
    while (p !== "") {
      p = p.slice(0, p.lastIndexOf("/"));
      if (touched.has(p)) return; // ancestors above are already marked
      touched.add(p);
    }
  };

  const record = (
    kind: "added" | "removed" | "changed",
    path: string,
    b: unknown,
    a: unknown,
  ): void => {
    if (kind === "added") added.set(path, a);
    else if (kind === "removed") removed.set(path, b);
    else changed.set(path, { before: b, after: a });
    markAncestors(path);
  };

  return {
    step(budget: number): boolean {
      let processed = 0;
      while (processed < budget) {
        const task = stack.pop();
        if (task === undefined) return true;
        processed += 1;

        const { b, a, path } = task;
        if (Object.is(b, a)) continue;

        const bKind = jsonKind(b);
        const aKind = jsonKind(a);
        if (bKind !== aKind) {
          record("changed", path, b, a);
          continue;
        }

        if (bKind === "primitive") {
          record("changed", path, b, a);
          continue;
        }

        if (bKind === "array") {
          const bArr = b as readonly unknown[];
          const aArr = a as readonly unknown[];
          const max = Math.max(bArr.length, aArr.length);
          for (let i = 0; i < max; i++) {
            const p = childPath(path, i);
            if (i >= bArr.length) record("added", p, undefined, aArr[i]);
            else if (i >= aArr.length) record("removed", p, bArr[i], undefined);
            else stack.push({ b: bArr[i], a: aArr[i], path: p });
          }
          continue;
        }

        const bObj = b as Record<string, unknown>;
        const aObj = a as Record<string, unknown>;
        for (const key of Object.keys(bObj)) {
          const p = childPath(path, key);
          if (key in aObj) stack.push({ b: bObj[key], a: aObj[key], path: p });
          else record("removed", p, bObj[key], undefined);
        }
        for (const key of Object.keys(aObj)) {
          if (!(key in bObj)) record("added", childPath(path, key), undefined, aObj[key]);
        }
      }
      return stack.length === 0;
    },
    result(): StructuralDiff {
      return { added, removed, changed, touched };
    },
  };
}

export function structuralDiffSync(
  before: unknown,
  after: unknown,
): StructuralDiff {
  const runner = createDiffRunner(before, after);
  while (!runner.step(Number.MAX_SAFE_INTEGER)) {
    // single step with an unbounded budget always finishes
  }
  return runner.result();
}

export interface CancelToken {
  cancelled: boolean;
}

const CHUNK_BUDGET = 4000;

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Chunked, cancellable diff. Returns null if `token` is cancelled mid-run
 * (e.g. the user dragged the history scrubber to another snapshot).
 */
export async function structuralDiff(
  before: unknown,
  after: unknown,
  token?: CancelToken,
): Promise<StructuralDiff | null> {
  const runner = createDiffRunner(before, after);
  while (!runner.step(CHUNK_BUDGET)) {
    await yieldMacrotask();
    if (token?.cancelled === true) return null;
  }
  return runner.result();
}
