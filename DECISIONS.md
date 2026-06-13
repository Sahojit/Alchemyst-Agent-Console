# DECISIONS

## 1. SequenceBuffer data structure

**Choice: `Map<seq, message>` + binary min-heap of seqs, contiguous drain, gap timeout.**

- The Map gives O(1) dedup (`pending.has(seq)`) and O(1) retrieval during the drain loop; already-processed seqs are rejected by a single comparison against `nextExpectedSeq`.
- The min-heap answers the only ordering question the buffer ever asks — "what is the lowest buffered seq?" — in O(1) peek / O(log n) insert. A sorted array would pay O(n) per insert under chaos-mode bursts; a full priority queue of messages would duplicate what the Map already stores, so the heap holds seqs only.
- Delivery is strictly contiguous: a message is emitted only when every prior seq was emitted or explicitly abandoned. **Gap strategy:** if a missing seq blocks delivery for `gapTimeoutMs` (default 10s — deliberately above the 8s chaos latency ceiling, so timeouts fire only for genuine loss, not lateness), the gap is reported via `onGap`, skipped, and late stragglers are then treated as duplicates. Stalling forever on a lost seq is strictly worse than a documented, surfaced skip (the UI prints a system note).
- The timer is keyed to the seq it waits on: partial progress restarts the clock, so a healthy-but-slow stream never gets skipped.

## 2. Anti-layout-shift strategy for tool call freezes

- An agent message is an **append-only list of segments** (text | tool card). TOOL_CALL marks the open text segment `frozen` and appends a card; TOOL_RESULT mutates only the card's content; the next TOKEN opens a **new** text segment after the card. Nothing is ever re-mounted, re-ordered, or conditionally swapped — sequential tool calls stack because stacking is the only operation that exists.
- Token text never passes through React state. Each text segment renders one stable `<span>` and registers it with the `TokenSink`; tokens are `Element.append(text)`-ed into that node directly. The segment component is `memo`-keyed on the segment id alone, so even the `frozen` flag flip doesn't re-render it: freezing costs zero DOM mutations, hence zero reflow/flicker.
- The tool card renders its full two-block structure (args + result) from the moment it mounts, with the result block always present (reserved min-height, "awaiting TOOL_RESULT…" placeholder). The result arriving changes text inside an existing block instead of inserting a new one, so content below the card doesn't jump.

## 3. DOM-consumed vs socket-received seq tracking (RESUME)

Two counters live in the SequenceBuffer:

- `highestReceivedSeq` — the highest seq ever seen on the socket, regardless of order. Diagnostic only.
- `highestProcessedSeq` — the highest seq actually delivered to the stores (and therefore reflected in the DOM), advanced strictly contiguously by the drain loop.

`RESUME { last_seq }` always sends `highestProcessedSeq` (via a lazy `getResumeSeq()` callback evaluated at reconnect time, never a stale snapshot). If we sent `highestReceivedSeq`, a crash-with-buffered-gap would lose the gap forever: the server would resume *after* messages the UI never rendered. Replayed messages ≤ `highestProcessedSeq` are rejected by the buffer's dedup check, so replay stitches into the existing DOM with no duplicates and no jumps. One deliberate wrinkle: seqs abandoned by the gap timeout also advance `highestProcessedSeq` — the UI has already rendered past them, so asking the server to replay into that hole would deliver events out of order to an already-advanced transcript.

## 4. What changes for 50 concurrent streams

- The protocol layer is already stream-agnostic (one global seq space; `stream_id` is just routing data). The chat store already maps `stream_id → message`, so interleaved streams render as separate concurrent messages today.
- What would change: (a) per-stream token sinks are already keyed by segment id, fine; (b) the FSM's single `streaming`/`tool_call_pending` scalar state becomes a `Map<stream_id, StreamState>` — connection state and per-stream state would need to be split into two machines; (c) the timeline's token batching is keyed on "consecutive tokens from the same stream", which fragments badly under interleaving — batching should become per-stream with a windowed flush instead of strictly-consecutive runs; (d) auto-scroll "pinned" logic needs to be per-message rather than global.

