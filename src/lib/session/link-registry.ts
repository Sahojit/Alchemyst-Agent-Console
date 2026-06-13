/**
 * Bidirectional chat ↔ timeline linking (Task 2) without DOM queries.
 *
 * Chat elements register themselves under stable keys ("tool:<call_id>",
 * "stream:<stream_id>"); the timeline registers a scroller callback backed
 * by its virtualizer. Either side can then request focus on the other.
 */
export type ChatTargetKey = `tool:${string}` | `stream:${string}`;

export interface TimelineFocusRequest {
  callId: string;
}

export class LinkRegistry {
  private readonly chatTargets = new Map<ChatTargetKey, HTMLElement>();
  private timelineScroller: ((req: TimelineFocusRequest) => void) | null = null;

  registerChatTarget(key: ChatTargetKey, el: HTMLElement): () => void {
    this.chatTargets.set(key, el);
    return () => {
      if (this.chatTargets.get(key) === el) this.chatTargets.delete(key);
    };
  }

  /** Timeline → chat: scroll the chat element into view and flash it. */
  focusChat(key: ChatTargetKey): void {
    const el = this.chatTargets.get(key);
    if (el === undefined) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flash(el);
  }

  setTimelineScroller(fn: (req: TimelineFocusRequest) => void): () => void {
    this.timelineScroller = fn;
    return () => {
      if (this.timelineScroller === fn) this.timelineScroller = null;
    };
  }

  /** Chat → timeline: scroll the timeline to the TOOL_CALL row. */
  focusTimelineCall(callId: string): void {
    this.timelineScroller?.({ callId });
  }
}

function flash(el: HTMLElement): void {
  el.classList.remove("flash-highlight");
  // Force a style flush so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add("flash-highlight");
  window.setTimeout(() => el.classList.remove("flash-highlight"), 1600);
}
