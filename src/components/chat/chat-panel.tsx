"use client";

import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import type { AgentMessageModel, ChatMessageModel } from "@/lib/session/chat-store";
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

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => session.chat.sink.onAppend(() => { if (pinnedRef.current) scrollToBottom(); }), [session]);
  useEffect(() => { if (pinnedRef.current) scrollToBottom(); }, [chatState]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {chatState.messages.length === 0 ? (
            <EmptyState />
          ) : (
            chatState.messages.map((msg) => (
              <MessageView key={msg.id} message={msg} session={session} />
            ))
          )}
        </div>
      </div>
      <Composer
        onSend={session.sendUserMessage}
        hint={isDisconnected(connection) ? "Disconnected — messages are queued and will send on reconnect." : null}
      />
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-violet-500/20 blur-xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 ring-1 ring-violet-500/30">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-violet-400">
            <path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3.5" fill="currentColor" fillOpacity="0.5" />
          </svg>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-zinc-200">Agent is ready</p>
        <p className="max-w-xs text-xs leading-relaxed text-zinc-600">
          Send a message to start streaming. Use{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-violet-400">/drop</code>,{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-violet-400">/droptool</code>, or{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-violet-400">/error</code> to test chaos recovery.
        </p>
      </div>
    </div>
  );
}

const MessageView = memo(function MessageView({ message, session }: { message: ChatMessageModel; session: ConsoleSession }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="group relative max-w-[78%]">
            <div className="absolute inset-0 rounded-2xl rounded-tr-md bg-gradient-to-br from-violet-600/30 to-indigo-600/30 blur-sm" />
            <div className="relative rounded-2xl rounded-tr-md bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-2.5 text-[13px] leading-relaxed text-white shadow-lg shadow-violet-900/30">
              <span className="whitespace-pre-wrap break-words">{message.content}</span>
            </div>
          </div>
        </div>
      );
    case "system":
      return (
        <div className="flex justify-center">
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${
            message.level === "error"
              ? "border-rose-800/40 bg-rose-950/30 text-rose-400"
              : "border-white/[0.06] bg-white/[0.03] text-zinc-500"
          }`}>
            {message.level === "error" && <span className="text-rose-500">⚠</span>}
            {message.text}
          </div>
        </div>
      );
    case "agent":
      return <AgentMessageView message={message} session={session} />;
  }
});

const AgentMessageView = memo(function AgentMessageView({ message, session }: { message: AgentMessageModel; session: ConsoleSession }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return session.links.registerChatTarget(`stream:${message.streamId}`, el);
  }, [session, message.streamId]);

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="relative mt-0.5 shrink-0">
        <div className="absolute inset-0 rounded-xl bg-violet-500/20 blur-sm" />
        <div className="relative flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-indigo-500/20 ring-1 ring-violet-500/25">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-violet-300">
            <path d="M6 1L10.5 3.5V8.5L6 11L1.5 8.5V3.5L6 1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            <circle cx="6" cy="6" r="1.5" fill="currentColor" fillOpacity="0.8" />
          </svg>
        </div>
      </div>

      {/* Message card */}
      <div ref={containerRef} className="group min-w-0 flex-1">
        <div className="overflow-hidden rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.03] shadow-xl shadow-black/20 backdrop-blur-sm">
          {/* Card header */}
          <div className="flex items-center gap-2.5 border-b border-white/[0.05] px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Agent</span>
            <span className="h-3 w-px bg-white/10" />
            <span className="font-mono text-[10px] text-zinc-700">{message.streamId}</span>
            {!message.done && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="inline-block h-1 w-1 animate-bounce rounded-full bg-emerald-400"
                      style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                    />
                  ))}
                </span>
                <span className="text-[10px] text-emerald-500">streaming</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="px-4 py-3 text-[13px] leading-7 text-zinc-200">
            {message.segments.map((seg) =>
              seg.kind === "text" ? (
                <TextSegmentView key={seg.id} segmentId={seg.id} sink={session.chat.sink} />
              ) : (
                <ToolCardView key={seg.id} segment={seg} links={session.links} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
