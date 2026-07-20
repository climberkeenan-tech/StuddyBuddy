import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFileAdapter } from '../src/storage/json-file-adapter';
import { SqliteAdapter } from '../src/storage/sqlite-adapter';
import { createStorageAdapter } from '../src/storage/factory';
import type { StorageAdapter } from '../src/storage/types';
import { LogManager } from '../src/infra/logger';
import { SbError } from '../src/infra/errors';

const logger = new LogManager().getLogger('test');

let sqliteAvailable = true;
try {
  await import('node:sqlite');
} catch {
  sqliteAvailable = false;
}

interface AdapterCase {
  name: string;
  enabled: boolean;
  make: (dir: string) => StorageAdapter;
}

const cases: AdapterCase[] = [
  { name: 'JsonFileAdapter', enabled: true, make: (dir) => new JsonFileAdapter(dir, logger) },
  {
    name: 'SqliteAdapter',
    enabled: sqliteAvailable,
    make: (dir) => new SqliteAdapter(dir, logger),
  },
];

interface Widget {
  id: string;
  name: string;
  rank: number;
  flag?: boolean | number;
  tags?: string[];
}

const widget = (id: string, name: string, rank: number, extra?: Partial<Widget>): Widget => ({
  id,
  name,
  rank,
  ...extra,
});

