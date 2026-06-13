import { ExternalStore } from "./external-store";
import { TokenSink } from "./token-sink";
import type {
  ServerMessage,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
  StreamEndMessage,
} from "@/lib/protocol/types";

export interface TextSegmentModel {
  kind: "text";
  id: string;
  /** Frozen segments never receive tokens again (Task 1 freeze semantics). */
  frozen: boolean;
}

export interface ToolSegmentModel {
  kind: "tool";
  id: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "waiting" | "done";
  result: unknown;
  /** TOOL_RESULT arrived without a prior TOOL_CALL (abandoned gap). */
  recovered: boolean;
}

export type SegmentModel = TextSegmentModel | ToolSegmentModel;

export type AgentMessageModel = {
  kind: "agent";
  id: string;
  streamId: string;
  segments: readonly SegmentModel[];
  done: boolean;
};

export type ChatMessageModel =
  | { kind: "user"; id: string; content: string }
  | { kind: "system"; id: string; level: "info" | "error"; text: string }
  | AgentMessageModel;

export interface ChatState {
  readonly messages: readonly ChatMessageModel[];
}

/**
 * Owns the chat transcript. Structural changes (new message, new segment,
 * tool status flips) go through React state; token text goes through the
 * TokenSink's imperative DOM append and causes NO state update.
 */
export class ChatStore {
  readonly store = new ExternalStore<ChatState>({ messages: [] });
  readonly sink = new TokenSink();
  private counter = 0;
  private readonly streamToMessage = new Map<string, string>();

  handleOrdered(msg: ServerMessage): void {
    switch (msg.type) {
      case "TOKEN":
        this.handleToken(msg);
        break;
      case "TOOL_CALL":
        this.handleToolCall(msg);
        break;
      case "TOOL_RESULT":
        this.handleToolResult(msg);
        break;
      case "STREAM_END":
        this.handleStreamEnd(msg);
        break;
      case "ERROR":
        this.addSystemNote("error", `Server error ${msg.code}: ${msg.message}`);
        break;
      case "CONTEXT_SNAPSHOT":
      case "PING":
        break; // not chat concerns
    }
  }

  addUserMessage(content: string): void {
    const message: ChatMessageModel = {
      kind: "user",
      id: this.nextId("user"),
      content,
    };
    this.store.update((s) => ({ messages: [...s.messages, message] }));
  }

  addSystemNote(level: "info" | "error", text: string): void {
    const message: ChatMessageModel = {
      kind: "system",
      id: this.nextId("sys"),
      level,
      text,
    };
    this.store.update((s) => ({ messages: [...s.messages, message] }));
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private ensureAgentMessage(streamId: string): string {
    const existing = this.streamToMessage.get(streamId);
    if (existing !== undefined) return existing;
    const id = this.nextId("agent");
    this.streamToMessage.set(streamId, id);
    const message: AgentMessageModel = {
      kind: "agent",
      id,
      streamId,
      segments: [],
      done: false,
    };
    this.store.update((s) => ({ messages: [...s.messages, message] }));
    return id;
  }

  private getAgentMessage(messageId: string): AgentMessageModel | undefined {
    return this.store
      .get()
      .messages.find(
        (m): m is AgentMessageModel => m.kind === "agent" && m.id === messageId,
      );
  }

  private updateAgentMessage(
    messageId: string,
    fn: (m: AgentMessageModel) => AgentMessageModel,
  ): void {
    this.store.update((s) => ({
      messages: s.messages.map((m) =>
        m.kind === "agent" && m.id === messageId ? fn(m) : m,
      ),
    }));
  }

  private handleToken(msg: TokenMessage): void {
    const messageId = this.ensureAgentMessage(msg.stream_id);
    const message = this.getAgentMessage(messageId);
    const last = message?.segments.at(-1);

    if (last !== undefined && last.kind === "text" && !last.frozen) {
      // Hot path: append straight into the live DOM node. No React update.
      this.sink.append(last.id, msg.text);
      return;
    }

    // After a tool card (or at stream start) tokens flow into a NEW segment;
    // the frozen segment before the card is never mutated again.
    const segmentId = this.nextId("seg");
    this.sink.append(segmentId, msg.text);
    this.updateAgentMessage(messageId, (m) => ({
      ...m,
      segments: [...m.segments, { kind: "text", id: segmentId, frozen: false }],
    }));
  }

  private handleToolCall(msg: ToolCallMessage): void {
    const messageId = this.ensureAgentMessage(msg.stream_id);
    const message = this.getAgentMessage(messageId);
    if (
      message?.segments.some(
        (seg) => seg.kind === "tool" && seg.callId === msg.call_id,
      )
    )
      return; // defensive: SequenceBuffer already dedups

    const card: ToolSegmentModel = {
      kind: "tool",
      id: this.nextId("seg"),
      callId: msg.call_id,
      toolName: msg.tool_name,
      args: msg.args,
      status: "waiting",
      result: undefined,
      recovered: false,
    };
    // Freeze the current text segment and stack the card below it in ONE
    // update — sequential tool calls each append their own card.
    this.updateAgentMessage(messageId, (m) => ({
      ...m,
      segments: [
        ...m.segments.map((seg) =>
          seg.kind === "text" ? { ...seg, frozen: true } : seg,
        ),
        card,
      ],
    }));
  }

  private handleToolResult(msg: ToolResultMessage): void {
    // Find the message owning this call_id (normally the current stream's).
    for (const message of this.store.get().messages) {
      if (message.kind !== "agent") continue;
      const target = message.segments.find(
        (seg): seg is ToolSegmentModel =>
          seg.kind === "tool" && seg.callId === msg.call_id,
      );
      if (target === undefined) continue;
      this.updateAgentMessage(message.id, (m) => ({
        ...m,
        segments: m.segments.map((seg) =>
          seg.kind === "tool" && seg.callId === msg.call_id
            ? { ...seg, status: "done" as const, result: msg.result }
            : seg,
        ),
      }));
      return;
    }

    // TOOL_CALL was lost to an abandoned gap: render a recovered card so the
    // result is still visible rather than silently dropped.
    const messageId = this.ensureAgentMessage(msg.stream_id);
    const card: ToolSegmentModel = {
      kind: "tool",
      id: this.nextId("seg"),
      callId: msg.call_id,
      toolName: "(unknown tool)",
      args: {},
      status: "done",
      result: msg.result,
      recovered: true,
    };
    this.updateAgentMessage(messageId, (m) => ({
      ...m,
      segments: [
        ...m.segments.map((seg) =>
          seg.kind === "text" ? { ...seg, frozen: true } : seg,
        ),
        card,
      ],
    }));
  }

  private handleStreamEnd(msg: StreamEndMessage): void {
    const messageId = this.streamToMessage.get(msg.stream_id);
    if (messageId === undefined) return;
    this.updateAgentMessage(messageId, (m) => ({
      ...m,
      done: true,
      segments: m.segments.map((seg) =>
        seg.kind === "text" ? { ...seg, frozen: true } : seg,
      ),
    }));
  }
}
