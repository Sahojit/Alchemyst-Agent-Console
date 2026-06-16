#!/usr/bin/env node
/**
 * Mock agent server — ws://localhost:4747/ws
 *
 * Server → Client:  TOKEN, TOOL_CALL, TOOL_RESULT, CONTEXT_SNAPSHOT, PING,
 *                   STREAM_END, ERROR             (all carry a gapless `seq`)
 * Client → Server:  USER_MESSAGE, PONG (echo challenge, 3s), RESUME (first
 *                   frame on reconnect), TOOL_ACK (within 2s of TOOL_CALL;
 *                   server enforces a 5s timer)
 *
 * Modes:
 *   node server.js                 # normal: ordered, gapless delivery
 *   node server.js --mode chaos    # out-of-order, duplicates, 2-8s latency
 *                                  # spikes, rapid double TOOL_CALLs, corrupt
 *                                  # PINGs, ~500KB snapshots, random drops
 *
 * Chat commands for manual testing:
 *   /drop      server hard-drops the socket immediately
 *   /droptool  TOOL_CALL, then drop mid-call; TOOL_RESULT lands in the
 *              replay log so RESUME resolves the waiting card
 *   /error     emits an ERROR frame
 *
 * The session (seq counter + full frame log + context) is GLOBAL, not
 * per-connection: reconnecting clients send RESUME { last_seq } and get an
 * in-order replay of everything after it.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const modeIdx = args.indexOf("--mode");
const MODE = modeIdx >= 0 ? args[modeIdx + 1] : process.env.MODE || "normal";
const CHAOS = MODE === "chaos";
const PORT = Number(process.env.PORT ?? 4747);

const log = (...xs) => console.log(new Date().toISOString(), ...xs);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const rid = (prefix) => `${prefix}_${crypto.randomBytes(4).toString("hex")}`;

// --------------------------------------------------------------------------
// Client event log — used by GET /log for protocol compliance verification.
// Records every inbound frame from the client with ISO timestamps so the
// evaluator can check PONG latency, TOOL_ACK timing, and RESUME correctness.
// --------------------------------------------------------------------------
const clientLog = [];

function recordClient(entry) {
  clientLog.push({ ...entry, ts: new Date().toISOString() });
}

// --------------------------------------------------------------------------
// Session state (survives reconnects)
// --------------------------------------------------------------------------
const session = {
  seq: 0,
  log: [], // every frame ever recorded, in seq order — RESUME replays from here
  streamCount: 0,
  context: {
    agent: { name: "alchemyst-mock", version: "1.0.0", temperature: 0.7 },
    flags: { verbose: false, beta_tools: true, cache: true },
    turn_count: 0,
    last_user_message: null,
    history: [],
    scratch: {},
    tools: ["search_docs", "fetch_page", "calculate"],
  },
  bigBlob: null,
};

function record(payload) {
  session.seq += 1;
  const frame = { seq: session.seq, ...payload };
  session.log.push(frame);
  return frame;
}

// --------------------------------------------------------------------------
// Delivery (chaos lives ONLY here; the log stays ordered and gapless)
// --------------------------------------------------------------------------
let active = null;

function rawSend(ws, frame) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(frame));
}

function deliver(frame) {
  if (!CHAOS) {
    rawSend(active, frame);
    return;
  }
  const spike = Math.random() < 0.12;
  const delay = spike ? rand(2000, 8000) : rand(0, 250);
  setTimeout(() => rawSend(active, frame), delay);
  if (Math.random() < 0.08) {
    // duplicate delivery of the same seq
    setTimeout(() => rawSend(active, frame), delay + rand(300, 1800));
  }
}

const emit = (payload) => deliver(record(payload));

function dropActive(reason) {
  if (!active) return;
  log(`dropping connection (${reason})`);
  try {
    active.terminate();
  } catch {}
  active = null;
}

// --------------------------------------------------------------------------
// PING / PONG
// --------------------------------------------------------------------------
const pendingPongs = new Map(); // challenge -> timeout
const PONG_GRACE_MS = CHAOS ? 12_000 : 3_500; // chaos delivery delay isn't the client's fault

setInterval(() => {
  if (!active) return;
  const corrupt = CHAOS && Math.random() < 0.3;
  const challenge = corrupt ? "" : crypto.randomBytes(8).toString("hex");
  emit({ type: "PING", challenge });
  if (pendingPongs.has(challenge)) clearTimeout(pendingPongs.get(challenge));
  pendingPongs.set(
    challenge,
    setTimeout(() => {
      pendingPongs.delete(challenge);
      log(`VIOLATION: no PONG for challenge ${JSON.stringify(challenge)}`);
    }, PONG_GRACE_MS),
  );
}, 20_000);

function handlePong(echo) {
  const key = typeof echo === "string" ? echo : "";
  const timer = pendingPongs.get(key);
  if (timer === undefined) {
    log(`stale/unknown PONG ${JSON.stringify(echo)} (ignored)`);
    return;
  }
  clearTimeout(timer);
  pendingPongs.delete(key);
}

// --------------------------------------------------------------------------
// TOOL_CALL / TOOL_ACK (server-side 5s timer — see DECISIONS.md §6 race)
// --------------------------------------------------------------------------
const pendingAcks = new Map(); // call_id -> timeout
const ackedCalls = new Set();

function expectAck(callId) {
  pendingAcks.set(
    callId,
    setTimeout(() => {
      pendingAcks.delete(callId);
      log(`VIOLATION: TOOL_ACK for ${callId} not received within 5s`);
    }, 5_000),
  );
}

function handleAck(callId) {
  if (typeof callId !== "string") return;
  if (ackedCalls.has(callId) && !pendingAcks.has(callId)) {
    log(`duplicate TOOL_ACK for ${callId} (ignored)`);
    return;
  }
  ackedCalls.add(callId);
  const timer = pendingAcks.get(callId);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingAcks.delete(callId);
  } else {
    log(`late TOOL_ACK for ${callId} (after 5s timer — race window)`);
  }
}

async function runToolCall(streamId, toolName, toolArgs) {
  const callId = rid("call");
  emit({
    type: "TOOL_CALL",
    call_id: callId,
    tool_name: toolName,
    args: toolArgs,
    stream_id: streamId,
  });
  expectAck(callId);
  await sleep(rand(800, 2500));
  emit({
    type: "TOOL_RESULT",
    call_id: callId,
    result: fakeResult(toolName, toolArgs),
    stream_id: streamId,
  });
}

function fakeResult(toolName, toolArgs) {
  switch (toolName) {
    case "search_docs":
      return {
        query: toolArgs.query ?? "",
        hits: Array.from({ length: 3 }, (_, i) => ({
          title: `Result ${i + 1} for "${toolArgs.query ?? ""}"`,
          url: `https://docs.example.com/${rid("page")}`,
          score: Number(rand(0.5, 1).toFixed(3)),
        })),
      };
    case "fetch_page":
      return {
        url: toolArgs.url ?? "https://example.com",
        status: 200,
        excerpt: "Lorem ipsum dolor sit amet, consectetur adipiscing elit…",
      };
    case "calculate":
      return { expression: toolArgs.expression ?? "", value: Number(rand(1, 99).toFixed(4)) };
    default:
      return { ok: true };
  }
}

// --------------------------------------------------------------------------
// Response generation
// --------------------------------------------------------------------------
function tokenize(text) {
  return text.match(/\S+\s*/g) ?? [];
}

