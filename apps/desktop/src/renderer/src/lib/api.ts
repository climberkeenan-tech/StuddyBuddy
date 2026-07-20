import type { IpcApi, IpcEventMap } from '@studdybuddy/shared';
import { createMockApi } from './mock-api';

/**
 * The single entry point every renderer feature uses to reach the backend.
 *
 * In Electron, `window.studdybuddy` is injected by the preload bridge and we
 * pass calls straight through. In the browser and under vitest that global is
 * absent, so we fall back to a complete in-memory {@link createMockApi} mock and
 * a local event emitter — the UI behaves identically in both worlds.
 */

type Handler<K extends keyof IpcEventMap> = (payload: IpcEventMap[K]) => void;

const bridge = typeof window !== 'undefined' ? window.studdybuddy : undefined;
const isMock = !bridge;

/** Local pub/sub used only in mock/browser mode. */
const listeners = new Map<keyof IpcEventMap, Set<Handler<never>>>();

function emitLocal<K extends keyof IpcEventMap>(event: K, payload: IpcEventMap[K]): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of [...set]) (handler as Handler<K>)(payload);
}

/** The mock backend, created once and wired to the local emitter. */
const mockApi: IpcApi = createMockApi(emitLocal);

/** Typed backend surface. Every method rejects with an `Error` carrying `.code`. */
export const api: IpcApi = bridge?.api ?? mockApi;

/** True when running against the in-memory mock (browser preview / tests). */
export const usingMockApi = isMock;

/**
 * Subscribe to a backend push event. Returns an unsubscribe function; call it
 * from a cleanup effect. Works against both the Electron bridge and the mock.
 */
export function onEvent<K extends keyof IpcEventMap>(event: K, handler: Handler<K>): () => void {
  if (bridge) {
    return bridge.events.on(event, handler);
  }
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as Handler<never>);
  return () => {
    set?.delete(handler as Handler<never>);
  };
}

/**
 * Dispatch a fake backend event through the local emitter. Used by the mock
 * backend internally and available to tests that need to simulate push events.
 * A no-op when running against the real Electron bridge.
 */
export function triggerMockEvent<K extends keyof IpcEventMap>(event: K, payload: IpcEventMap[K]): void {
  if (bridge) return;
  emitLocal(event, payload);
}
