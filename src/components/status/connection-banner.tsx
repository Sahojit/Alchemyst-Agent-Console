"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "@/lib/protocol/fsm";

/**
 * Task 4 drop indicator. FSM dispatch is synchronous with the socket close
 * event, so this renders well within the 500ms budget. The banner overlays
 * nothing — chat stays scrollable and the composer stays usable (sends are
 * queued by ConnectionManager while down).
 */
export function ConnectionBanner({ state }: { state: ConnectionState }) {
  // Capture the retry deadline once per reconnecting-state instance.
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
        <div className="border-b border-rose-900 bg-rose-950/80 px-4 py-1.5 text-center text-xs text-rose-200">
          ⚡ Connection lost — retrying in {(remaining / 1000).toFixed(1)}s
          (attempt {state.attempt}). Chat stays interactive; messages are
          queued.
        </div>
      );
    }
    case "resuming":
      return (
        <div className="border-b border-amber-900 bg-amber-950/80 px-4 py-1.5 text-center text-xs text-amber-200">
          ↻ Reconnected — RESUME sent, stitching replayed events…
        </div>
      );
    case "connecting":
      return (
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-1.5 text-center text-xs text-zinc-400">
          Connecting to agent…
        </div>
      );
    case "error":
      return (
        <div className="border-b border-rose-900 bg-rose-950/80 px-4 py-1.5 text-center text-xs text-rose-200">
          Server error {state.code}: {state.message}
        </div>
      );
    default:
      return null;
  }
}
