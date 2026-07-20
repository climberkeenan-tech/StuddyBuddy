import path from 'node:path';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { app, safeStorage, shell } from 'electron';
import {
  LogManager,
  consoleTransport,
  formatRecord,
  type CoreEnv,
  type SecretsCrypto,
} from '@studdybuddy/core';
import { createRuntime, type Runtime } from './runtime';
import { registerIpcRouter } from './ipc-router';
import { bridgeCoreEvents } from './event-bridge';

/**
 * Wires the core runtime into the Electron main process: builds the host
 * `CoreEnv` (data dir, OS-keychain secret encryption, file logging), registers
 * the IPC router and event bridge, and keeps the runtime for cleanup on quit.
 */
let runtime: Runtime | null = null;

/** Electron's safeStorage exposed through the core `SecretsCrypto` seam. */
function makeSecretsCrypto(): SecretsCrypto | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  return {
    encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
    decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
  };
}

export async function bootstrap(): Promise<void> {
  const dataDir = process.env.SB_DATA_DIR
    ? path.resolve(process.env.SB_DATA_DIR)
    : app.getPath('userData');

  const logManager = new LogManager();
  logManager.minLevel = app.isPackaged ? 'info' : 'debug';
  logManager.addTransport(consoleTransport);

  // Append logs to <dataDir>/logs/studdybuddy.log for the diagnostics panel.
  let logStream: WriteStream | undefined;
  try {
    const logDir = path.join(dataDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    logStream = createWriteStream(path.join(logDir, 'studdybuddy.log'), { flags: 'a' });
    logManager.addTransport((record) => logStream?.write(`${formatRecord(record)}\n`));
  } catch {
    // File logging is best-effort; the console + ring buffer still work.
  }

  const env: CoreEnv = {
    dataDir,
    logManager,
    appVersion: app.getVersion(),
    ...(makeSecretsCrypto() ? { secretsCrypto: makeSecretsCrypto() } : {}),
  };

  const log = logManager.getLogger('bootstrap');
  try {
    runtime = await createRuntime({
      env,
      openPath: async (target) => {
        if (/^https?:\/\//i.test(target)) await shell.openExternal(target);
        else await shell.openPath(target);
      },
    });
    registerIpcRouter(runtime.api, log);
    bridgeCoreEvents(runtime.bus);
    log.info('runtime ready', { dataDir, version: app.getVersion() });
  } catch (e) {
    log.error('runtime failed to start', { error: (e as Error).message });
    throw e;
  }

  app.on('will-quit', () => {
    void runtime?.dispose();
    logStream?.end();
  });
}
