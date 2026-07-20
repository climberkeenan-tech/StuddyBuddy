/**
 * Minimal typed pub/sub used for in-process domain events
 * (transcript segments, job progress, achievements…).
 */
export type Unsubscribe = () => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set?.delete(handler as (payload: never) => void);
  }

  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as (p: Events[K]) => void)(payload);
      } catch {
        // Listeners must not break emitters; errors are the listener's concern.
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
