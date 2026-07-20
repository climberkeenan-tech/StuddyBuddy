import type { LogManager } from './infra/logger';

/**
 * Host-environment abstraction. `core` never imports Electron; the desktop
 * main process (or a test harness) supplies these capabilities.
 */
export interface SecretsCrypto {
  /** Encrypt plaintext to an opaque base64 string. */
  encrypt(plaintext: string): string;
  /** Decrypt a string produced by `encrypt`. */
  decrypt(ciphertext: string): string;
}

export interface CoreEnv {
  /** Root directory for all local-first app data (created if missing). */
  dataDir: string;
  logManager: LogManager;
  /**
   * OS-backed secret encryption (Electron safeStorage) when available.
   * When omitted, the vault falls back to a local AES-256-GCM key file.
   */
  secretsCrypto?: SecretsCrypto;
  /** App version string for stamping generated documents. */
  appVersion: string;
}