async function streamTokens(streamId, text) {
  for (const token of tokenize(text)) {
    emit({ type: "TOKEN", text: token, stream_id: streamId });
    await sleep(CHAOS ? rand(15, 70) : rand(25, 80));
  }
}

function emitSnapshot(content) {
  const ctx = session.context;
  ctx.turn_count += 1;
  ctx.last_user_message = content;
  ctx.history.push({ at: Date.now(), content: content.slice(0, 80) });
  if (ctx.history.length > 20) ctx.history.shift();
  ctx.flags.verbose = !ctx.flags.verbose;
  if (Math.random() < 0.4) ctx.scratch[rid("note")] = { weight: Number(rand(0, 1).toFixed(3)) };
  const scratchKeys = Object.keys(ctx.scratch);
  if (scratchKeys.length > 4) delete ctx.scratch[scratchKeys[0]];

  const data = structuredClone(ctx);
  if (CHAOS && Math.random() < 0.4) data.blob = bigBlob(); // ~600KB payload
  emit({ type: "CONTEXT_SNAPSHOT", context_id: "ctx-main", data });
}

function bigBlob() {
  if (!session.bigBlob) {
    session.bigBlob = Array.from({ length: 2200 }, (_, i) => ({
      id: i,
      hash: crypto.randomBytes(64).toString("hex"),
      vec: Array.from({ length: 8 }, (_, j) => Number(Math.sin(i * (j + 1)).toFixed(6))),
      tag: `chunk-${i % 37}`,
    }));
  }
  // mutate one entry so consecutive big snapshots produce a real diff
  const i = Math.floor(Math.random() * session.bigBlob.length);
  session.bigBlob[i] = { ...session.bigBlob[i], hash: crypto.randomBytes(64).toString("hex") };
  return session.bigBlob;
}

