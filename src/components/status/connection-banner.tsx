"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "@/lib/protocol/fsm";

export function ConnectionBanner({ state }: { state: ConnectionState }) {
  const deadline = useMemo(
    () => state.status === "reconnecting" ? Date.now() + state.retryInMs : null,
    [state],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadline]);

  switch (state.status) {
    case "reconnecting": {
      const remaining = Math.max(0, (deadline ?? now) - now);
      return (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-rose-900/30 bg-rose-950/20 px-4 py-2 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
          <span className="text-[12px] text-rose-400">
            Connection lost — retrying in{" "}
            <span className="font-mono font-semibold text-rose-300">{(remaining / 1000).toFixed(1)}s</span>
            <span className="ml-2 text-rose-600">· attempt {state.attempt} · messages are queued</span>
          </span>
        </div>
      );
    }
    case "resuming":
      return (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-amber-900/30 bg-amber-950/20 px-4 py-2 backdrop-blur-sm">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="animate-spin text-amber-400" style={{ animationDuration: "1s" }}>
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.25" />
            <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="text-[12px] text-amber-400">
            Reconnected — replaying missed events via <span className="font-mono font-semibold text-amber-300">RESUME</span>…
          </span>
        </div>
      );
    case "connecting":
      return (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-white/[0.04] bg-white/[0.02] px-4 py-2 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
          <span className="text-[12px] text-zinc-500">Connecting to agent…</span>
        </div>
      );
    case "error":
      return (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-rose-900/30 bg-rose-950/20 px-4 py-2 backdrop-blur-sm">
          <span className="text-rose-500">⚠</span>
          <span className="text-[12px] text-rose-400">
            Server error <span className="font-mono font-semibold">{state.code}</span>: {state.message}
          </span>
        </div>
      );
    default:
      return null;
  }
}
