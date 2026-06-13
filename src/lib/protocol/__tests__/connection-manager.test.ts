import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionManager,
  type ConnectionManagerEvent,
  type WebSocketLike,
} from "../connection-manager";
import type { ClientMessage } from "../types";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = CONNECTING;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = CLOSED;
    this.onclose?.({});
  }

  // -- test helpers ---------------------------------------------------------
  simulateOpen(): void {
    this.readyState = OPEN;
    this.onopen?.({});
  }

  simulateMessage(payload: unknown): void {
    this.onmessage?.({
      data: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  simulateDrop(): void {
    this.readyState = CLOSED;
    this.onclose?.({});
  }

  sentMessages(): ClientMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as ClientMessage);
  }
}

function latestSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error("no socket created");
  return socket;
}

function makeManager(overrides: { resumeSeq?: () => number } = {}) {
  const received: unknown[] = [];
  const events: ConnectionManagerEvent[] = [];
  const manager = new ConnectionManager({
    url: "ws://localhost:4747/ws",
    getResumeSeq: overrides.resumeSeq ?? (() => 0),
    onMessage: (msg) => received.push(msg),
    onEvent: (ev) => events.push(ev),
    createSocket: (url) => new FakeSocket(url),
  });
  return { manager, received, events };
}

describe("ConnectionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects without sending RESUME on the first connection", () => {
    const { manager } = makeManager();
    manager.connect();
    const socket = latestSocket();
    socket.simulateOpen();
    expect(socket.sent).toEqual([]);
  });

  it("answers PING with PONG echoing the challenge verbatim", () => {
    const { manager, received } = makeManager();
    manager.connect();
    const socket = latestSocket();
    socket.simulateOpen();
    socket.simulateMessage({ type: "PING", seq: 1, challenge: "abc-123" });
    expect(socket.sentMessages()).toEqual([{ type: "PONG", echo: "abc-123" }]);
    // PING is still forwarded for seq accounting.
    expect(received).toHaveLength(1);
  });

  it("survives corrupt PINGs: empty and missing challenge", () => {
    const { manager } = makeManager();
    manager.connect();
    const socket = latestSocket();
    socket.simulateOpen();
    socket.simulateMessage({ type: "PING", seq: 1, challenge: "" });
    socket.simulateMessage({ type: "PING", seq: 2 });
    expect(socket.sentMessages()).toEqual([
      { type: "PONG", echo: "" },
      { type: "PONG", echo: "" },
    ]);
  });

  it("auto-ACKs TOOL_CALL on raw receipt and dedups repeat call_ids", () => {
    const { manager } = makeManager();
    manager.connect();
    const socket = latestSocket();
    socket.simulateOpen();
    const toolCall = {
      type: "TOOL_CALL",
      seq: 7,
      call_id: "c1",
      tool_name: "search",
      args: { q: "x" },
      stream_id: "s1",
    };
    socket.simulateMessage(toolCall);
    socket.simulateMessage(toolCall); // chaos-mode duplicate
    expect(socket.sentMessages()).toEqual([{ type: "TOOL_ACK", call_id: "c1" }]);
  });

  it("ignores malformed frames without crashing", () => {
    const { manager, received } = makeManager();
    manager.connect();
    const socket = latestSocket();
    socket.simulateOpen();
    socket.simulateMessage("{not json");
    socket.simulateMessage(JSON.stringify({ type: "NOPE", seq: 1 }));
    socket.simulateMessage(JSON.stringify({ type: "TOKEN", seq: "bad" }));
    socket.simulateMessage(JSON.stringify(null));
    expect(received).toEqual([]);
  });

  it("reconnects with the exact backoff schedule, capped at 10s", () => {
    const { manager, events } = makeManager();
    manager.connect();
    latestSocket().simulateOpen();
    latestSocket().simulateDrop();

    const expectedDelays = [500, 1000, 2000, 4000, 8000, 10_000, 10_000];
    for (const delay of expectedDelays) {
      const scheduled = events.filter((e) => e.type === "reconnect_scheduled").at(-1);
      expect(scheduled).toMatchObject({ delayMs: delay });
      vi.advanceTimersByTime(delay);
      latestSocket().simulateDrop(); // each attempt fails before opening
    }
    expect(FakeSocket.instances).toHaveLength(1 + expectedDelays.length);
  });

  it("resets backoff after a successful reconnection", () => {
    const { manager, events } = makeManager();
    manager.connect();
    latestSocket().simulateOpen();
    latestSocket().simulateDrop(); // schedules 500ms
    vi.advanceTimersByTime(500);
    latestSocket().simulateDrop(); // schedules 1000ms
    vi.advanceTimersByTime(1000);
    latestSocket().simulateOpen(); // success → attempt counter resets
    latestSocket().simulateDrop();
    const last = events.filter((e) => e.type === "reconnect_scheduled").at(-1);
    expect(last).toMatchObject({ delayMs: 500 });
  });

  it("sends RESUME with highestProcessedSeq as the FIRST frame on reconnect", () => {
    let resumeSeq = 0;
    const { manager } = makeManager({ resumeSeq: () => resumeSeq });
    manager.connect();
    latestSocket().simulateOpen();
    resumeSeq = 17; // buffer progressed during the first session
    latestSocket().simulateDrop();
    vi.advanceTimersByTime(500);
    const socket = latestSocket();
    socket.simulateOpen();
    expect(socket.sentMessages()[0]).toEqual({ type: "RESUME", last_seq: 17 });
  });

  it("queues USER_MESSAGE while down and flushes it after RESUME", () => {
    const { manager } = makeManager({ resumeSeq: () => 5 });
    manager.connect();
    latestSocket().simulateOpen();
    latestSocket().simulateDrop();
    manager.send({ type: "USER_MESSAGE", content: "hello while down" });
    vi.advanceTimersByTime(500);
    const socket = latestSocket();
    socket.simulateOpen();
    expect(socket.sentMessages()).toEqual([
      { type: "RESUME", last_seq: 5 },
      { type: "USER_MESSAGE", content: "hello while down" },
    ]);
  });

  it("close() stops reconnection permanently", () => {
    const { manager, events } = makeManager();
    manager.connect();
    latestSocket().simulateOpen();
    latestSocket().simulateDrop();
    manager.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "closed_by_user" });
  });
});
