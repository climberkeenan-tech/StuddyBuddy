import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogManager } from '../src/infra/logger';
import { PluginRegistry } from '../src/plugins/registry';
import { SettingsService } from '../src/settings/settings-service';
import { SecretsVault, apiKeyName } from '../src/settings/secrets-vault';
import { AIProviderRegistry } from '../src/ai/registry';
import { EmbeddingRegistry } from '../src/ai/embeddings/registry';
import { createAIFacade } from '../src/ai/ai-service';
import { registerBuiltinAI } from '../src/ai/builtin-plugin';

describe('AI registries + facade', () => {
  let dir: string;
  let settings: SettingsService;
  let vault: SecretsVault;
  let pluginRegistry: PluginRegistry;
  let registry: AIProviderRegistry;
  let embeddings: EmbeddingRegistry;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-ai-'));
    const logManager = new LogManager();
    const logger = logManager.getLogger('test');
    settings = new SettingsService(dir, logger);
    await settings.init();
    vault = new SecretsVault(dir, logger);
    pluginRegistry = new PluginRegistry(logger);
    registerBuiltinAI(pluginRegistry, { vault, settings, logger });
    registry = new AIProviderRegistry({ pluginRegistry, settings, vault, logger });
    embeddings = new EmbeddingRegistry({ pluginRegistry, settings, vault, logger });

    // No live network in tests: Ollama probes fail fast, others never fire.
    fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('registers the builtin-ai plugin with all providers', () => {
    const plugin = pluginRegistry.list().find((p) => p.id === 'builtin-ai');
    expect(plugin?.builtIn).toBe(true);
    expect(pluginRegistry.getAll('ai-provider').map((c) => c.key).sort()).toEqual([
      'anthropic',
      'gemini',
      'mock',
      'ollama',
      'openai',
    ]);
    expect(pluginRegistry.getAll('embedding-provider').map((c) => c.key).sort()).toEqual([
      'local-hash',
      'ollama',
      'openai',
    ]);
  });

  it('defaults to the mock provider (offline-first out of the box)', async () => {
    const active = await registry.getActive();
    expect(active.info.id).toBe('mock');
    const facade = createAIFacade({ registry, logger: new LogManager().getLogger('t') });
    expect(await facade.available()).toBe(false);
    expect(facade.activeLabel()).toBe('mock/offline');
  });

  it('falls back to mock when the selected provider has no API key', async () => {
    await settings.update({ aiProvider: 'anthropic' });
    const active = await registry.getActive();
    expect(active.info.id).toBe('mock');

    const facade = createAIFacade({ registry, logger: new LogManager().getLogger('t') });
    expect(await facade.available()).toBe(false);

    // chat still works (offline text), so the UI never dead-ends.
    const result = await facade.chat({ messages: [{ role: 'user', content: 'Explain DNA' }] });
    expect(result.model).toBe('offline');
    expect(result.text).toContain('Explain DNA');
  });

  it('activates the selected provider once its key is stored', async () => {
    await settings.update({ aiProvider: 'anthropic' });
    await registry.setApiKey('anthropic', 'sk-ant-test');
    expect(await vault.getSecret(apiKeyName('anthropic'))).toBe('sk-ant-test');

    const active = await registry.getActive();
    expect(active.info.id).toBe('anthropic');

    const facade = createAIFacade({ registry, logger: new LogManager().getLogger('t') });
    expect(await facade.available()).toBe(true);
    expect(facade.activeLabel()).toBe('anthropic/claude-sonnet-5');

    await settings.update({
      aiProviderSettings: { anthropic: { model: 'claude-opus-4-8' } },
    });
    expect(facade.activeLabel()).toBe('anthropic/claude-opus-4-8');

    await registry.clearApiKey('anthropic');
    expect((await registry.getActive()).info.id).toBe('mock');
  });

  it('produces Settings descriptors with key/availability status', async () => {
    await registry.setApiKey('openai', 'sk-test');
    const descriptors = await registry.descriptors();
    const byId = new Map(descriptors.map((d) => [d.id, d]));

    expect(byId.get('mock')).toMatchObject({
      kind: 'ai',
      requiresApiKey: false,
      hasApiKey: false,
      available: true,
    });
    expect(byId.get('openai')).toMatchObject({ hasApiKey: true, available: true });
    expect(byId.get('anthropic')).toMatchObject({
      requiresApiKey: true,
      hasApiKey: false,
      available: false,
    });
    // Daemon probe was stubbed to fail — Ollama shows unavailable, keyless.
    expect(byId.get('ollama')).toMatchObject({ requiresApiKey: false, available: false });
    expect(byId.get('anthropic')?.models).toContain('claude-sonnet-5');
  });

  it('test() round-trips through the provider and rejects unknown ids', async () => {
    const mockResult = await registry.test('mock');
    expect(mockResult.ok).toBe(true);
    await expect(registry.test('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects empty API keys', async () => {
    await expect(registry.setApiKey('openai', '   ')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  describe('EmbeddingRegistry', () => {
    it('uses local-hash by default', async () => {
      const active = await embeddings.getActive();
      expect(active.id).toBe('local-hash');
    });

    it('falls back to local-hash when the chosen provider is unconfigured', async () => {
      await settings.update({ embeddingProvider: 'openai' }); // no key stored
      expect((await embeddings.getActive()).id).toBe('local-hash');

      await settings.update({ embeddingProvider: 'ollama' }); // daemon down (fetch stubbed)
      expect((await embeddings.getActive()).id).toBe('local-hash');
    });

    it('uses the chosen provider once configured', async () => {
      await settings.update({ embeddingProvider: 'openai' });
      await vault.setSecret(apiKeyName('openai'), 'sk-test');
      expect((await embeddings.getActive()).id).toBe('openai');
    });

    it('produces embedding descriptors', async () => {
      const descriptors = await embeddings.descriptors();
      const byId = new Map(descriptors.map((d) => [d.id, d]));
      expect(byId.get('local-hash')).toMatchObject({
        kind: 'embedding',
        requiresApiKey: false,
        available: true,
      });
      expect(byId.get('openai')).toMatchObject({ requiresApiKey: true, available: false });
    });
  });
});
