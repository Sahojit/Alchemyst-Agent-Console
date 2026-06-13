import { describe, expect, it } from "vitest";
import {
  connectionReducer,
  isDisconnected,
  INITIAL_CONNECTION_STATE,
  type ConnectionFsmEvent,
  type ConnectionState,
} from "../fsm";

function run(events: ConnectionFsmEvent[], from = INITIAL_CONNECTION_STATE) {
  return events.reduce<ConnectionState>(connectionReducer, from);
}

describe("connection FSM", () => {
  it("idle → connecting → connected on a fresh connection", () => {
    const state = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
    ]);
    expect(state).toEqual({ status: "connected" });
  });

  it("connected → streaming on first token", () => {
    const state = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "TOKEN_RECEIVED", streamId: "s1" },
    ]);
    expect(state).toEqual({ status: "streaming", streamId: "s1" });
  });

  it("rapid double TOOL_CALL stacks pending call ids", () => {
    const state = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "TOKEN_RECEIVED", streamId: "s1" },
      { type: "TOOL_CALL_RECEIVED", callId: "c1", streamId: "s1" },
      { type: "TOOL_CALL_RECEIVED", callId: "c2", streamId: "s1" },
    ]);
    expect(state).toEqual({
      status: "tool_call_pending",
      streamId: "s1",
      pendingCallIds: ["c1", "c2"],
    });
  });

  it("returns to streaming only after ALL pending tool results arrive", () => {
    const base: ConnectionFsmEvent[] = [
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "TOKEN_RECEIVED", streamId: "s1" },
      { type: "TOOL_CALL_RECEIVED", callId: "c1", streamId: "s1" },
      { type: "TOOL_CALL_RECEIVED", callId: "c2", streamId: "s1" },
    ];
    const afterOne = run([
      ...base,
      { type: "TOOL_RESULT_RECEIVED", callId: "c1", streamId: "s1" },
    ]);
    expect(afterOne.status).toBe("tool_call_pending");

    const afterBoth = run([
      ...base,
      { type: "TOOL_RESULT_RECEIVED", callId: "c1", streamId: "s1" },
      { type: "TOOL_RESULT_RECEIVED", callId: "c2", streamId: "s1" },
    ]);
    expect(afterBoth).toEqual({ status: "streaming", streamId: "s1" });
  });

  it("tokens during tool_call_pending do not clear the pending state", () => {
    const state = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "TOOL_CALL_RECEIVED", callId: "c1", streamId: "s1" },
      { type: "TOKEN_RECEIVED", streamId: "s1" },
    ]);
    expect(state.status).toBe("tool_call_pending");
  });

  it("drop mid-tool-call → reconnecting → resuming, indicator on throughout", () => {
    const dropped = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "TOOL_CALL_RECEIVED", callId: "c1", streamId: "s1" },
      { type: "RECONNECT_SCHEDULED", attempt: 1, retryInMs: 500 },
    ]);
    expect(dropped).toEqual({
      status: "reconnecting",
      attempt: 1,
      retryInMs: 500,
    });
    expect(isDisconnected(dropped)).toBe(true);

    const resuming = connectionReducer(dropped, {
      type: "SOCKET_OPEN",
      resumed: true,
    });
    expect(resuming).toEqual({ status: "resuming" });
    expect(isDisconnected(resuming)).toBe(true);

    const replaying = connectionReducer(resuming, {
      type: "TOOL_CALL_RECEIVED",
      callId: "c1",
      streamId: "s1",
    });
    expect(replaying.status).toBe("tool_call_pending");
    expect(isDisconnected(replaying)).toBe(false);
  });

  it("STREAM_ENDED returns streaming → connected only for the same stream", () => {
    const streaming: ConnectionState = { status: "streaming", streamId: "s1" };
    expect(
      connectionReducer(streaming, { type: "STREAM_ENDED", streamId: "s2" }),
    ).toEqual(streaming);
    expect(
      connectionReducer(streaming, { type: "STREAM_ENDED", streamId: "s1" }),
    ).toEqual({ status: "connected" });
  });

  it("SERVER_ERROR moves to error from any state", () => {
    const state = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "SERVER_ERROR", code: "E_FATAL", message: "boom" },
    ]);
    expect(state).toEqual({
      status: "error",
      code: "E_FATAL",
      message: "boom",
    });
  });

  it("CLOSED_BY_USER returns to idle", () => {
    const state = run([
      { type: "CONNECT_STARTED", attempt: 0 },
      { type: "SOCKET_OPEN", resumed: false },
      { type: "CLOSED_BY_USER" },
    ]);
    expect(state).toEqual({ status: "idle" });
  });
});