// --------------------------------------------------------------------------
// Response scripts — keyword-matched so different inputs feel different
// --------------------------------------------------------------------------
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const SCRIPTS = [
  // code / programming
  {
    match: (q) => /\b(code|function|bug|debug|error|typescript|javascript|python|async|class|api)\b/i.test(q),
    async run(streamId, content) {
      await streamTokens(streamId, `Let me look at the relevant code patterns for "${content.slice(0, 50)}". `);
      await runToolCall(streamId, "search_docs", { query: content.slice(0, 48), category: "code" });
      await streamTokens(streamId, "Found some relevant examples. The key insight here is that ");
      await runToolCall(streamId, "fetch_page", { url: `https://docs.example.com/${rid("ref")}` });
      await streamTokens(streamId,
        "the implementation requires careful handling of async boundaries. " +
        "You'll want to ensure proper error propagation and avoid implicit any types. " +
        "The pattern that works best in practice is to define explicit interfaces at every boundary " +
        "and use discriminated unions for state management. "
      );
      if (Math.random() < 0.5) {
        await runToolCall(streamId, "calculate", { expression: "cyclomatic_complexity(ast)" });
        await streamTokens(streamId, "Complexity looks manageable. Ship it. ");
      }
    },
  },

  // data / analysis
  {
    match: (q) => /\b(data|analyse|analyze|metric|stat|number|chart|report|growth|revenue|percentage|trend)\b/i.test(q),
    async run(streamId, content) {
      await streamTokens(streamId, `Pulling the latest data for "${content.slice(0, 50)}"… `);
      await Promise.all([
        runToolCall(streamId, "search_docs", { query: content.slice(0, 48), index: "metrics" }),
        runToolCall(streamId, "fetch_page",  { url: "https://data.example.com/latest" }),
      ]);
      await streamTokens(streamId,
        "Data retrieved. Running analysis — the numbers show a clear pattern: " +
        "growth is accelerating in Q3, driven primarily by organic acquisition. "
      );
      await runToolCall(streamId, "calculate", { expression: "yoy_growth_rate(q3, q2)" });
      await streamTokens(streamId,
        "Year-over-year growth sits at 23.4%. The trend is statistically significant (p < 0.01). " +
        "Recommend increasing budget allocation to the top-performing channels. "
      );
    },
  },

  // summarise / summary
  {
    match: (q) => /\b(summar|tldr|brief|overview|explain|what is|what are|describe)\b/i.test(q),
    async run(streamId, content) {
      await streamTokens(streamId, `Searching for authoritative sources on "${content.slice(0, 50)}"… `);
      await runToolCall(streamId, "search_docs", { query: content.slice(0, 48) });
      await streamTokens(streamId,
        "Here's a concise overview: the core idea is straightforward — " +
        "you need to balance three competing concerns: correctness, performance, and maintainability. " +
        "Most systems fail by optimising for one at the expense of the other two. "
      );
      await runToolCall(streamId, "fetch_page", { url: `https://wiki.example.com/${rid("topic")}` });
      await streamTokens(streamId,
        "The reference confirms this framing. In practice, start with correctness, " +
        "measure performance, then refactor for maintainability once the behaviour is well understood. "
      );
    },
  },

  // write / draft / compose
  {
    match: (q) => /\b(write|draft|compose|email|message|letter|post|blog|paragraph)\b/i.test(q),
    async run(streamId, content) {
      await streamTokens(streamId, "Drafting that for you now. Checking style guidelines first — ");
      await runToolCall(streamId, "search_docs", { query: "style guide tone formal", category: "writing" });
      await streamTokens(streamId,
        "\n\nHere's a draft:\n\n" +
        `Subject: Following up on ${content.slice(0, 40)}\n\n` +
        "I wanted to reach out regarding the points discussed in our last session. " +
        "After reviewing the relevant context, I believe we have a clear path forward. " +
        "The key next steps are: (1) align on scope, (2) assign ownership, and (3) set a review cadence. " +
        "Please let me know if you'd like any adjustments to the tone or length. "
      );
    },
  },

  // math / calculate
  {
    match: (q) => /\b(calculat|math|formula|equation|integral|derivative|sum|average|mean|median)\b/i.test(q),
    async run(streamId, content) {
      await streamTokens(streamId, `Computing "${content.slice(0, 60)}"… `);
      await runToolCall(streamId, "calculate", { expression: content.slice(0, 80) });
      await streamTokens(streamId, "Let me verify that with a second approach — ");
      await runToolCall(streamId, "calculate", { expression: `verify(${content.slice(0, 40)})` });
      await streamTokens(streamId,
        "Both methods agree. The result is numerically stable across the expected input range. " +
        "Edge cases to watch: division by zero when the denominator approaches 0, and overflow beyond 2^53. "
      );
    },
  },

  // help / commands
  {
    match: (q) => /^\/?(help|commands?|what can you|capabilities|features)\b/i.test(q),
    async run(streamId) {
      await streamTokens(streamId,
        "Here's what you can do in this console:\n\n" +
        "• Type any question or task to see the streaming agent response with live tool calls.\n" +
        "• /drop — force-drops the WebSocket to demo reconnection + RESUME recovery.\n" +
        "• /droptool — drops mid-tool-call; the result arrives via RESUME replay.\n" +
        "• /error — emits an ERROR frame to test the error banner.\n" +
        "• /chaos — send a long multi-tool response (stress test the timeline).\n" +
        "• /long — generate a lengthy streamed response.\n" +
        "• /fast — instant single-tool response, no delay.\n\n" +
        "The Timeline panel shows every protocol event. Click any row to jump to the corresponding chat element, and vice versa. "
      );
    },
  },

  // /long — lengthy response
  {
    match: (q) => /^\/long\b/i.test(q),
    async run(streamId) {
      await streamTokens(streamId, "Generating a long response to stress-test the streaming renderer. ");
      await runToolCall(streamId, "search_docs", { query: "distributed systems fundamentals" });
      const paragraphs = [
        "Distributed systems are fundamentally about managing state across multiple processes that communicate via unreliable networks. The CAP theorem tells us we can only guarantee two of: consistency, availability, and partition tolerance. In practice, we choose AP (availability + partition tolerance) for most consumer-facing systems and CP (consistency + partition tolerance) for financial or coordination systems. ",
        "The challenge of ordering events in a distributed system is non-trivial. Lamport clocks provide a partial ordering, but vector clocks are required for a complete causal ordering. In practice, most systems use hybrid logical clocks that combine physical time with logical counters to get the best of both worlds. ",
        "Consensus algorithms like Raft and Paxos solve the problem of getting a distributed set of nodes to agree on a single value. Raft is generally preferred for its understandability — it separates leader election from log replication, making it easier to reason about correctness. ",
        "Backpressure is one of the most underappreciated concepts in streaming systems. Without it, a fast producer overwhelms a slow consumer, causing unbounded queue growth and eventual OOM. Proper backpressure propagates upstream pressure signals so producers automatically throttle. ",
        "Observability in distributed systems requires three pillars: metrics (aggregated numbers over time), logs (discrete events with context), and traces (correlated spans across service boundaries). Without all three, debugging production incidents is essentially archaeology. ",
      ];
      for (const p of paragraphs) {
        await streamTokens(streamId, p);
        if (Math.random() < 0.4) await runToolCall(streamId, "calculate", { expression: pick(["latency_p99", "throughput_rps", "error_rate"]) });
      }
      await streamTokens(streamId, "That covers the essentials. The timeline on the right should now have a rich event history to explore. ");
    },
  },

  // /fast — quick single response
  {
    match: (q) => /^\/fast\b/i.test(q),
    async run(streamId) {
      await streamTokens(streamId, "Fast path: no tool calls, immediate response. Done. ");
    },
  },

  // /chaos — many parallel tool calls
  {
    match: (q) => /^\/chaos\b/i.test(q),
    async run(streamId) {
      await streamTokens(streamId, "Running chaos scenario: multiple parallel tool calls incoming. ");
      await Promise.all([
        runToolCall(streamId, "search_docs",  { query: "chaos engineering" }),
        runToolCall(streamId, "fetch_page",   { url: "https://example.com/chaos" }),
        runToolCall(streamId, "calculate",    { expression: "failure_rate * blast_radius" }),
      ]);
      await streamTokens(streamId, "All three resolved. Now a sequential chain — ");
      await runToolCall(streamId, "search_docs", { query: "fault injection" });
      await runToolCall(streamId, "calculate",   { expression: "mttr / mttf" });
      await streamTokens(streamId, "Chaos run complete. Check the timeline for the full event trace. ");
    },
  },

  // default fallback
  {
    match: () => true,
    async run(streamId, content) {
      await streamTokens(streamId, `Looking into "${content.slice(0, 60)}". Let me check a few sources — `);

      const doubleCall = CHAOS && Math.random() < 0.5;
      if (doubleCall) {
        await Promise.all([
          runToolCall(streamId, "search_docs", { query: content.slice(0, 48) }),
          runToolCall(streamId, "fetch_page",  { url: "https://example.com/docs" }),
        ]);
      } else {
        await runToolCall(streamId, "search_docs", { query: content.slice(0, 48) });
      }

      await streamTokens(streamId,
        "The sources broadly agree. Synthesizing the relevant parts: " +
        "streaming consoles need ordered delivery, idempotent acks, and resumable state. "
      );

      if (Math.random() < 0.6) {
        await runToolCall(streamId, "calculate", { expression: "tokens * entropy" });
        await streamTokens(streamId, "Factoring that in — it works, verifiably. ");
      }
    },
  },
];