## 5. What changes for 100× longer responses

- Token text accumulates in `TokenSink` Maps and in timeline batch rows — at 100× length, memory and `scrollHeight` become the limits. Changes: (a) virtualize the chat transcript itself (the timeline already is); (b) cap `TokenSink` retention per segment with rope/chunk storage instead of one growing string (string concatenation is O(n) per append at large sizes); (c) timeline batch rows should store a preview + token count and lazily rehydrate full text from the sink on expand, not duplicate it; (d) the context inspector already lazy-renders, but snapshot *history* should become bounded (ring buffer per context_id) since 500KB × unbounded snapshots is the real memory hazard.

## 6. TOOL_ACK 5-second timeout race condition

**The race.** The server starts a 5s timer at TOOL_CALL send time; the client must ACK within 2s of *receipt*. Network latency (chaos spikes are 2–8s) sits between those clocks. Three bad interleavings:

1. The TOOL_CALL takes ~4.9s to arrive; the client ACKs instantly, but the ACK lands after the server's 5s timer fires → the server logs a "late ACK" violation for a client that behaved correctly.
2. The server, having timed out, proceeds anyway and sends TOOL_RESULT; the result (or a replay of it) crosses the in-flight ACK on the wire → the client receives a TOOL_RESULT for a call whose ACK was never acknowledged as accepted, and cannot tell whether the server considers the call ACKed, violated, or both.
3. On reconnect, the server replays the TOOL_CALL (client already ACKed pre-drop). A naive client re-ACKs, and the duplicate ACK arrives after the timeout window → logged as a second violation.

**What this client does.** (a) ACK on **raw receipt**, before sequencing/rendering — the SequenceBuffer can legitimately hold an out-of-order TOOL_CALL for seconds, and ACK latency must not depend on render latency. (b) ACKs are **idempotent-by-client**: `call_id`s already ACKed are never re-ACKed on replay (case 3). (c) TOOL_RESULT is processed on its seq order regardless of ACK fate, so case 2 degrades gracefully: the card resolves, and the worst case is a server-side log entry, not client state corruption.

**Proposed protocol mitigation (server-side change, documented since we can't modify the server):** make the ACK window deadline-based rather than dual-clock: server stamps TOOL_CALL with `ack_deadline` (its own clock), client echoes the stamp in TOOL_ACK, and the server judges lateness by *send* timestamp delta rather than arrival time — or more simply, the server treats `TOOL_ACK` as valid if it arrives before TOOL_RESULT is *consumed* rather than before an arbitrary timer, and treats duplicate ACKs for a known `call_id` as no-ops rather than violations. Either collapses the race to a single authoritative clock.

## Known gaps / deliberate cuts

- **Seq baseline assumption:** the buffer assumes the session starts at seq 1 (`initialSeq` option exists). If the mock server starts at 0, the first drain stalls one gap-timeout then self-heals; verify against the real server and set `initialSeq` accordingly.
- **Envelope assumption:** frames are assumed to carry a `type` discriminator; if the server uses a different envelope, only `parseServerMessage` changes.
- **Context inspector:** diffing is chunked-on-main-thread (cancellable, 4000 nodes/slice) rather than a Web Worker — chosen to keep `npm run build` bundler-config-free. The diff engine is pure and worker-portable if profiling demands it.
- **Array diffing is index-based** (no LCS/move detection): an array prepend reads as "every index changed". Acceptable for snapshot inspection; documented rather than silently wrong.
- **Timeline token batches** duplicate streamed text (see §5c).
- **ERROR messages** are treated as recoverable (banner + system note; next TOKEN clears the error state). The spec doesn't distinguish fatal vs transient error codes.
