/**
 * Wire protocol types for the agent server at ws://localhost:4747/ws.
 *
 * Assumption (to verify against agent-server once present): every JSON frame
 * carries a `type` discriminator matching the message name. Parsing is
 * isolated in `parseServerMessage` so a different envelope is a local fix.
 */

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface TokenMessage {
  type: "TOKEN";
  seq: number;
  text: string;
  stream_id: string;
}

export interface ToolCallMessage {
  type: "TOOL_CALL";
  seq: number;
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  stream_id: string;
}

export interface ToolResultMessage {
  type: "TOOL_RESULT";
  seq: number;
  call_id: string;
  result: unknown;
  stream_id: string;
}

export interface ContextSnapshotMessage {
  type: "CONTEXT_SNAPSHOT";
  seq: number;
  context_id: string;
  data: unknown;
}

export interface PingMessage {
  type: "PING";
  seq: number;
  /** May be empty/missing on corrupt PINGs in chaos mode — echo verbatim. */
  challenge: unknown;
}

export interface StreamEndMessage {
  type: "STREAM_END";
  seq: number;
  stream_id: string;
}

export interface ServerErrorMessage {
  type: "ERROR";
  seq: number;
  code: string;
  message: string;
}

export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ServerErrorMessage;

export type ServerMessageType = ServerMessage["type"];

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "USER_MESSAGE"; content: string }
  | { type: "PONG"; echo: unknown }
  | { type: "RESUME"; last_seq: number }
  | { type: "TOOL_ACK"; call_id: string };

// ---------------------------------------------------------------------------
// Parsing / validation (the only place raw wire data is interpreted)
// ---------------------------------------------------------------------------

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "TOKEN",
  "TOOL_CALL",
  "TOOL_RESULT",
  "CONTEXT_SNAPSHOT",
  "PING",
  "STREAM_END",
  "ERROR",
] satisfies ServerMessageType[]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a decoded JSON value into a ServerMessage, or returns null.
 * Tolerant of extra fields; strict about `type` and a finite numeric `seq`.
 * Per-type required fields are checked where the app depends on them.
 */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) return null;
  const { type, seq } = value;
  if (typeof type !== "string" || !SERVER_MESSAGE_TYPES.has(type)) return null;
  if (typeof seq !== "number" || !Number.isFinite(seq)) return null;

  switch (type) {
    case "TOKEN":
      if (typeof value.text !== "string" || typeof value.stream_id !== "string")
        return null;
      break;
    case "TOOL_CALL":
      if (
        typeof value.call_id !== "string" ||
        typeof value.tool_name !== "string" ||
        typeof value.stream_id !== "string" ||
        !isRecord(value.args)
      )
        return null;
      break;
    case "TOOL_RESULT":
      if (typeof value.call_id !== "string" || typeof value.stream_id !== "string")
        return null;
      break;
    case "CONTEXT_SNAPSHOT":
      if (typeof value.context_id !== "string") return null;
      break;
    case "STREAM_END":
      if (typeof value.stream_id !== "string") return null;
      break;
    case "ERROR":
      if (typeof value.code !== "string" || typeof value.message !== "string")
        return null;
      break;
    case "PING":
      // `challenge` is intentionally unvalidated: chaos mode sends empty or
      // missing challenges and we must echo whatever is there without crashing.
      break;
  }

  // The per-type checks above guarantee the shape; the cast narrows the
  // validated record to the union without `any`.
  return value as unknown as ServerMessage;
}

/** Decodes a raw socket frame (string) into a ServerMessage, or null. */
export function decodeFrame(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  return parseServerMessage(json);
}

export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}