async function respond(content) {
  const command = content.trim().toLowerCase();

  if (command === "/drop") { dropActive("user command /drop"); return; }
  if (command === "/error") { emit({ type: "ERROR", code: "E_DEMO", message: "Demo error requested via /error" }); return; }

  const streamId = `s${++session.streamCount}`;

  if (command === "/droptool") {
    await streamTokens(streamId, "Kicking off a tool call — and then the connection will drop mid-call. ");
    const pending = runToolCall(streamId, "flaky_tool", { reason: "mid-call drop test" });
    await sleep(150);
    dropActive("user command /droptool");
    await pending;
    await streamTokens(streamId, "…recovered after the drop. The result above arrived via RESUME replay. ");
    emit({ type: "STREAM_END", stream_id: streamId });
    return;
  }

  // Pick the first matching script
  const script = SCRIPTS.find((s) => s.match(content)) ?? SCRIPTS[SCRIPTS.length - 1];
  await script.run(streamId, content);

  emitSnapshot(content);
  emit({ type: "STREAM_END", stream_id: streamId });
}

// --------------------------------------------------------------------------
// HTTP + WebSocket server
// --------------------------------------------------------------------------
const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: MODE }));
    return;
  }

  // Protocol compliance log — every inbound client frame with timestamps.
  // Evaluators use this to verify PONG latency, TOOL_ACK timing, and RESUME.
  if (req.method === "GET" && req.url === "/log") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(clientLog, null, 2));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
