/**
 * escape-hatch.ts — the ONE file where `any` is permitted per the project
 * constraints.
 *
 * It is intentionally empty: no `any` was needed anywhere in the codebase.
 * The two places that conventionally force `any` were handled with `unknown`
 * instead:
 *   - JSON.parse results are immediately typed `unknown` and narrowed by
 *     `parseServerMessage` (src/lib/protocol/types.ts);
 *   - CONTEXT_SNAPSHOT payloads stay `unknown` end-to-end and are rendered
 *     by structural inspection (src/components/context/json-tree.tsx).
 */
export {};
