import type { ExtensionPointId, PluginInfo, PluginManifest } from '@studdybuddy/shared';
import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { AIProvider, EmbeddingProvider } from '../ai/types';
import type { TranscriptionProvider } from '../transcription/types';
import type { MaterialGenerator } from '../materials/types';
import type { SlideExporter } from '../export/types';

/** Renderer-side visualizations register a descriptor only (impl lives in the UI). */
export interface VisualizationDescriptor {
  id: string;
  name: string;
  description: string;
}

/** Maps each extension point to the implementation type it accepts. */
export interface ExtensionTypeMap {
  'ai-provider': AIProvider;
  'transcription-provider': TranscriptionProvider;
  'embedding-provider': EmbeddingProvider;
  'material-generator': MaterialGenerator;
  exporter: SlideExporter;
  visualization: VisualizationDescriptor;
}

interface Contribution<K extends ExtensionPointId = ExtensionPointId> {
  pluginId: string;
  key: string;
  impl: ExtensionTypeMap[K];
}

export interface ContributionContext {
  contribute<K extends ExtensionPointId>(point: K, key: string, impl: ExtensionTypeMap[K]): void;
}

/**
 * Central plugin registry. Built-in features register through the exact same
 * API a third-party plugin would, which keeps every major capability
 * swappable and independently testable.
 */
export class PluginRegistry {
  private plugins = new Map<string, { manifest: PluginManifest; enabled: boolean }>();
  private contributions = new Map<ExtensionPointId, Contribution[]>();

  constructor(private logger: Logger) {}

  /** Register a plugin and collect its contributions. Idempotent per plugin id. */
  register(manifest: PluginManifest, setup: (ctx: ContributionContext) => void): void {
    if (this.plugins.has(manifest.id)) {
      throw new SbError(ErrorCodes.PLUGIN_FAILURE, `Plugin "${manifest.id}" already registered`);
    }
    this.plugins.set(manifest.id, { manifest, enabled: true });
    const ctx: ContributionContext = {
      contribute: (point, key, impl) => {
        const list = this.contributions.get(point) ?? [];
        if (list.some((c) => c.key === key)) {
          throw new SbError(
            ErrorCodes.PLUGIN_FAILURE,
            `Duplicate contribution "${key}" for extension point "${point}"`,
          );
        }
        list.push({ pluginId: manifest.id, key, impl });
        this.contributions.set(point, list);
      },
    };
    try {
      setup(ctx);
      this.logger.info('plugin registered', {
        id: manifest.id,
        contributes: manifest.contributes,
      });
    } catch (e) {
      // A failing plugin must not take the app down: roll back and record.
      this.plugins.delete(manifest.id);
      for (const [point, list] of this.contributions) {
        this.contributions.set(
          point,
          list.filter((c) => c.pluginId !== manifest.id),
        );
      }
      this.logger.error('plugin registration failed', {
        id: manifest.id,
        error: (e as Error).message,
      });
      throw e;
    }
  }

  /** Enabled contributions for a point, in registration order. */
  getAll<K extends ExtensionPointId>(point: K): { key: string; impl: ExtensionTypeMap[K] }[] {
    const list = (this.contributions.get(point) ?? []) as Contribution<K>[];
    return list
      .filter((c) => this.plugins.get(c.pluginId)?.enabled)
      .map((c) => ({ key: c.key, impl: c.impl }));
  }

  get<K extends ExtensionPointId>(point: K, key: string): ExtensionTypeMap[K] | undefined {
    return this.getAll(point).find((c) => c.key === key)?.impl;
  }

  list(): PluginInfo[] {
    return [...this.plugins.values()].map(({ manifest, enabled }) => ({ ...manifest, enabled }));
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new SbError(ErrorCodes.NOT_FOUND, `Unknown plugin "${pluginId}"`);
    if (entry.manifest.builtIn && !enabled) {
      throw new SbError(ErrorCodes.PLUGIN_FAILURE, 'Built-in plugins cannot be disabled');
    }
    entry.enabled = enabled;
  }

  /** Enabled-state snapshot for persistence. */
  snapshot(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [id, { enabled }] of this.plugins) out[id] = enabled;
    return out;
  }

  restoreSnapshot(state: Record<string, boolean>): void {
    for (const [id, enabled] of Object.entries(state)) {
      const entry = this.plugins.get(id);
      if (entry && !entry.manifest.builtIn) entry.enabled = enabled;
    }
  }
}
