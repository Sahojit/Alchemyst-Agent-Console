"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ConnectionState } from "@/lib/protocol/fsm";
import { createConsoleSession } from "@/lib/session/console-session";
import { ChatPanel } from "./chat/chat-panel";
import { ContextPanel } from "./context/context-panel";
import { ConnectionBanner } from "./status/connection-banner";
import {
  TimelinePanel,
  type ContextFocusRequest,
} from "./timeline/timeline-panel";

type SideTab = "timeline" | "context";

export function Console() {
  const [session] = useState(() => createConsoleSession());
  const [sideTab, setSideTab] = useState<SideTab | null>("timeline");
  const [contextFocus, setContextFocus] = useState<ContextFocusRequest | null>(null);

  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  const connection = useSyncExternalStore(
    session.connection.subscribe,
    session.connection.get,
    session.connection.get,
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#080809]/90 px-4 py-2.5 backdrop-blur-xl">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-7 w-7 items-center justify-center">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 opacity-90 shadow-lg shadow-violet-500/30" />
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="relative z-10">
              <path d="M7 1.5L11.5 4V10L7 12.5L2.5 10V4L7 1.5Z" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
              <circle cx="7" cy="7" r="1.8" fill="white" fillOpacity="0.95" />
            </svg>
          </div>
          <div className="leading-none">
            <div className="text-[13px] font-semibold tracking-tight text-white">Alchemyst</div>
            <div className="text-[10px] text-zinc-500">Agent Console</div>
          </div>
        </div>

        <div className="mx-2 h-4 w-px bg-white/10" />
        <StatusPill state={connection} />

        <div className="ml-auto flex items-center gap-1">
          <TabButton label="Timeline" icon="⟵" active={sideTab === "timeline"}
            onClick={() => setSideTab((c) => c === "timeline" ? null : "timeline")} />
          <TabButton label="Context" icon="◈" active={sideTab === "context"}
            onClick={() => setSideTab((c) => c === "context" ? null : "context")} />
        </div>
      </header>

      <ConnectionBanner state={connection} />

      <div className="flex min-h-0 flex-1">
        <ChatPanel session={session} />

        {sideTab !== null && (
          <aside className="flex w-[28rem] shrink-0 flex-col border-l border-white/[0.06] bg-[#080809]/60 backdrop-blur-sm">
            {/* Panel header */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                {sideTab === "timeline" ? "Event Timeline" : "Context Inspector"}
              </span>
              <button
                type="button"
                onClick={() => setSideTab(null)}
                className="flex h-5 w-5 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {sideTab === "timeline" ? (
              <TimelinePanel
                session={session}
                onOpenContext={(req) => { setContextFocus(req); setSideTab("context"); }}
              />
            ) : (
              <ContextPanel session={session} focus={contextFocus} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: ConnectionState }) {
  const { dot, label, cls } = pillFor(state);
  return (
    <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function pillFor(state: ConnectionState) {
  switch (state.status) {
    case "idle":
      return { dot: "bg-zinc-600", label: "Idle", cls: "border-zinc-800 bg-zinc-900/60 text-zinc-500" };
    case "connecting":
      return { dot: "bg-amber-400 animate-pulse", label: "Connecting…", cls: "border-amber-900/50 bg-amber-950/30 text-amber-400" };
    case "connected":
      return { dot: "bg-emerald-400", label: "Connected", cls: "border-emerald-900/50 bg-emerald-950/30 text-emerald-400" };
    case "streaming":
      return { dot: "bg-emerald-400 animate-pulse", label: "Streaming", cls: "border-emerald-900/50 bg-emerald-950/30 text-emerald-400" };
    case "tool_call_pending":
      return { dot: "bg-sky-400 animate-pulse", label: `Tool ×${state.pendingCallIds.length}`, cls: "border-sky-900/50 bg-sky-950/30 text-sky-400" };
    case "reconnecting":
      return { dot: "bg-rose-500 animate-pulse", label: "Reconnecting…", cls: "border-rose-900/50 bg-rose-950/30 text-rose-400" };
    case "resuming":
      return { dot: "bg-amber-400 animate-pulse", label: "Resuming…", cls: "border-amber-900/50 bg-amber-950/30 text-amber-400" };
    case "error":
      return { dot: "bg-rose-500", label: `Error: ${state.code}`, cls: "border-rose-900/50 bg-rose-950/30 text-rose-400" };
  }
}

function TabButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
        active
          ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
          : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      }`}
    >
      <span className="text-[10px] opacity-60">{icon}</span>
      {label}
    </button>
  );
}
