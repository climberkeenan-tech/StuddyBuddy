import type { IpcApi, IpcEventMap } from '@studdybuddy/shared';

declare global {
  interface Window {
    studdybuddy: {
      api: IpcApi;
      events: {
        on<K extends keyof IpcEventMap>(
          event: K,
          handler: (payload: IpcEventMap[K]) => void,
        ): () => void;
      };
    };
  }
}

export {};