httpServer.listen(PORT, () => {
  log(`mock agent server listening on ws://localhost:${PORT}/ws (mode=${MODE})`);
});

wss.on("connection", (ws) => {
  log(`client connected (mode=${MODE})`);
  if (active && active !== ws) {
    try {
      active.close();
    } catch {}
  }
  active = ws;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      log("unparseable client frame (ignored)");
      return;
    }
    switch (msg.type) {
      case "RESUME": {
        const last = Number.isFinite(Number(msg.last_seq)) ? Number(msg.last_seq) : 0;
        const replay = session.log.filter((f) => f.seq > last);
        log(`RESUME last_seq=${last} → replaying ${replay.length} frames`);
        recordClient({ type: "RESUME", last_seq: last, replay_count: replay.length });
        for (const frame of replay) rawSend(ws, frame); // replay is in-order even in chaos
        break;
      }
      case "USER_MESSAGE":
        if (typeof msg.content === "string") {
          log(`USER_MESSAGE: ${msg.content}`);
          recordClient({ type: "USER_MESSAGE", content: msg.content });
          respond(msg.content).catch((err) => log("respond() failed:", err));
        }
        break;
      case "PONG":
        recordClient({ type: "PONG", echo: msg.echo });
        handlePong(msg.echo);
        break;
      case "TOOL_ACK":
        recordClient({ type: "TOOL_ACK", call_id: msg.call_id });
        handleAck(msg.call_id);
        break;
      default:
        log(`unknown client frame type: ${String(msg.type)}`);
    }
  });

  ws.on("close", () => {
    if (active === ws) active = null;
    log("client disconnected");
  });
  ws.on("error", (err) => log("socket error:", err.message));
});

if (CHAOS) {
  setInterval(() => {
    if (active && Math.random() < 0.25) dropActive("chaos");
  }, 15_000);
}
