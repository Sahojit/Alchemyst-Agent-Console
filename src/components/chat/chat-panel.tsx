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

  useEffect(
    () =>
      session.chat.sink.onAppend(() => {
        if (pinnedRef.current) scrollToBottom();
      }),
    [session],
  );

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [chatState]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el === null) return;
          pinnedRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {chatState.messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-violet-500/30">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-violet-400">
                  <path d="M11 2L19.5 7V15L11 20L2.5 15V7L11 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <circle cx="11" cy="11" r="3" fill="currentColor" fillOpacity="0.6" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">Agent is ready</p>
                <p className="mt-1 text-xs text-zinc-600">
                  Send a message to start streaming. Try{" "}
                  <span className="font-mono text-violet-400">/drop</span>,{" "}
                  <span className="font-mono text-violet-400">/droptool</span>, or{" "}
                  <span className="font-mono text-violet-400">/error</span> for chaos.
                </p>
              </div>
            </div>
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
            ? "Connection is down — messages will be queued and sent after reconnect."
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
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-2.5 text-sm text-white shadow-lg shadow-violet-500/10">
            <span className="whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </span>
          </div>
        </div>
      );
    case "system":
      return (
        <div className="flex justify-center">
          <div
            className={
              message.level === "error"
                ? "flex items-center gap-2 rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-1.5 text-xs text-rose-300"
                : "flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-500"
            }
          >
            {message.level === "error" ? (
              <span className="text-rose-400">⚠</span>
            ) : (
              <span className="text-zinc-600">·</span>
            )}
            {message.text}
          </div>
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
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/30 to-indigo-500/30 ring-1 ring-violet-500/20">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-violet-400">
          <path d="M6 1L10.5 3.5V8.5L6 11L1.5 8.5V3.5L6 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="6" cy="6" r="1.5" fill="currentColor" fillOpacity="0.8" />
        </svg>
      </div>

      <div
        ref={containerRef}
        className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-zinc-800/60 bg-zinc-900/60 p-4 shadow-sm"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Agent
          </span>
          <span className="font-mono text-[10px] text-zinc-700">{message.streamId}</span>
          {!message.done && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              streaming
            </span>
          )}
        </div>
        <div className="text-sm leading-relaxed text-zinc-200">
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
      </div>
    </div>
  );
});
