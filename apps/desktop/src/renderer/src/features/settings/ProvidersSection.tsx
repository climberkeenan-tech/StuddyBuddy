import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { AIProviderId, AppSettings, ProviderDescriptor } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync } from '@renderer/lib/hooks';
import { useAppStore } from '@renderer/stores/app-store';
import { useToast } from '@renderer/components/toast';
import { cn } from '@renderer/lib/cn';
import { fadeSlideUp, staggerChildren } from '@renderer/lib/motion';
import {
  Badge,
  Button,
  Card,
  GlassPanel,
  Input,
  Select,
  Skeleton,
  Spinner,
} from '@renderer/components/ui';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string };

/** The set of AI provider ids that can be selected as the active engine. */
const AI_IDS: AIProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama', 'mock'];

function isAiProviderId(id: string): id is AIProviderId {
  return (AI_IDS as string[]).includes(id);
}

/**
 * A single AI provider card: API-key management, model selection, an active
 * radio, and a live connection test. Purely presentational apart from the
 * callbacks it receives.
 */
function ProviderCard({
  provider,
  active,
  onActivate,
  onChanged,
}: {
  provider: ProviderDescriptor;
  active: boolean;
  onActivate: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [keyDraft, setKeyDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  const providerId = isAiProviderId(provider.id) ? provider.id : undefined;
  const selectedModel = providerId ? settings.aiProviderSettings[providerId]?.model : undefined;

  const modelOptions = useMemo(
    () => (provider.models ?? []).map((m) => ({ value: m, label: m })),
    [provider.models],
  );

  const radioId = `provider-active-${provider.id}`;

  async function handleSaveKey(): Promise<void> {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await api.providers.setApiKey(provider.id, trimmed);
      setKeyDraft('');
      setReveal(false);
      setTest({ status: 'idle' });
      toast.success('API key saved', { description: `${provider.name} is ready to use.` });
      onChanged();
    } catch (e) {
      toast.error('Could not save API key', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey(): Promise<void> {
    setClearing(true);
    try {
      await api.providers.clearApiKey(provider.id);
      setTest({ status: 'idle' });
      toast.info('API key removed', { description: `${provider.name} key cleared from the vault.` });
      onChanged();
    } catch (e) {
      toast.error('Could not clear API key', { description: (e as Error).message });
    } finally {
      setClearing(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTest({ status: 'testing' });
    try {
      const result = await api.providers.test(provider.id);
      setTest({ status: result.ok ? 'ok' : 'fail', message: result.message });
    } catch (e) {
      setTest({ status: 'fail', message: (e as Error).message });
    }
  }

  async function handleModelChange(model: string): Promise<void> {
    if (!providerId) return;
    const current = settings.aiProviderSettings[providerId] ?? {};
    const next: AppSettings['aiProviderSettings'] = {
      ...settings.aiProviderSettings,
      [providerId]: { ...current, model },
    };
    await updateSettings({ aiProviderSettings: next });
  }

  return (
    <Card
      padding="lg"
      className={cn(
        'relative transition-colors',
        active && 'ring-1 ring-primary/60 ring-offset-0',
      )}
    >
      <div className="flex flex-col gap-4">
        {/* Header: radio + name + status */}
        <div className="flex items-start gap-3">
          <input
            id={radioId}
            type="radio"
            name="active-ai-provider"
            checked={active}
            onChange={onActivate}
            disabled={!provider.available}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Use ${provider.name} as the active AI provider`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={radioId} className="cursor-pointer font-display font-semibold text-t1">
                {provider.name}
              </label>
              {active && (
                <Badge variant="primary" solid leftIcon={<Check size={12} />}>
                  Active
                </Badge>
              )}
              {!provider.requiresApiKey && (
                <Badge variant="success" leftIcon={<ShieldCheck size={12} />}>
                  Works offline
                </Badge>
              )}
              {provider.requiresApiKey &&
                (provider.hasApiKey ? (
                  <Badge variant="success" leftIcon={<KeyRound size={12} />}>
                    Key saved
                  </Badge>
                ) : (
                  <Badge variant="amber">Key needed</Badge>
                ))}
            </div>
            <p className="mt-1 text-sm text-t3">{provider.description}</p>
          </div>
        </div>

        {/* API key row */}
        {provider.requiresApiKey && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              className="flex-1"
              label="API key"
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.hasApiKey ? '••••••••••••  (a key is saved)' : 'Paste your API key'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveKey();
              }}
              leftIcon={<KeyRound size={16} />}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  className="rounded p-0.5 text-t3 transition-colors hover:text-t1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  aria-label={reveal ? 'Hide API key' : 'Show API key'}
                >
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={handleSaveKey}
                loading={saving}
                disabled={!keyDraft.trim()}
              >
                Save
              </Button>
              {provider.hasApiKey && (
                <Button variant="ghost" onClick={handleClearKey} loading={clearing}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Model + test row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {modelOptions.length > 0 ? (
            <Select
              className="sm:w-64"
              label="Model"
              options={modelOptions}
              value={selectedModel ?? modelOptions[0]?.value ?? ''}
              onChange={(e) => void handleModelChange(e.target.value)}
            />
          ) : (
            <span />
          )}

          <div className="flex items-center gap-3">
            {test.status === 'ok' && (
              <Badge variant="success" leftIcon={<Check size={12} />}>
                Connected
              </Badge>
            )}
            {test.status === 'fail' && (
              <Badge variant="rose" leftIcon={<X size={12} />}>
                Failed
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={test.status === 'testing'}
              leftIcon={
                test.status === 'testing' ? <Spinner size={14} /> : <Sparkles size={14} />
              }
            >
              {test.status === 'testing' ? 'Testing…' : 'Test'}
            </Button>
          </div>
        </div>

        {test.message && (test.status === 'ok' || test.status === 'fail') && (
          <p className={cn('text-xs', test.status === 'ok' ? 'text-success' : 'text-rose')}>
            {test.message}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * AI Providers settings section. Lists every configurable AI engine, lets the
 * student store/clear API keys, pick a model, choose the active provider, and
 * run a live connection test. Reassures that the app works fully offline.
 */
export function ProvidersSection(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { data, loading, error, reload } = useAsync(() => api.providers.list(), []);

  const aiProviders = useMemo(
    () => (data ?? []).filter((p) => p.kind === 'ai'),
    [data],
  );

  async function activate(id: string): Promise<void> {
    if (!isAiProviderId(id)) return;
    await updateSettings({ aiProvider: id });
  }

  return (
    <div className="space-y-4">
      <GlassPanel className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary">
          <ShieldCheck size={18} />
        </span>
        <div>
          <p className="font-display font-semibold text-t1">Works fully offline, no key required</p>
          <p className="text-sm text-t3">
            The built-in demo AI powers everything out of the box. Add your own provider key any
            time for higher-quality analysis — it is stored in your device&apos;s encrypted vault,
            never synced.
          </p>
        </div>
      </GlassPanel>

      {loading && (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Card key={i} padding="lg">
              <Skeleton height={20} width="40%" />
              <Skeleton className="mt-3" height={14} width="80%" />
              <Skeleton className="mt-4" height={38} />
            </Card>
          ))}
        </div>
      )}

      {error && !loading && (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-t2">We couldn&apos;t load your providers.</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={reload}>
            Try again
          </Button>
        </Card>
      )}

      {!loading && !error && (
        <motion.div
          className="space-y-4"
          variants={staggerChildren}
          initial="hidden"
          animate="show"
        >
          {aiProviders.map((p) => (
            <motion.div key={p.id} variants={fadeSlideUp}>
              <ProviderCard
                provider={p}
                active={settings.aiProvider === p.id}
                onActivate={() => void activate(p.id)}
                onChanged={reload}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
