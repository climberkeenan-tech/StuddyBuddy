import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_EVENT_PREFIX,
  IPC_INVOKE_PREFIX,
  IPC_SURFACE,
  type IpcApi,
  type IpcEventMap,
} from '@studdybuddy/shared';

/**
 * Builds the typed `window.studdybuddy` bridge from the shared IPC_SURFACE
 * table. No per-method boilerplate: adding a method to the contract (types +
 * surface table) is all that's needed on this side.
 */

type EventName = keyof IpcEventMap;

type Envelope =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable?: boolean } };

function buildApi(): IpcApi {
  const api = {} as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
  for (const [group, methods] of Object.entries(IPC_SURFACE)) {
    api[group] = {};
    for (const method of methods) {
      const channel = `${IPC_INVOKE_PREFIX}${group}.${method}`;
      api[group][method] = async (...args: unknown[]) => {
        const envelope = (await ipcRenderer.invoke(channel, ...args)) as Envelope;
        if (envelope.ok) return envelope.value;
        // Rehydrate the structured AppError so the UI can branch on .code.
        throw Object.assign(new Error(envelope.error.message), envelope.error);
      };
    }
  }
  return api as unknown as IpcApi;
}

const bridge = {
  api: buildApi(),
  events: {
    on<K extends EventName>(event: K, handler: (payload: IpcEventMap[K]) => void): () => void {
      const channel = `${IPC_EVENT_PREFIX}${String(event)}`;
      const listener = (_e: Electron.IpcRendererEvent, payload: IpcEventMap[K]) =>
        handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
};

export type StuddyBuddyBridge = typeof bridge;

contextBridge.exposeInMainWorld('studdybuddy', bridge);
