import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import { Collections, IndexedFields, type QueryOptions, type StorageAdapter } from './types';
import {
  applyQueryOptions,
  assertCollectionName,
  assertRestorableDocs,
  matchesWhere,
} from './query-utils';

/**
 * Default StorageAdapter backed by the built-in `node:sqlite` (DatabaseSync)
 * at `<dataDir>/db/studdybuddy.sqlite3` in WAL mode.
 *
 * Layout: one table per collection —
 *   `(id TEXT PRIMARY KEY, json TEXT NOT NULL, <one bare column per
 *   IndexedFields entry>)` — the bare (typeless, BLOB-affinity) columns
 *   preserve string/number types as written, are populated from the doc on
 *   every put, and carry a real SQLite index each.
 *
 * The module is loaded via `await import('node:sqlite')` inside `init()` so
 * merely constructing the adapter never throws on runtimes without SQLite —
 * the factory catches the init failure and falls back to JsonFileAdapter.
 *
 * Query semantics: equality on indexed fields is pushed down to SQL as a
 * pre-filter; the full `where` is then re-checked in JS along with
 * orderBy/limit/offset. Doing ordering and pagination in JS is deliberate:
 * documents hold heterogeneous JSON values (and booleans are stored as 0/1 in
 * index columns), so SQLite's cross-type collation order would diverge from
 * the JS comparison semantics the JsonFileAdapter uses. Routing both adapters
 * through the same `applyQueryOptions` keeps results identical either way.
 */
export class SqliteAdapter implements StorageAdapter {
  readonly kind = 'sqlite';

  private readonly dbDir: string;
  private readonly dbPath: string;
  private readonly log: Logger;
  private db: DatabaseSync | null = null;
  /** Tables verified to exist with up-to-date indexed columns. */
  private readyTables = new Set<string>();

  constructor(dataDir: string, logger: Logger) {
    this.dbDir = path.join(dataDir, 'db');
    this.dbPath = path.join(this.dbDir, 'studdybuddy.sqlite3');
    this.log = logger.child('storage:sqlite');
  }

