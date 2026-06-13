"use client";

import { memo, useCallback } from "react";
import type { TokenSink } from "@/lib/session/token-sink";

/**
 * A streaming text segment. Renders a single stable <span> once and hands it
 * to the TokenSink; tokens are appended to that DOM node imperatively, so
 * this component NEVER re-renders while streaming. `memo` keys on segmentId
 * only — the `frozen` flag flip on TOOL_CALL deliberately does not reach it,
 * so freezing causes zero DOM mutation (no reflow, no flicker).
 */
export const TextSegmentView = memo(function TextSegmentView({
  segmentId,
  sink,
}: {
  segmentId: string;
  sink: TokenSink;
}) {
  const handleRef = useCallback(
    (el: HTMLSpanElement | null) => {
      if (el !== null) sink.attach(segmentId, el);
      else sink.detach(segmentId);
    },
    [segmentId, sink],
  );
  return <span ref={handleRef} className="whitespace-pre-wrap break-words" />;
});
