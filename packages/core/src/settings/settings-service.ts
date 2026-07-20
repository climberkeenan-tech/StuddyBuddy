import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';

type SettingsListener = (settings: AppSettings) => void;

/**
 * User settings persisted as a JSON file in the data dir (independent of the
 * storage adapter so it is readable before storage initializes). Writes are
 * atomic (tmp file + rename) to survive crashes mid-write.
 */
export class SettingsService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<SettingsListener>();
  private filePath: string;

  constructor(
    dataDir: string,
    private logger: Logger,
  ) {
    this.filePath = path.join(dataDir, 'settings.json');
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('settings file unreadable, using defaults', {
          error: (e as Error).message,
        });
      }
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch };
    await this.persist();
    for (const listener of [...this.listeners]) {
      try {
        listener(this.get());
      } catch {
        // Listener errors are not the settings service's problem.
      }
    }
    return this.get();
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}
