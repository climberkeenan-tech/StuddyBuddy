import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SecretsCrypto } from '../env';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';

/**
 * Encrypted at-rest storage for API keys.
 *
 * Preferred cipher is the host-provided SecretsCrypto (Electron safeStorage —
 * OS keychain backed). When unavailable (headless/tests, some Linux setups),
 * falls back to AES-256-GCM with a random key stored in a 0600 key file next
 * to the vault. Keys never appear in settings, logs, or backups.
 */
export class SecretsVault {
  private vaultPath: string;
  private keyPath: string;
  private cache = new Map<string, string>();
  private loaded = false;

  constructor(
    dataDir: string,
    private logger: Logger,
    private hostCrypto?: SecretsCrypto,
  ) {
    this.vaultPath = path.join(dataDir, 'secrets.vault');
    this.keyPath = path.join(dataDir, '.vault-key');
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.load();
    this.cache.set(name, value);
    await this.persist();
  }

  async getSecret(name: string): Promise<string | null> {
    await this.load();
    return this.cache.get(name) ?? null;
  }

  async deleteSecret(name: string): Promise<void> {
    await this.load();
    this.cache.delete(name);
    await this.persist();
  }

  async hasSecret(name: string): Promise<boolean> {
    await this.load();
    return this.cache.has(name);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.vaultPath, 'utf8');
      const envelope = JSON.parse(raw) as { mode: 'host' | 'aes'; payload: string };
      const plaintext =
        envelope.mode === 'host' && this.hostCrypto
          ? this.hostCrypto.decrypt(envelope.payload)
          : await this.aesDecrypt(envelope.payload);
      const entries = JSON.parse(plaintext) as Record<string, string>;
      this.cache = new Map(Object.entries(entries));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('secrets vault unreadable; starting empty', {
          error: (e as Error).message,
        });
      }
      this.cache = new Map();
    }
  }

  private async persist(): Promise<void> {
    const plaintext = JSON.stringify(Object.fromEntries(this.cache));
    let envelope: { mode: 'host' | 'aes'; payload: string };
    try {
      envelope = this.hostCrypto
        ? { mode: 'host', payload: this.hostCrypto.encrypt(plaintext) }
        : { mode: 'aes', payload: await this.aesEncrypt(plaintext) };
    } catch (e) {
      throw new SbError(ErrorCodes.SECRETS_FAILURE, 'Failed to encrypt secrets vault', {
        cause: e,
      });
    }
    await fs.mkdir(path.dirname(this.vaultPath), { recursive: true });
    const tmp = `${this.vaultPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, this.vaultPath);
  }

  private async getAesKey(): Promise<Buffer> {
    try {
      const hex = (await fs.readFile(this.keyPath, 'utf8')).trim();
      return Buffer.from(hex, 'hex');
    } catch {
      const key = crypto.randomBytes(32);
      await fs.mkdir(path.dirname(this.keyPath), { recursive: true });
      await fs.writeFile(this.keyPath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
      return key;
    }
  }

  private async aesEncrypt(plaintext: string): Promise<string> {
    const key = await this.getAesKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  }

  private async aesDecrypt(payload: string): Promise<string> {
    const key = await this.getAesKey();
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

/** Vault key name for a provider's API key, e.g. apiKeyName("openai"). */
export function apiKeyName(providerId: string): string {
  return `apiKey:${providerId}`;
}