for (const c of cases) {
  const d = c.enabled ? describe : describe.skip;

  d(`${c.name} (StorageAdapter contract)`, () => {
    let dir: string;
    let adapter: StorageAdapter;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-storage-'));
      adapter = c.make(dir);
      await adapter.init();
    });

    afterEach(async () => {
      await adapter.close();
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('put/get roundtrips a doc and returns null for missing ids', async () => {
      const doc = widget('w1', 'alpha', 3, { tags: ['x', 'y'] });
      await adapter.put('widgets', doc);
      expect(await adapter.get<Widget>('widgets', 'w1')).toEqual(doc);
      expect(await adapter.get<Widget>('widgets', 'nope')).toBeNull();
    });

    it('put upserts on id collision', async () => {
      await adapter.put('widgets', widget('w1', 'old', 1));
      await adapter.put('widgets', widget('w1', 'new', 2));
      expect(await adapter.get<Widget>('widgets', 'w1')).toEqual(widget('w1', 'new', 2));
      expect(await adapter.count('widgets')).toBe(1);
    });

    it('returned docs are detached copies (mutation does not corrupt storage)', async () => {
      await adapter.put('widgets', widget('w1', 'alpha', 1, { tags: ['a'] }));
      const got = await adapter.get<Widget>('widgets', 'w1');
      got!.name = 'mutated';
      got!.tags!.push('b');
      expect(await adapter.get<Widget>('widgets', 'w1')).toEqual(
        widget('w1', 'alpha', 1, { tags: ['a'] }),
      );
    });

    it('query filters with where equality on indexed and non-indexed fields', async () => {
      // "lectures" has indexed courseId/status; "rank" is never indexed.
      await adapter.putMany('lectures', [
        { id: 'l1', courseId: 'c1', status: 'ready', rank: 1 },
        { id: 'l2', courseId: 'c1', status: 'failed', rank: 2 },
        { id: 'l3', courseId: 'c2', status: 'ready', rank: 1 },
      ]);
      const byCourse = await adapter.query<{ id: string }>('lectures', {
        where: { courseId: 'c1' },
      });
      expect(byCourse.map((x) => x.id).sort()).toEqual(['l1', 'l2']);

      const mixed = await adapter.query<{ id: string }>('lectures', {
        where: { courseId: 'c1', rank: 1 },
      });
      expect(mixed.map((x) => x.id)).toEqual(['l1']);

      const nonIndexed = await adapter.query<{ id: string }>('lectures', {
        where: { rank: 1 },
      });
      expect(nonIndexed.map((x) => x.id).sort()).toEqual(['l1', 'l3']);
    });

    it('where uses strict equality: boolean true does not match number 1', async () => {
      await adapter.putMany('widgets', [
        widget('a', 'a', 1, { flag: true }),
        widget('b', 'b', 1, { flag: 1 }),
        widget('c', 'c', 1, { flag: false }),
      ]);
      const trueOnly = await adapter.query<Widget>('widgets', { where: { flag: true } });
      expect(trueOnly.map((w) => w.id)).toEqual(['a']);
      const oneOnly = await adapter.query<Widget>('widgets', { where: { flag: 1 } });
      expect(oneOnly.map((w) => w.id)).toEqual(['b']);
      expect(await adapter.count('widgets', { flag: true })).toBe(1);
      expect(await adapter.count('widgets', { flag: false })).toBe(1);
    });

    it('query orders by number and string fields, asc and desc', async () => {
      await adapter.putMany('widgets', [
        widget('w1', 'banana', 2),
        widget('w2', 'apple', 10),
        widget('w3', 'cherry', 1),
      ]);
      const byRank = await adapter.query<Widget>('widgets', {
        orderBy: { field: 'rank', direction: 'asc' },
      });
      expect(byRank.map((w) => w.rank)).toEqual([1, 2, 10]);

      const byRankDesc = await adapter.query<Widget>('widgets', {
        orderBy: { field: 'rank', direction: 'desc' },
      });
      expect(byRankDesc.map((w) => w.rank)).toEqual([10, 2, 1]);

      const byName = await adapter.query<Widget>('widgets', {
        orderBy: { field: 'name', direction: 'asc' },
      });
      expect(byName.map((w) => w.name)).toEqual(['apple', 'banana', 'cherry']);
    });

    it('query applies offset and limit after ordering', async () => {
      await adapter.putMany(
        'widgets',
        [5, 3, 1, 4, 2].map((n) => widget(`w${n}`, `n${n}`, n)),
      );
      const page = await adapter.query<Widget>('widgets', {
        orderBy: { field: 'rank', direction: 'asc' },
        offset: 1,
        limit: 2,
      });
      expect(page.map((w) => w.rank)).toEqual([2, 3]);
      const zero = await adapter.query<Widget>('widgets', { limit: 0 });
      expect(zero).toEqual([]);
    });

    it('count honors where and defaults to full collection size', async () => {
      await adapter.putMany('lectures', [
        { id: 'l1', courseId: 'c1', status: 'ready' },
        { id: 'l2', courseId: 'c1', status: 'ready' },
        { id: 'l3', courseId: 'c2', status: 'failed' },
      ]);
      expect(await adapter.count('lectures')).toBe(3);
      expect(await adapter.count('lectures', { courseId: 'c1' })).toBe(2);
      expect(await adapter.count('lectures', { courseId: 'c1', status: 'failed' })).toBe(0);
      expect(await adapter.count('empty_collection')).toBe(0);
    });

    it('delete removes one doc; deleting a missing id is a no-op', async () => {
      await adapter.put('widgets', widget('w1', 'a', 1));
      await adapter.delete('widgets', 'w1');
      await adapter.delete('widgets', 'w1');
      expect(await adapter.get('widgets', 'w1')).toBeNull();
      expect(await adapter.count('widgets')).toBe(0);
    });

    it('deleteWhere removes matches on indexed and non-indexed fields', async () => {
      await adapter.putMany('lectures', [
        { id: 'l1', courseId: 'c1', status: 'ready', rank: 1 },
        { id: 'l2', courseId: 'c1', status: 'ready', rank: 2 },
        { id: 'l3', courseId: 'c2', status: 'ready', rank: 1 },
      ]);
      await adapter.deleteWhere('lectures', { courseId: 'c1', rank: 2 });
      expect(await adapter.count('lectures')).toBe(2);
      await adapter.deleteWhere('lectures', { rank: 1 });
      expect(await adapter.count('lectures')).toBe(0);
    });

    it('putMany upserts all docs in one call', async () => {
      await adapter.put('widgets', widget('w1', 'old', 0));
      await adapter.putMany('widgets', [widget('w1', 'new', 1), widget('w2', 'b', 2)]);
      expect(await adapter.count('widgets')).toBe(2);
      expect((await adapter.get<Widget>('widgets', 'w1'))!.name).toBe('new');
    });

    it('data survives reopening the same directory with a new instance', async () => {
      await adapter.put('widgets', widget('w1', 'persisted', 7));
      await adapter.close();
      adapter = c.make(dir);
      await adapter.init();
      expect(await adapter.get<Widget>('widgets', 'w1')).toEqual(widget('w1', 'persisted', 7));
    });

    it('dump/restore roundtrips into a fresh adapter and replaces old contents', async () => {
      await adapter.putMany('widgets', [widget('w1', 'a', 1), widget('w2', 'b', 2)]);
      await adapter.put('lectures', { id: 'l1', courseId: 'c1', status: 'ready' });
      const dump = await adapter.dump();
      expect(dump['widgets']).toHaveLength(2);
      expect(dump['lectures']).toHaveLength(1);

      const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-storage-restore-'));
      const target = c.make(dir2);
      await target.init();
      try {
        // Pre-existing doc must be gone after restore (full replacement).
        await target.put('widgets', widget('stale', 'stale', 0));
        await target.restore(dump);
        expect(await target.get('widgets', 'stale')).toBeNull();
        expect(await target.count('widgets')).toBe(2);
        expect(await target.get<Widget>('widgets', 'w2')).toEqual(widget('w2', 'b', 2));
        expect(await target.count('lectures')).toBe(1);
      } finally {
        await target.close();
        await fs.rm(dir2, { recursive: true, force: true });
      }
    });

    it('restore rejects docs without a string id', async () => {
      await expect(
        adapter.restore({ widgets: [{ name: 'no id here' }] }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('rejects collection names that are not simple identifiers', async () => {
      for (const bad of ['../evil', 'drop table;', 'a b', '']) {
        await expect(adapter.put(bad, { id: 'x' })).rejects.toBeInstanceOf(SbError);
        await expect(adapter.query(bad)).rejects.toMatchObject({ code: 'VALIDATION' });
      }
    });
  });
}

describe('createStorageAdapter factory', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-storage-factory-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!sqliteAvailable)('prefers sqlite when node:sqlite works', async () => {
    const { adapter, kind } = await createStorageAdapter(dir, logger);
    try {
      expect(kind).toBe('sqlite');
      await adapter.put('widgets', { id: 'w1' });
      expect(await adapter.count('widgets')).toBe(1);
    } finally {
      await adapter.close();
    }
  });

  it.skipIf(!sqliteAvailable)(
    'falls back to the JSON adapter when sqlite init fails',
    async () => {
      // A directory where the sqlite file should live makes DatabaseSync fail
      // to open while leaving the JSON adapter fully functional.
      await fs.mkdir(path.join(dir, 'db', 'studdybuddy.sqlite3'), { recursive: true });
      const { adapter, kind } = await createStorageAdapter(dir, logger);
      try {
        expect(kind).toBe('json-file');
        await adapter.put('widgets', { id: 'w1' });
        expect(await adapter.count('widgets')).toBe(1);
      } finally {
        await adapter.close();
      }
    },
  );
});
