"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "@/lib/protocol/fsm";

export function ConnectionBanner({ state }: { state: ConnectionState }) {
  const deadline = useMemo(
    () =>
      state.status === "reconnecting" ? Date.now() + state.retryInMs : null,
    [state],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [deadline]);

  switch (state.status) {
    case "reconnecting": {
      const remaining = Math.max(0, (deadline ?? now) - now);
      return (
        <div className="flex shrink-0 items-center justify-center gap-2.5 border-b border-rose-900/40 bg-rose-950/30 px-4 py-2 text-xs text-rose-300 backdrop-blur-sm">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
          <span>
            Connection lost — retrying in{" "}
            <span className="font-mono font-semibold">{(remaining / 1000).toFixed(1)}s</span>{" "}
            <span className="text-rose-500">(attempt {state.attempt})</span>
          </span>
          <span className="ml-2 text-rose-600">·</span>
          <span className="text-rose-400/70">Messages are queued</span>
        </div>
      );
    }
    case "resuming":
      return (
        <div className="flex shrink-0 items-center justify-center gap-2.5 border-b border-amber-900/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-300 backdrop-blur-sm">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="animate-spin">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
            <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Reconnected — replaying missed events via RESUME…
        </div>
      );
    case "connecting":
      return (
        <div className="flex shrink-0 items-center justify-center gap-2.5 border-b border-zinc-800/60 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-500 backdrop-blur-sm">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
          Connecting to agent at ws://localhost:4747/ws…
        </div>
      );
    case "error":
      return (
        <div className="flex shrink-0 items-center justify-center gap-2.5 border-b border-rose-900/40 bg-rose-950/30 px-4 py-2 text-xs text-rose-300 backdrop-blur-sm">
          <span>⚠</span>
          <span>
            Server error{" "}
            <span className="font-mono font-semibold">{state.code}</span>:{" "}
            {state.message}
          </span>
        </div>
      );
    default:
      return null;
  }
}
