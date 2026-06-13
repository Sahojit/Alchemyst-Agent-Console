/**
 * The incremental-rendering fast path for Task 1.
 *
 * Tokens NEVER flow through React state. Each text segment renders an empty
 * <span> once and registers it here; subsequent tokens are appended directly
 * to that DOM node via `Element.append(text)` (a true text-node append — no
 * re-render, no innerHTML reparse, no reflow of siblings).
 *
 * The full text is also accumulated per segment so that:
 *  - a segment that (re)mounts (tab switch, virtualization) is rehydrated
 *    with one `textContent` write and continues appending seamlessly, and
 *  - replayed/resumed streams stitch into existing DOM without jumps.
 */
export class TokenSink {
  private readonly texts = new Map<string, string>();
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly appendListeners = new Set<() => void>();

  append(segmentId: string, text: string): void {
    this.texts.set(segmentId, (this.texts.get(segmentId) ?? "") + text);
    this.nodes.get(segmentId)?.append(text);
    for (const listener of this.appendListeners) listener();
  }

  attach(segmentId: string, el: HTMLElement): void {
    this.nodes.set(segmentId, el);
    el.textContent = this.texts.get(segmentId) ?? "";
  }

  detach(segmentId: string): void {
    this.nodes.delete(segmentId);
  }

  text(segmentId: string): string {
    return this.texts.get(segmentId) ?? "";
  }

  /** Used by the chat panel to keep auto-scroll pinned during streaming. */
  onAppend(listener: () => void): () => void {
    this.appendListeners.add(listener);
    return () => {
      this.appendListeners.delete(listener);
    };
  }
}
