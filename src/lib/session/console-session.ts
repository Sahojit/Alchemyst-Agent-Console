import { ConnectionManager } from "@/lib/protocol/connection-manager";
import { SequenceBuffer } from "@/lib/protocol/sequence-buffer";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionFsmEvent,
  type ConnectionState,
} from "@/lib/protocol/fsm";
import type { ServerMessage } from "@/lib/protocol/types";
import { ChatStore } from "./chat-store";
import { ContextStore } from "./context-store";
import { ExternalStore } from "./external-store";
import { LinkRegistry } from "./link-registry";
import { TimelineStore } from "./timeline-store";

export const AGENT_WS_URL = "ws://localhost:4747/ws";

export interface ConsoleSession {
  readonly chat: ChatStore;
  readonly timeline: TimelineStore;
  readonly context: ContextStore;
  readonly links: LinkRegistry;
  readonly connection: ExternalStore<ConnectionState>;
  start(): void;
  stop(): void;
  sendUserMessage(content: string): void;
}

/**
 * Composition root: raw socket frames → ConnectionManager (fast-path
 * PONG/TOOL_ACK) → SequenceBuffer (dedup/reorder) → ordered fan-out to the
 * chat, timeline, and context stores plus the connection FSM. All side
 * effects live here and in ConnectionManager — components only subscribe.
 */
export function createConsoleSession(url: string = AGENT_WS_URL): ConsoleSession {
  const chat = new ChatStore();
  const timeline = new TimelineStore();
  const context = new ContextStore();
  const links = new LinkRegistry();
  const connection = new ExternalStore<ConnectionState>(
    INITIAL_CONNECTION_STATE,
  );

  const dispatch = (event: ConnectionFsmEvent): void => {
    connection.update((state) => connectionReducer(state, event));
  };

  const dispatchForMessage = (msg: ServerMessage): void => {
    switch (msg.type) {
      case "TOKEN":
        dispatch({ type: "TOKEN_RECEIVED", streamId: msg.stream_id });
        break;
      case "TOOL_CALL":
        dispatch({
          type: "TOOL_CALL_RECEIVED",
          callId: msg.call_id,
          streamId: msg.stream_id,
        });
        break;
      case "TOOL_RESULT":
        dispatch({
          type: "TOOL_RESULT_RECEIVED",
          callId: msg.call_id,
          streamId: msg.stream_id,
        });
        break;
      case "STREAM_END":
        dispatch({ type: "STREAM_ENDED", streamId: msg.stream_id });
        break;
      case "ERROR":
        dispatch({ type: "SERVER_ERROR", code: msg.code, message: msg.message });
        break;
      case "CONTEXT_SNAPSHOT":
      case "PING":
        break;
    }
  };

  const buffer = new SequenceBuffer({
    onMessage: (msg) => {
      dispatchForMessage(msg);
      chat.handleOrdered(msg);
      timeline.handleOrdered(msg);
      context.handleOrdered(msg);
    },
    onGap: (gap) => {
      timeline.addConnectionNote(
        `Abandoned gap: seq ${gap.from}–${gap.to} never arrived`,
      );
      chat.addSystemNote(
        "info",
        `Skipped missing events (seq ${gap.from}–${gap.to}) after timeout.`,
      );
    },
  });

  const manager = new ConnectionManager({
    url,
    getResumeSeq: () => buffer.highestProcessedSeq,
    onMessage: (msg) => buffer.ingest(msg),
    onEvent: (ev) => {
      switch (ev.type) {
        case "connecting":
          dispatch({ type: "CONNECT_STARTED", attempt: ev.attempt });
          break;
        case "open":
          dispatch({ type: "SOCKET_OPEN", resumed: ev.resumed });
          timeline.addConnectionNote(
            ev.resumed
              ? `Reconnected — sent RESUME { last_seq: ${buffer.highestProcessedSeq} }`
              : "Connected",
          );
          break;
        case "reconnect_scheduled":
          dispatch({
            type: "RECONNECT_SCHEDULED",
            attempt: ev.attempt,
            retryInMs: ev.delayMs,
          });
          timeline.addConnectionNote(
            `Connection lost — retry #${ev.attempt} in ${ev.delayMs}ms`,
          );
          break;
        case "closed_by_user":
          dispatch({ type: "CLOSED_BY_USER" });
          break;
      }
    },
  });

  return {
    chat,
    timeline,
    context,
    links,
    connection,
    start: () => manager.connect(),
    stop: () => {
      manager.close();
      buffer.dispose();
      timeline.dispose();
    },
    sendUserMessage: (content) => {
      const trimmed = content.trim();
      if (trimmed === "") return;
      chat.addUserMessage(trimmed);
      manager.send({ type: "USER_MESSAGE", content: trimmed });
    },
  };
}
