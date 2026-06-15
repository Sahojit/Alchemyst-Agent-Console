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

async function respond(content) {
  const command = content.trim().toLowerCase();
  if (command === "/drop") {
    dropActive("user command /drop");
    return;
  }
  if (command === "/error") {
    emit({ type: "ERROR", code: "E_DEMO", message: "Demo error requested via /error" });
    return;
  }

  const streamId = `s${++session.streamCount}`;
  await streamTokens(
    streamId,
    `Looking into "${content.slice(0, 60)}". Let me check a few sources first — `,
  );

  if (command === "/droptool") {
    // Drop mid-tool-call: the TOOL_RESULT below still lands in the log, so
    // RESUME replay resolves the client's "waiting" card (Task 4).
    const pending = runToolCall(streamId, "flaky_tool", { reason: "mid-call drop test" });
    await sleep(150);
    dropActive("user command /droptool");
    await pending;
    await streamTokens(streamId, "…recovered after the drop. The result above arrived via RESUME replay. ");
    emit({ type: "STREAM_END", stream_id: streamId });
    return;
  }

  const doubleCall = CHAOS && Math.random() < 0.5;
  if (doubleCall) {
    // rapid double TOOL_CALL: second fires before the first's TOOL_RESULT
    await Promise.all([
      runToolCall(streamId, "search_docs", { query: content.slice(0, 48) }),
      runToolCall(streamId, "fetch_page", { url: "https://example.com/docs" }),
    ]);
  } else {
    await runToolCall(streamId, "search_docs", { query: content.slice(0, 48) });
  }

  await streamTokens(
    streamId,
    "The sources broadly agree. Synthesizing the relevant parts into an answer: " +
      "streaming consoles need ordered delivery, idempotent acks, and resumable state. ",
  );

  if (Math.random() < 0.6) {
    await runToolCall(streamId, "calculate", { expression: "tokens * entropy" });
    await streamTokens(streamId, "Factoring that in, the short version is: it works, verifiably. ");
  }

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
