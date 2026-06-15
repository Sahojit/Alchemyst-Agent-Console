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
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/95 px-4 py-2.5 backdrop-blur-sm">
        {/* Logo mark */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1L12.5 4V10L7 13L1.5 10V4L7 1Z"
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <circle cx="7" cy="7" r="2" fill="white" fillOpacity="0.9" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
              Alchemyst
            </h1>
            <p className="text-[10px] leading-none text-zinc-500">Agent Console</p>
          </div>
        </div>

        <div className="mx-3 h-4 w-px bg-zinc-800" />
        <StatusPill state={connection} />

        <div className="ml-auto flex items-center gap-1">
          <TabButton
            label="Timeline"
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 3h10M1 6h7M1 9h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            }
            active={sideTab === "timeline"}
            onClick={() => setSideTab((cur) => (cur === "timeline" ? null : "timeline"))}
          />
          <TabButton
            label="Context"
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <rect x="6.5" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="6.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <rect x="6.5" y="6.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            }
            active={sideTab === "context"}
            onClick={() => setSideTab((cur) => (cur === "context" ? null : "context"))}
          />
        </div>
      </header>

      <ConnectionBanner state={connection} />

      <div className="flex min-h-0 flex-1">
        <ChatPanel session={session} />
        {sideTab !== null && (
          <aside className="flex w-[27rem] shrink-0 flex-col border-l border-zinc-800/80 bg-zinc-950">
            <div className="flex shrink-0 items-center border-b border-zinc-800/80 px-3 py-2">
              <span className="text-xs font-medium text-zinc-400">
                {sideTab === "timeline" ? "Event Timeline" : "Context Inspector"}
              </span>
            </div>
            {sideTab === "timeline" ? (
              <TimelinePanel
                session={session}
                onOpenContext={(req) => {
                  setContextFocus(req);
                  setSideTab("context");
                }}
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
  const { dot, label, variant } = pillFor(state);
  const variantClass =
    variant === "green"
      ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
      : variant === "amber"
        ? "border-amber-800/60 bg-amber-950/40 text-amber-300"
        : variant === "red"
          ? "border-rose-800/60 bg-rose-950/40 text-rose-300"
          : variant === "blue"
            ? "border-sky-800/60 bg-sky-950/40 text-sky-300"
            : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400";

  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${variantClass}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function pillFor(
  state: ConnectionState,
): { dot: string; label: string; variant: "green" | "amber" | "red" | "blue" | "gray" } {
  switch (state.status) {
    case "idle":
      return { dot: "bg-zinc-600", label: "Idle", variant: "gray" };
    case "connecting":
      return { dot: "bg-amber-400 animate-pulse", label: "Connecting…", variant: "amber" };
    case "connected":
      return { dot: "bg-emerald-400", label: "Connected", variant: "green" };
    case "streaming":
      return { dot: "bg-emerald-400 animate-pulse", label: "Streaming", variant: "green" };
    case "tool_call_pending":
      return {
        dot: "bg-sky-400 animate-pulse",
        label: `Tool call ×${state.pendingCallIds.length}`,
        variant: "blue",
      };
    case "reconnecting":
      return { dot: "bg-rose-500 animate-pulse", label: "Reconnecting…", variant: "red" };
    case "resuming":
      return { dot: "bg-amber-400 animate-pulse", label: "Resuming…", variant: "amber" };
    case "error":
      return { dot: "bg-rose-500", label: `Error: ${state.code}`, variant: "red" };
  }
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-100 shadow-sm"
          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
