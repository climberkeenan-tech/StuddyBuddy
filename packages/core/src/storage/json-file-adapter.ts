import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { QueryOptions, StorageAdapter } from './types';
import {
  applyQueryOptions,
  assertCollectionName,
  assertRestorableDocs,
  atomicWriteFile,
  matchesWhere,
} from './query-utils';

/**
 * Zero-dependency StorageAdapter backed by one JSON file per collection at
 * `<dataDir>/db/<collection>.json`, each holding an `{ [id]: doc }` map.
 *
 * Design:
 * - Collections load lazily on first touch after `init()` and stay cached in
 *   memory; the dataset (courses, lectures, generated materials) is small
 *   enough that whole-collection maps are the simplest correct model.
 * - Every mutation is write-through: the full collection is re-serialized and
 *   swapped in via atomic tmp+rename, so a crash mid-write can never corrupt
 *   an existing file.
 * - Writes to the same collection are serialized through a promise chain to
 *   prevent interleaved tmp/rename pairs from concurrent async callers.
 * - Docs are deep-cloned on the way in and out so callers can never mutate the
 *   cache behind the adapter's back (matching SQLite's serialize-on-put
 *   semantics).
 *
 * Used as the automatic fallback when `node:sqlite` is unavailable.
 */
export class JsonFileAdapter implements StorageAdapter {
  readonly kind = 'json-file';

  private readonly dir: string;
  private readonly log: Logger;
  /** Promise-valued cache so concurrent first touches share a single disk load. */
  private collections = new Map<string, Promise<Map<string, unknown>>>();
  /** Per-collection write chain serializing persist() calls. */
  private chains = new Map<string, Promise<void>>();
  private initialized = false;

  constructor(dataDir: string, logger: Logger) {
    this.dir = path.join(dataDir, 'db');
    this.log = logger.child('storage:json');
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      this.initialized = true;
    } catch (e) {
      throw new SbError(ErrorCodes.STORAGE_FAILURE, 'Failed to create JSON storage directory', {
        details: { dir: this.dir },
        cause: e,
      });
    }
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const map = await this.load(collection);
    const doc = map.get(id);
    return doc === undefined ? null : (structuredClone(doc) as T);
  }

  async put<T extends { id: string }>(collection: string, doc: T): Promise<void> {
    const map = await this.load(collection);
    map.set(doc.id, structuredClone(doc));
    await this.persist(collection, map);
  }

  async putMany<T extends { id: string }>(collection: string, docs: T[]): Promise<void> {
    if (docs.length === 0) return;
    const map = await this.load(collection);
    for (const doc of docs) map.set(doc.id, structuredClone(doc));
    await this.persist(collection, map);
  }

  async delete(collection: string, id: string): Promise<void> {
    const map = await this.load(collection);
    if (!map.delete(id)) return;
    await this.persist(collection, map);
  }

  async deleteWhere(
    collection: string,
    where: Record<string, string | number | boolean>,
  ): Promise<void> {
    const map = await this.load(collection);
    let changed = false;
    for (const [id, doc] of [...map.entries()]) {
      if (matchesWhere(doc, where)) {
        map.delete(id);
        changed = true;
      }
    }
    if (changed) await this.persist(collection, map);
  }

  async query<T>(collection: string, options?: QueryOptions): Promise<T[]> {
    const map = await this.load(collection);
    return applyQueryOptions([...map.values()], options).map((d) => structuredClone(d) as T);
  }

  async count(
    collection: string,
    where?: Record<string, string | number | boolean>,
  ): Promise<number> {
    const map = await this.load(collection);
    if (!where) return map.size;
    let n = 0;
    for (const doc of map.values()) if (matchesWhere(doc, where)) n++;
    return n;
  }

  async dump(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const name of await this.collectionNamesOnDisk()) {
      const map = await this.load(name);
      out[name] = [...map.values()].map((d) => structuredClone(d));
    }
    // Include collections created this session that may not have hit disk yet.
    for (const [name, pending] of this.collections) {
      if (out[name]) continue;
      const map = await pending;
      out[name] = [...map.values()].map((d) => structuredClone(d));
    }
    return out;
  }

  async restore(dump: Record<string, unknown[]>): Promise<void> {
    for (const [name, docs] of Object.entries(dump)) {
      assertCollectionName(name);
      assertRestorableDocs(name, docs);
    }
    await this.settle();
    // Replace entire contents: drop collections absent from the dump too.
    for (const name of await this.collectionNamesOnDisk()) {
      if (!dump[name]) await fs.rm(this.fileFor(name), { force: true });
    }
    this.collections.clear();
    this.chains.clear();
    for (const [name, docs] of Object.entries(dump)) {
      const map = new Map<string, unknown>();
      for (const doc of docs) map.set((doc as { id: string }).id, structuredClone(doc));
      this.collections.set(name, Promise.resolve(map));
      await this.persist(name, map);
    }
    this.log.info('restored from dump', {
      collections: Object.keys(dump).length,
      docs: Object.values(dump).reduce((n, d) => n + d.length, 0),
    });
  }

  async close(): Promise<void> {
    await this.settle();
    this.collections.clear();
    this.chains.clear();
    this.initialized = false;
  }

  private fileFor(collection: string): string {
    return path.join(this.dir, `${collection}.json`);
  }

  private load(collection: string): Promise<Map<string, unknown>> {
    assertCollectionName(collection);
    if (!this.initialized) {
      return Promise.reject(
        new SbError(ErrorCodes.STORAGE_FAILURE, 'JsonFileAdapter used before init()'),
      );
    }
    let pending = this.collections.get(collection);
    if (!pending) {
      pending = this.loadFromDisk(collection);
      this.collections.set(collection, pending);
    }
    return pending;
  }

  private async loadFromDisk(collection: string): Promise<Map<string, unknown>> {
    const file = this.fileFor(collection);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw new SbError(ErrorCodes.STORAGE_FAILURE, `Failed to read collection "${collection}"`, {
        details: { file },
        cause: e,
      });
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return new Map(Object.entries(parsed));
    } catch (e) {
      // A corrupt file is surfaced loudly instead of silently starting empty,
      // which would overwrite the user's data on the next write.
      throw new SbError(ErrorCodes.STORAGE_FAILURE, `Collection file "${collection}" is corrupt`, {
        details: { file },
        cause: e,
      });
    }
  }

  /**
   * Serialize the current collection state and enqueue an atomic write. The
   * snapshot is taken synchronously here so later mutations cannot leak into an
   * earlier queued write.
   */
  private persist(collection: string, map: Map<string, unknown>): Promise<void> {
    const snapshot = JSON.stringify(Object.fromEntries(map), null, 2);
    const file = this.fileFor(collection);
    const prev = this.chains.get(collection) ?? Promise.resolve();
    const next = prev
      .catch(() => {
        // A previously failed write must not wedge the chain forever.
      })
      .then(async () => {
        try {
          await atomicWriteFile(file, snapshot);
        } catch (e) {
          throw new SbError(
            ErrorCodes.STORAGE_FAILURE,
            `Failed to write collection "${collection}"`,
            { details: { file }, cause: e },
          );
        }
      });
    this.chains.set(collection, next);
    return next;
  }

  /** Wait for all queued writes, swallowing their errors (already surfaced to callers). */
  private async settle(): Promise<void> {
    await Promise.all([...this.chains.values()].map((p) => p.catch(() => undefined)));
  }

  private async collectionNamesOnDisk(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new SbError(ErrorCodes.STORAGE_FAILURE, 'Failed to list storage directory', {
        details: { dir: this.dir },
        cause: e,
      });
    }
    return entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      .sort();
  }
}
