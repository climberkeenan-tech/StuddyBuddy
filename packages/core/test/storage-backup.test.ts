import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFileAdapter } from '../src/storage/json-file-adapter';
import { BackupService, type BackupEnvelope } from '../src/storage/backup';
import { SbError } from '../src/infra/errors';
import { LogManager } from '../src/infra/logger';

const logger = new LogManager().getLogger('test');

describe('BackupService', () => {
  let dir: string;
  let adapter: JsonFileAdapter;
  let settingsPath: string;
  let outDir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-backup-'));
    outDir = path.join(dir, 'backups');
    settingsPath = path.join(dir, 'settings.json');
    adapter = new JsonFileAdapter(dir, logger);
    await adapter.init();
  });

  afterEach(async () => {
    await adapter.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function service(a = adapter, sp: string | null = settingsPath): BackupService {
    return new BackupService(a, sp, '1.2.3', logger);
  }

  it('writes a named envelope file and reports its absolute path', async () => {
    await adapter.put('courses', { id: 'c1', name: 'Bio' });
    await adapter.put('lectures', { id: 'l1', courseId: 'c1' });
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark' }), 'utf8');

    const filePath = await service().backup(outDir);
    expect(path.isAbsolute(filePath)).toBe(true);
    expect(path.basename(filePath)).toMatch(/^studdybuddy-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);

    const envelope = JSON.parse(await fs.readFile(filePath, 'utf8')) as BackupEnvelope;
    expect(envelope.app).toBe('studdybuddy');
    expect(envelope.appVersion).toBe('1.2.3');
    expect(new Date(envelope.createdAt).getTime()).toBeGreaterThan(0);
    expect(envelope.collections['courses']).toEqual([{ id: 'c1', name: 'Bio' }]);
    expect(envelope.collections['lectures']).toHaveLength(1);
    expect(envelope.settings).toEqual({ theme: 'dark' });
  });

  it('omits settings when no settings path is configured or the file is missing', async () => {
    await adapter.put('courses', { id: 'c1' });
    const p1 = await service(adapter, null).backup(outDir);
    const env1 = JSON.parse(await fs.readFile(p1, 'utf8')) as BackupEnvelope;
    expect(env1.settings).toBeUndefined();
    // settingsPath configured but settings.json never written:
    const p2 = await service().backup(path.join(dir, 'backups2'));
    const env2 = JSON.parse(await fs.readFile(p2, 'utf8')) as BackupEnvelope;
    expect(env2.settings).toBeUndefined();
  });

  it('round-trips through backup → restore on a fresh data dir', async () => {
    await adapter.put('courses', { id: 'c1', name: 'Bio' });
    await adapter.putMany('lectures', [
      { id: 'l1', courseId: 'c1', number: 1 },
      { id: 'l2', courseId: 'c1', number: 2 },
    ]);
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark' }), 'utf8');
    const filePath = await service().backup(outDir);

    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-backup-target-'));
    const target = new JsonFileAdapter(dir2, logger);
    await target.init();
    const targetSettings = path.join(dir2, 'settings.json');
    try {
      // Pre-existing data must be fully replaced.
      await target.put('courses', { id: 'stale' });
      await new BackupService(target, targetSettings, '1.2.3', logger).restore(filePath);

      expect(await target.get('courses', 'stale')).toBeNull();
      expect(await target.get('courses', 'c1')).toEqual({ id: 'c1', name: 'Bio' });
      expect(await target.count('lectures')).toBe(2);
      expect(JSON.parse(await fs.readFile(targetSettings, 'utf8'))).toEqual({ theme: 'dark' });
    } finally {
      await target.close();
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  it('rejects an envelope from a different app with VALIDATION', async () => {
    const bad = path.join(dir, 'other.json');
    await fs.writeFile(
      bad,
      JSON.stringify({ app: 'otherapp', appVersion: '1.0.0', createdAt: 'x', collections: {} }),
      'utf8',
    );
    await expect(service().restore(bad)).rejects.toBeInstanceOf(SbError);
    await expect(service().restore(bad)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects malformed envelopes and non-JSON files with VALIDATION', async () => {
    const notJson = path.join(dir, 'garbage.json');
    await fs.writeFile(notJson, 'this is not json {', 'utf8');
    await expect(service().restore(notJson)).rejects.toMatchObject({ code: 'VALIDATION' });

    const wrongShape = path.join(dir, 'shape.json');
    await fs.writeFile(
      wrongShape,
      JSON.stringify({ app: 'studdybuddy', appVersion: '1.0.0', createdAt: 'x', collections: { c: 'nope' } }),
      'utf8',
    );
    await expect(service().restore(wrongShape)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a missing backup file with NOT_FOUND and leaves data untouched', async () => {
    await adapter.put('courses', { id: 'c1' });
    await expect(service().restore(path.join(dir, 'missing.json'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await adapter.get('courses', 'c1')).not.toBeNull();
  });

  it('accepts a backup from a different app version', async () => {
    await adapter.put('courses', { id: 'c1' });
    const filePath = await new BackupService(adapter, null, '0.9.0', logger).backup(outDir);
    await adapter.deleteWhere('courses', {});
    await service(adapter, null).restore(filePath);
    expect(await adapter.get('courses', 'c1')).toEqual({ id: 'c1' });
  });
});
