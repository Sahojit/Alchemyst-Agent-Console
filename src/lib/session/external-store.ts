/**
 * Minimal external store compatible with React's useSyncExternalStore.
 * Protocol/session classes mutate these; components subscribe with
 * `useSyncExternalStore(store.subscribe, store.get, store.get)` — no
 * useEffect-based state mirroring anywhere.
 */
export class ExternalStore<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  /** Stable identity (arrow) so it can be passed straight to React. */
  get = (): T => this.value;

  /** Stable identity (arrow) so it can be passed straight to React. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.value));
  }
}
