import type { Logger } from '../infra/logger';
import type { StorageAdapter } from './types';
import { SqliteAdapter } from './sqlite-adapter';
import { JsonFileAdapter } from './json-file-adapter';

/** Which backend `createStorageAdapter` ended up selecting. */
export type StorageKind = 'sqlite' | 'json-file';

/**
 * Create and initialize the storage backend: SQLite (`node:sqlite`, WAL,
 * indexed) when the runtime supports it, with an automatic fallback to the
 * zero-dependency JSON file adapter on ANY initialization failure — missing
 * `node:sqlite` module, unwritable/corrupt database file, etc. The fallback is
 * logged as a warning naming the reason so the situation is diagnosable, but
 * the app keeps working either way (local-first, no hard dependency on the
 * SQLite build).
 */
export async function createStorageAdapter(
  dataDir: string,
  logger: Logger,
): Promise<{ adapter: StorageAdapter; kind: StorageKind }> {
  const log = logger.child('storage:factory');
  const sqlite = new SqliteAdapter(dataDir, logger);
  try {
    await sqlite.init();
    log.info('using sqlite storage');
    return { adapter: sqlite, kind: 'sqlite' };
  } catch (e) {
    try {
      await sqlite.close();
    } catch {
      // Nothing useful to do with a close failure on an adapter that never opened.
    }
    log.warn('sqlite unavailable, falling back to JSON file storage', {
      reason: e instanceof Error ? e.message : String(e),
    });
    const json = new JsonFileAdapter(dataDir, logger);
    await json.init();
    return { adapter: json, kind: 'json-file' };
  }
}