  async init(): Promise<void> {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      await fs.mkdir(this.dbDir, { recursive: true });
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec('PRAGMA journal_mode = WAL;');
      // Pre-create every known collection so schema/index migration happens
      // once at startup, not lazily mid-request.
      for (const name of Object.values(Collections)) this.ensureTable(name);
    } catch (e) {
      if (e instanceof SbError) throw e;
      throw new SbError(ErrorCodes.STORAGE_FAILURE, 'SQLite storage initialization failed', {
        details: { dbPath: this.dbPath },
        cause: e,
      });
    }
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    return this.run('get', collection, () => {
      const db = this.ensureTable(collection);
      const row = db.prepare(`SELECT json FROM "${collection}" WHERE id = ?`).get(id);
      if (!row) return null;
      return this.parseRowJson<T>(collection, row);
    });
  }

  async put<T extends { id: string }>(collection: string, doc: T): Promise<void> {
    this.run('put', collection, () => {
      const db = this.ensureTable(collection);
      this.insertDoc(db, collection, doc);
    });
  }

  async putMany<T extends { id: string }>(collection: string, docs: T[]): Promise<void> {
    if (docs.length === 0) return;
    this.run('putMany', collection, () => {
      const db = this.ensureTable(collection);
      this.inTransaction(db, () => {
        for (const doc of docs) this.insertDoc(db, collection, doc);
      });
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    this.run('delete', collection, () => {
      const db = this.ensureTable(collection);
      db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).run(id);
    });
  }

  async deleteWhere(
    collection: string,
    where: Record<string, string | number | boolean>,
  ): Promise<void> {
    this.run('deleteWhere', collection, () => {
      const db = this.ensureTable(collection);
      // Select candidates via the indexed pre-filter, confirm with the exact
      // JS predicate, then delete by id — matching query() semantics exactly.
      const { clause, params } = this.indexedWhere(collection, where);
      const rows = db.prepare(`SELECT id, json FROM "${collection}"${clause}`).all(...params);
      const ids: string[] = [];
      for (const row of rows) {
        const doc = this.parseRowJson<unknown>(collection, row);
        if (matchesWhere(doc, where)) ids.push(String(row['id']));
      }
      if (ids.length === 0) return;
      const del = db.prepare(`DELETE FROM "${collection}" WHERE id = ?`);
      this.inTransaction(db, () => {
        for (const id of ids) del.run(id);
      });
    });
  }

  async query<T>(collection: string, options?: QueryOptions): Promise<T[]> {
    return this.run('query', collection, () => {
      const db = this.ensureTable(collection);
      const { clause, params } = this.indexedWhere(collection, options?.where);
      const rows = db.prepare(`SELECT json FROM "${collection}"${clause}`).all(...params);
      const docs = rows.map((row) => this.parseRowJson<T>(collection, row));
      // Full where re-check + orderBy/offset/limit in JS (see class JSDoc).
      return applyQueryOptions(docs, options);
    });
  }

  async count(
    collection: string,
    where?: Record<string, string | number | boolean>,
  ): Promise<number> {
    return this.run('count', collection, () => {
      const db = this.ensureTable(collection);
      const indexed = IndexedFields[collection] ?? [];
      const fields = Object.keys(where ?? {});
      if (fields.length === 0 || fields.every((f) => indexed.includes(f))) {
        // Fast path: fully answerable in SQL. Safe because indexed columns are
        // written from the same docs the JS predicate would inspect.
        const { clause, params } = this.indexedWhere(collection, where);
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${collection}"${clause}`).get(...params);
        const n = row?.['n'];
        if (typeof n !== 'number' && typeof n !== 'bigint') {
          throw new SbError(ErrorCodes.STORAGE_FAILURE, 'COUNT returned a non-numeric value');
        }
        // Exception to the fast path: boolean where values can alias numeric
        // 0/1 fields in the column encoding, so re-verify those in JS.
        if (where && Object.values(where).some((v) => typeof v === 'boolean')) {
          return this.countViaScan(db, collection, where);
        }
        return Number(n);
      }
      return this.countViaScan(db, collection, where);
    });
  }

  async dump(): Promise<Record<string, unknown[]>> {
    return this.run('dump', '*', () => {
      const db = this.requireDb();
      const out: Record<string, unknown[]> = {};
      for (const name of this.tableNames(db)) {
        const rows = db.prepare(`SELECT json FROM "${name}" ORDER BY id`).all();
        out[name] = rows.map((row) => this.parseRowJson<unknown>(name, row));
      }
      return out;
    });
  }

  async restore(dump: Record<string, unknown[]>): Promise<void> {
    for (const [name, docs] of Object.entries(dump)) {
      assertCollectionName(name);
      assertRestorableDocs(name, docs);
    }
    this.run('restore', '*', () => {
      const db = this.requireDb();
      // Ensure schemas outside the transaction so the txn is pure DML.
      for (const name of Object.keys(dump)) this.ensureTable(name);
      this.inTransaction(db, () => {
        // Replace entire contents: clear every existing table, including
        // collections absent from the dump.
        for (const name of this.tableNames(db)) db.exec(`DELETE FROM "${name}"`);
        for (const [name, docs] of Object.entries(dump)) {
          for (const doc of docs) this.insertDoc(db, name, doc as { id: string });
        }
      });
    });
    this.log.info('restored from dump', {
      collections: Object.keys(dump).length,
      docs: Object.values(dump).reduce((n, d) => n + d.length, 0),
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Closing an already-broken handle is not an error worth surfacing.
      }
      this.db = null;
      this.readyTables.clear();
    }
  }

  /* ————————————————————————— internals ————————————————————————— */

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new SbError(ErrorCodes.STORAGE_FAILURE, 'SqliteAdapter used before init()');
    }
    return this.db;
  }

  /** Uniform error wrapper: SbErrors pass through, SQLite errors gain context. */
  private run<T>(op: string, collection: string, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof SbError) throw e;
      throw new SbError(ErrorCodes.STORAGE_FAILURE, `SQLite ${op} failed on "${collection}"`, {
        details: { op, collection },
        cause: e,
      });
    }
  }

  private inTransaction(db: DatabaseSync, fn: () => void): void {
    db.exec('BEGIN');
    try {
      fn();
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Rollback failure is unrecoverable noise; the original error matters.
      }
      throw e;
    }
  }

  /**
   * Create the collection's table + indexes if missing, and add/backfill any
   * indexed columns introduced after the table was first created (forward
   * schema migration for IndexedFields changes).
   */
  private ensureTable(collection: string): DatabaseSync {
    assertCollectionName(collection);
    const db = this.requireDb();
    if (this.readyTables.has(collection)) return db;

    const indexed = IndexedFields[collection] ?? [];
    for (const field of indexed) assertCollectionName(field);

    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(collection);

    if (!exists) {
      // Bare (typeless) columns get BLOB affinity → values keep the type they
      // were bound with, so string/number index lookups stay type-faithful.
      const extraCols = indexed.map((f) => `, "${f}"`).join('');
      db.exec(`CREATE TABLE "${collection}" (id TEXT PRIMARY KEY, json TEXT NOT NULL${extraCols})`);
    } else {
      const existing = new Set(
        db
          .prepare(`SELECT name FROM pragma_table_info(?)`)
          .all(collection)
          .map((r) => String(r['name'])),
      );
      const missing = indexed.filter((f) => !existing.has(f));
      if (missing.length > 0) {
        for (const field of missing) db.exec(`ALTER TABLE "${collection}" ADD COLUMN "${field}"`);
        this.backfillColumns(db, collection, missing);
        this.log.info('added indexed columns', { collection, columns: missing });
      }
    }
    for (const field of indexed) {
      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_${collection}_${field}" ON "${collection}"("${field}")`,
      );
    }
    this.readyTables.add(collection);
    return db;
  }

  /** Populate newly added indexed columns from each row's stored JSON. */
  private backfillColumns(db: DatabaseSync, collection: string, fields: string[]): void {
    const rows = db.prepare(`SELECT id, json FROM "${collection}"`).all();
    const sets = fields.map((f) => `"${f}" = ?`).join(', ');
    const update = db.prepare(`UPDATE "${collection}" SET ${sets} WHERE id = ?`);
    this.inTransaction(db, () => {
      for (const row of rows) {
        const doc = this.parseRowJson<Record<string, unknown>>(collection, row);
        update.run(...fields.map((f) => toSqlValue(doc[f])), String(row['id']));
      }
    });
  }

  private insertDoc(db: DatabaseSync, collection: string, doc: { id: string }): void {
    if (typeof doc.id !== 'string' || doc.id.length === 0) {
      throw new SbError(ErrorCodes.VALIDATION, `Document for "${collection}" has no string id`);
    }
    this.ensureTable(collection);
    const indexed = IndexedFields[collection] ?? [];
    const record = doc as unknown as Record<string, unknown>;
    const cols = ['id', 'json', ...indexed.map((f) => `"${f}"`)].join(', ');
    const placeholders = ['?', '?', ...indexed.map(() => '?')].join(', ');
    db.prepare(`INSERT OR REPLACE INTO "${collection}" (${cols}) VALUES (${placeholders})`).run(
      doc.id,
      JSON.stringify(doc),
      ...indexed.map((f) => toSqlValue(record[f])),
    );
  }

  /**
   * Build the SQL pre-filter from the subset of `where` fields that have real
   * columns. The full predicate is always re-applied in JS afterwards, so this
   * only needs to never exclude a true match — booleans are encoded 0/1 both
   * on write and here, keeping the pre-filter sound.
   */
  private indexedWhere(
    collection: string,
    where: Record<string, string | number | boolean> | undefined,
  ): { clause: string; params: (string | number)[] } {
    const indexed = IndexedFields[collection] ?? [];
    const parts: string[] = [];
    const params: (string | number)[] = [];
    for (const [field, value] of Object.entries(where ?? {})) {
      if (!indexed.includes(field)) continue;
      parts.push(`"${field}" = ?`);
      const v = toSqlValue(value);
      // where values are string|number|boolean → toSqlValue never yields null.
      params.push(v as string | number);
    }
    return { clause: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '', params };
  }

  private countViaScan(
    db: DatabaseSync,
    collection: string,
    where: Record<string, string | number | boolean> | undefined,
  ): number {
    const { clause, params } = this.indexedWhere(collection, where);
    const rows = db.prepare(`SELECT json FROM "${collection}"${clause}`).all(...params);
    let n = 0;
    for (const row of rows) {
      if (matchesWhere(this.parseRowJson<unknown>(collection, row), where)) n++;
    }
    return n;
  }

  private parseRowJson<T>(collection: string, row: Record<string, unknown>): T {
    const raw = row['json'];
    if (typeof raw !== 'string') {
      throw new SbError(ErrorCodes.STORAGE_FAILURE, `Row in "${collection}" has no json payload`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      throw new SbError(ErrorCodes.STORAGE_FAILURE, `Corrupt JSON row in "${collection}"`, {
        cause: e,
      });
    }
  }

  private tableNames(db: DatabaseSync): string[] {
    return db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
      .map((r) => String(r['name']))
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  }
}

/**
 * Map a doc field to an indexable SQLite value. Booleans become 0/1 (SQLite
 * has no boolean type); objects/arrays/undefined become NULL — they are not
 * meaningfully indexable and equality on them is handled by the JS re-check.
 */
function toSqlValue(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}
