"use client";

import {
  memo,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type {
  AgentMessageModel,
  ChatMessageModel,
} from "@/lib/session/chat-store";
import type { ConsoleSession } from "@/lib/session/console-session";
import { isDisconnected } from "@/lib/protocol/fsm";
import { Composer } from "./composer";
import { TextSegmentView } from "./text-segment";
import { ToolCardView } from "./tool-card";

export function ChatPanel({ session }: { session: ConsoleSession }) {
  const chatState = useSyncExternalStore(
    session.chat.store.subscribe,
    session.chat.store.get,
    session.chat.store.get,
  );
  const connection = useSyncExternalStore(
    session.connection.subscribe,
    session.connection.get,
    session.connection.get,
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  };

  // Keep the view pinned while tokens stream — token appends bypass React,
  // so we follow the TokenSink directly instead of re-render effects.
  useEffect(
    () =>
      session.chat.sink.onAppend(() => {
        if (pinnedRef.current) scrollToBottom();
      }),
    [session],
  );

  // Structural changes (new messages/cards) also keep the pin.
  useEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [chatState]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el === null) return;
          pinnedRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {chatState.messages.length === 0 && (
            <p className="py-12 text-center text-sm text-zinc-600">
              Send a message to start a stream.
            </p>
          )}
          {chatState.messages.map((message) => (
            <MessageView key={message.id} message={message} session={session} />
          ))}
        </div>
      </div>
      <Composer
        onSend={session.sendUserMessage}
        hint={
          isDisconnected(connection)
            ? "Connection is down — your message will be queued and sent after reconnect."
            : null
        }
      />
    </section>
  );
}

const MessageView = memo(function MessageView({
  message,
  session,
}: {
  message: ChatMessageModel;
  session: ConsoleSession;
}) {
  switch (message.kind) {
    case "user":
      return (
        <div className="self-end rounded-lg bg-sky-700 px-3 py-2 text-sm text-white">
          <span className="whitespace-pre-wrap break-words">
            {message.content}
          </span>
        </div>
      );
    case "system":
      return (
        <div
          className={
            message.level === "error"
              ? "self-center rounded border border-rose-900 bg-rose-950/50 px-3 py-1 text-xs text-rose-300"
              : "self-center rounded border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400"
          }
        >
          {message.text}
        </div>
      );
    case "agent":
      return <AgentMessageView message={message} session={session} />;
  }
});

const AgentMessageView = memo(function AgentMessageView({
  message,
  session,
}: {
  message: AgentMessageModel;
  session: ConsoleSession;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    return session.links.registerChatTarget(`stream:${message.streamId}`, el);
  }, [session, message.streamId]);

  return (
    <div
      ref={containerRef}
      className="max-w-full self-start rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm leading-relaxed"
    >
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
        <span>agent</span>
        <span>·</span>
        <span>{message.streamId}</span>
        {!message.done && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        )}
      </div>
      {/* Segment list is append-only: text segments freeze in place when a
          tool card lands below them, and post-result tokens always open a
          NEW segment — earlier DOM is never restructured. */}
      {message.segments.map((segment) =>
        segment.kind === "text" ? (
          <TextSegmentView
            key={segment.id}
            segmentId={segment.id}
            sink={session.chat.sink}
          />
        ) : (
          <ToolCardView
            key={segment.id}
            segment={segment}
            links={session.links}
          />
        ),
      )}
    </div>
  );
});
