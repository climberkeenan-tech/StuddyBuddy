import { ipcMain } from 'electron';
import {
  IPC_INVOKE_PREFIX,
  IPC_SURFACE,
  type AppError,
  type IpcApi,
} from '@studdybuddy/shared';
import { toAppError, type Logger } from '@studdybuddy/core';

/**
 * Registers every `<group>.<method>` from the shared IPC surface against the
 * given IpcApi implementation. Results travel in a { ok, value | error }
 * envelope so structured AppErrors (code, retryable…) survive the IPC
 * boundary — Electron would otherwise flatten rejections to a bare message.
 */
export type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: AppError };

export function registerIpcRouter(api: IpcApi, logger: Logger): void {
  for (const [group, methods] of Object.entries(IPC_SURFACE)) {
    for (const method of methods) {
      const channel = `${IPC_INVOKE_PREFIX}${group}.${method}`;
      const handler = (api as unknown as Record<string, Record<string, unknown>>)[group]?.[
        method
      ];
      if (typeof handler !== 'function') {
        // Surface drift between contract and implementation is a programmer
        // error — fail loudly at startup, not at first click.
        throw new Error(`IPC surface method not implemented: ${group}.${method}`);
      }
      const bound = (handler as (...a: unknown[]) => Promise<unknown>).bind(
        (api as unknown as Record<string, unknown>)[group],
      );
      ipcMain.handle(channel, async (_event, ...args): Promise<IpcEnvelope<unknown>> => {
        try {
          const value = await bound(...args);
          return { ok: true, value };
        } catch (e) {
          const appError = toAppError(e);
          logger.warn('ipc handler failed', {
            channel: `${group}.${method}`,
            code: appError.code,
            message: appError.message,
          });
          return { ok: false, error: appError };
        }
      });
    }
  }
  logger.info('ipc router registered', {
    channels: Object.values(IPC_SURFACE).reduce((n, m) => n + m.length, 0),
  });
}
