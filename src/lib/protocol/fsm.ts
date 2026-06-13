/**
 * Connection/session finite state machine.
 *
 * Hand-rolled (discriminated union + pure reducer) rather than XState:
 * the state space is small (8 states), a pure reducer plugs directly into
 * React's useReducer with zero dependencies, exhaustiveness is enforced by
 * TypeScript's narrowing on the `status` tag, and every transition is a
 * trivially unit-testable pure function. XState would add a runtime,
 * actors, and its own event vocabulary for no extra safety here.
 *
 * The FSM is deliberately *derived* state: ConnectionManager and
 * SequenceBuffer own the side effects; the FSM only summarizes them so the
 * UI (Task 1 freeze/resume, Task 4 drop indicator) renders from one value.
 */

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "streaming"; streamId: string }
  | {
      status: "tool_call_pending";
      streamId: string;
      /** Rapid double TOOL_CALLs stack here until their TOOL_RESULTs land. */
      pendingCallIds: readonly string[];
    }
  | { status: "reconnecting"; attempt: number; retryInMs: number }
  | { status: "resuming" }
  | { status: "error"; code: string; message: string };

export type ConnectionFsmEvent =
  // Lifecycle (from ConnectionManager events)
  | { type: "CONNECT_STARTED"; attempt: number }
  | { type: "SOCKET_OPEN"; resumed: boolean }
  | { type: "RECONNECT_SCHEDULED"; attempt: number; retryInMs: number }
  | { type: "CLOSED_BY_USER" }
  // Ordered protocol messages (from SequenceBuffer output)
  | { type: "TOKEN_RECEIVED"; streamId: string }
  | { type: "TOOL_CALL_RECEIVED"; callId: string; streamId: string }
  | { type: "TOOL_RESULT_RECEIVED"; callId: string; streamId: string }
  | { type: "STREAM_ENDED"; streamId: string }
  | { type: "SERVER_ERROR"; code: string; message: string };

export const INITIAL_CONNECTION_STATE: ConnectionState = { status: "idle" };

export function connectionReducer(
  state: ConnectionState,
  event: ConnectionFsmEvent,
): ConnectionState {
  switch (event.type) {
    case "CONNECT_STARTED":
      return { status: "connecting", attempt: event.attempt };

    case "SOCKET_OPEN":
      // After a resume the server replays history; we stay in `resuming`
      // until ordered messages start flowing again (handled below).
      return event.resumed ? { status: "resuming" } : { status: "connected" };

    case "RECONNECT_SCHEDULED":
      return {
        status: "reconnecting",
        attempt: event.attempt,
        retryInMs: event.retryInMs,
      };

    case "CLOSED_BY_USER":
      return { status: "idle" };

    case "TOKEN_RECEIVED":
      // tool_call_pending wins over streaming: tokens may keep flowing for
      // other segments, but the UI must keep showing the pending tool call.
      if (state.status === "tool_call_pending") return state;
      if (state.status === "reconnecting") return state; // late buffer drain
      return { status: "streaming", streamId: event.streamId };

    case "TOOL_CALL_RECEIVED":
      if (state.status === "tool_call_pending") {
        if (state.pendingCallIds.includes(event.callId)) return state;
        return {
          ...state,
          pendingCallIds: [...state.pendingCallIds, event.callId],
        };
      }
      if (state.status === "reconnecting") return state;
      return {
        status: "tool_call_pending",
        streamId: event.streamId,
        pendingCallIds: [event.callId],
      };

    case "TOOL_RESULT_RECEIVED": {
      if (state.status !== "tool_call_pending") return state;
      const remaining = state.pendingCallIds.filter(
        (id) => id !== event.callId,
      );
      if (remaining.length > 0)
        return { ...state, pendingCallIds: remaining };
      return { status: "streaming", streamId: state.streamId };
    }

    case "STREAM_ENDED":
      if (state.status === "streaming" && state.streamId === event.streamId)
        return { status: "connected" };
      if (state.status === "resuming") return { status: "connected" };
      return state;

    case "SERVER_ERROR":
      return { status: "error", code: event.code, message: event.message };
  }
}

/** True when the UI should show the connection-drop indicator (Task 4). */
export function isDisconnected(state: ConnectionState): boolean {
  return (
    state.status === "connecting" ||
    state.status === "reconnecting" ||
    state.status === "resuming"
  );
}
