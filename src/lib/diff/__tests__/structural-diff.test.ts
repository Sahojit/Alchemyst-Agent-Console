import { describe, expect, it } from "vitest";
import {
  isEmptyDiff,
  structuralDiff,
  structuralDiffSync,
  type CancelToken,
} from "../structural-diff";

describe("structuralDiffSync", () => {
  it("identical values produce an empty diff", () => {
    const value = { a: 1, b: { c: [1, 2, { d: "x" }] } };
    const diff = structuralDiffSync(value, structuredClone(value));
    expect(isEmptyDiff(diff)).toBe(true);
    expect(diff.touched.size).toBe(0);
  });

  it("detects added keys with their new values", () => {
    const diff = structuralDiffSync({ a: 1 }, { a: 1, b: 2 });
    expect(diff.added.get("/b")).toBe(2);
    expect(diff.removed.size).toBe(0);
    expect(diff.changed.size).toBe(0);
  });

  it("detects removed keys with their old values", () => {
    const diff = structuralDiffSync({ a: 1, b: 2 }, { a: 1 });
    expect(diff.removed.get("/b")).toBe(2);
    expect(diff.added.size).toBe(0);
  });

  it("detects changed primitives", () => {
    const diff = structuralDiffSync({ a: 1 }, { a: 2 });
    expect(diff.changed.get("/a")).toEqual({ before: 1, after: 2 });
  });

  it("treats type changes (object → primitive) as changed", () => {
    const diff = structuralDiffSync({ a: { x: 1 } }, { a: 5 });
    expect(diff.changed.get("/a")).toEqual({ before: { x: 1 }, after: 5 });
  });

  it("diffs nested structures and marks all ancestors as touched", () => {
    const diff = structuralDiffSync(
      { a: { b: { c: 1, keep: true } } },
      { a: { b: { c: 2, keep: true } } },
    );
    expect(diff.changed.get("/a/b/c")).toEqual({ before: 1, after: 2 });
    expect(diff.touched.has("")).toBe(true);
    expect(diff.touched.has("/a")).toBe(true);
    expect(diff.touched.has("/a/b")).toBe(true);
    expect(diff.touched.has("/a/b/c")).toBe(false); // change itself, not ancestor
  });

  it("diffs arrays by index: grow, shrink, change", () => {
    const grow = structuralDiffSync({ xs: [1] }, { xs: [1, 2] });
    expect(grow.added.get("/xs/1")).toBe(2);

    const shrink = structuralDiffSync({ xs: [1, 2] }, { xs: [1] });
    expect(shrink.removed.get("/xs/1")).toBe(2);

    const change = structuralDiffSync({ xs: [1, 2] }, { xs: [1, 9] });
    expect(change.changed.get("/xs/1")).toEqual({ before: 2, after: 9 });
  });

  it("escapes / and ~ in keys (JSON Pointer rules)", () => {
    const diff = structuralDiffSync({ "a/b": 1, "c~d": 2 }, { "a/b": 9, "c~d": 2 });
    expect(diff.changed.get("/a~1b")).toEqual({ before: 1, after: 9 });
  });

  it("handles null vs object distinctly", () => {
    const diff = structuralDiffSync({ a: null }, { a: {} });
    expect(diff.changed.get("/a")).toEqual({ before: null, after: {} });
  });
});

describe("structuralDiff (chunked/cancellable)", () => {
  function bigObject(n: number, salt: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) out[`key${i}`] = { v: i, s: `${salt}${i}` };
    return out;
  }

  it("matches the sync result on a large payload", async () => {
    const before = bigObject(20_000, "a");
    const after = bigObject(20_000, "a");
    after["key123"] = { v: -1, s: "changed" };
    const asyncDiff = await structuralDiff(before, after);
    const syncDiff = structuralDiffSync(before, after);
    expect(asyncDiff).not.toBeNull();
    expect(asyncDiff?.changed.size).toBe(syncDiff.changed.size);
    expect(asyncDiff?.touched.has("/key123")).toBe(true);
  });

  it("returns null when cancelled mid-run", async () => {
    const token: CancelToken = { cancelled: false };
    const promise = structuralDiff(
      bigObject(50_000, "a"),
      bigObject(50_000, "b"),
      token,
    );
    token.cancelled = true;
    expect(await promise).toBeNull();
  });
});
