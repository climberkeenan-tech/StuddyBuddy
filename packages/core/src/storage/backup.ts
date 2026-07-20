import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { StorageAdapter } from './types';
import { atomicWriteFile } from './query-utils';

/**
 * On-disk backup envelope. `collections` is the full adapter dump;
 * `settings` mirrors the user's settings.json when a settings path was
 * provided. API keys are NEVER present: they live in the encrypted secrets
 * vault, which is intentionally excluded from backups (see BackupService).
 */
export interface BackupEnvelope {
  app: 'studdybuddy';
  appVersion: string;
  /** ISO-8601 creation time (human-readable inside the backup file). */
  createdAt: string;
  collections: Record<string, unknown[]>;
  settings?: unknown;
}

const envelopeSchema = z.object({
  app: z.literal('studdybuddy'),
  appVersion: z.string(),
  createdAt: z.string(),
  collections: z.record(z.array(z.unknown())),
  settings: z.unknown().optional(),
});

/**
 * Full-database backup/restore as a single portable JSON file.
 *
 * What IS included: every storage collection (courses, lectures, transcripts,
 * analyses, materials, quiz attempts, slide decks, chunks, embeddings, exam
 * preps, gamification, kv/settings docs, plugin state) plus the settings.json
 * contents when `settingsPath` is provided.
 *
 * What is NOT included — intentionally: API keys and the secrets vault.
 * Backups are plain JSON files users copy to cloud drives and share between
 * machines; secrets must never travel that way. After restoring on a new
 * machine, providers are re-keyed via Settings.
 */
export class BackupService {
  private readonly log: Logger;

  constructor(
    private readonly adapter: StorageAdapter,
    /** Path to settings.json, or null to omit settings from backups. */
    private readonly settingsPath: string | null,
    private readonly appVersion: string,
    logger: Logger,
  ) {
    this.log = logger.child('backup');
  }

  /**
   * Write `studdybuddy-backup-YYYY-MM-DD-HHmm.json` (local time) into `outDir`
   * (created if missing) and return the absolute file path.
   */
  async backup(outDir: string): Promise<string> {
    try {
      const collections = await this.adapter.dump();
      const envelope: BackupEnvelope = {
        app: 'studdybuddy',
        appVersion: this.appVersion,
        createdAt: new Date().toISOString(),
        collections,
      };
      const settings = await this.readSettings();
      if (settings !== undefined) envelope.settings = settings;

      await fs.mkdir(outDir, { recursive: true });
      const filePath = path.resolve(outDir, `studdybuddy-backup-${timestampSlug(new Date())}.json`);
      await atomicWriteFile(filePath, JSON.stringify(envelope, null, 2));
      this.log.info('backup written', {
        filePath,
        collections: Object.keys(collections).length,
        docs: Object.values(collections).reduce((n, docs) => n + docs.length, 0),
      });
      return filePath;
    } catch (e) {
      if (e instanceof SbError) throw e;
      throw new SbError(ErrorCodes.BACKUP_FAILED, 'Failed to write backup', {
        details: { outDir },
        cause: e,
      });
    }
  }

  /**
   * Validate the backup envelope and replace the entire database with its
   * contents. Throws SbError NOT_FOUND when the file is missing and VALIDATION
   * when it is not a StuddyBuddy backup (wrong app marker / malformed shape).
   * An appVersion mismatch is allowed (documents are forward-readable JSON)
   * but logged. When the envelope carries settings and this service was given
   * a settings path, settings.json is restored too.
   */
  async restore(filePath: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SbError(ErrorCodes.NOT_FOUND, `Backup file not found: ${filePath}`, {
          details: { filePath },
        });
      }
      throw new SbError(ErrorCodes.BACKUP_FAILED, 'Failed to read backup file', {
        details: { filePath },
        cause: e,
      });
    }

    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(raw);
    } catch (e) {
      throw new SbError(ErrorCodes.VALIDATION, 'Backup file is not valid JSON', {
        details: { filePath },
        cause: e,
      });
    }

    const validated = envelopeSchema.safeParse(parsedUnknown);
    if (!validated.success) {
      throw new SbError(ErrorCodes.VALIDATION, 'File is not a StuddyBuddy backup', {
        details: {
          filePath,
          issues: validated.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      });
    }
    const envelope = validated.data;
    if (envelope.appVersion !== this.appVersion) {
      this.log.info('restoring backup from a different app version', {
        backupVersion: envelope.appVersion,
        currentVersion: this.appVersion,
      });
    }

    await this.adapter.restore(envelope.collections);

    if (envelope.settings !== undefined && this.settingsPath) {
      try {
        await atomicWriteFile(this.settingsPath, JSON.stringify(envelope.settings, null, 2));
      } catch (e) {
        // Data restore already succeeded; a settings write failure downgrades
        // to a warning instead of failing the whole restore.
        this.log.warn('failed to restore settings.json from backup', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    this.log.info('backup restored', {
      filePath,
      collections: Object.keys(envelope.collections).length,
    });
  }

  /** Read settings.json for inclusion in the envelope; missing file → omit. */
  private async readSettings(): Promise<unknown> {
    if (!this.settingsPath) return undefined;
    try {
      return JSON.parse(await fs.readFile(this.settingsPath, 'utf8')) as unknown;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.warn('settings.json unreadable, omitting from backup', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return undefined;
    }
  }
}

/** Local-time filename stamp: YYYY-MM-DD-HHmm. */
function timestampSlug(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
