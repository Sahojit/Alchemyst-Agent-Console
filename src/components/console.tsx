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
  const [contextFocus, setContextFocus] = useState<ContextFocusRequest | null>(
    null,
  );

  // The ONLY connection side effect in the component tree: start/stop the
  // session with the page lifecycle. Everything else is subscriptions.
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
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide">
          Alchemyst Agent Console
        </h1>
        <StatusPill state={connection} />
        <div className="ml-auto flex gap-1">
          <TabButton
            label="Timeline"
            active={sideTab === "timeline"}
            onClick={() =>
              setSideTab((cur) => (cur === "timeline" ? null : "timeline"))
            }
          />
          <TabButton
            label="Context"
            active={sideTab === "context"}
            onClick={() =>
              setSideTab((cur) => (cur === "context" ? null : "context"))
            }
          />
        </div>
      </header>

      <ConnectionBanner state={connection} />

      <div className="flex min-h-0 flex-1">
        <ChatPanel session={session} />
        {sideTab !== null && (
          <aside className="flex w-[26rem] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
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
  const { dot, label } = pillFor(state);
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function pillFor(state: ConnectionState): { dot: string; label: string } {
  switch (state.status) {
    case "idle":
      return { dot: "bg-zinc-600", label: "idle" };
    case "connecting":
      return { dot: "bg-amber-400 animate-pulse", label: "connecting" };
    case "connected":
      return { dot: "bg-emerald-400", label: "connected" };
    case "streaming":
      return { dot: "bg-emerald-400 animate-pulse", label: "streaming" };
    case "tool_call_pending":
      return {
        dot: "bg-sky-400 animate-pulse",
        label: `tool call pending (${state.pendingCallIds.length})`,
      };
    case "reconnecting":
      return { dot: "bg-rose-500 animate-pulse", label: "reconnecting" };
    case "resuming":
      return { dot: "bg-amber-400 animate-pulse", label: "resuming" };
    case "error":
      return { dot: "bg-rose-500", label: `error: ${state.code}` };
  }
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}
