import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Archive,
  DatabaseBackup,
  FolderOpen,
  Info,
  Languages,
  Puzzle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type {
  AppSettings,
  Difficulty,
  PluginInfo,
  ThemeMode,
  TranscriptionProviderId,
} from '@studdybuddy/shared';
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
  EmptyState,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
} from '@renderer/components/ui';

// ————————————————————————————————————————————————————————————————
//  Shared layout helpers
// ————————————————————————————————————————————————————————————————

/** A titled settings block with an optional description. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-t1">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-t3">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A labelled row that pairs a control with an explanatory description. */
function SettingRow({
  label,
  description,
  htmlFor,
  control,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  control: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className={cn('font-medium text-t1', htmlFor && 'cursor-pointer')}
        >
          {label}
        </label>
        {description && <p className="mt-0.5 text-sm text-t3">{description}</p>}
      </div>
      <div className="shrink-0 sm:min-w-[220px] sm:text-right">{control}</div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
//  Transcription
// ————————————————————————————————————————————————————————————————

const TRANSCRIPTION_OPTIONS: {
  value: TranscriptionProviderId;
  label: string;
  description: string;
}[] = [
  {
    value: 'browser-whisper',
    label: 'On-device Whisper (recommended)',
    description:
      'Real speech-to-text that runs on your device — transcribes your microphone with no API key and no cloud. Downloads a small model once, then works offline.',
  },
  {
    value: 'simulated',
    label: 'Demo voice (not real)',
    description:
      'Sample text only — does NOT transcribe your microphone. For trying the app with no setup.',
  },
  {
    value: 'openai-whisper',
    label: 'OpenAI Whisper',
    description: 'Real speech-to-text with excellent accuracy. Transcribes what you actually say. Requires an OpenAI key.',
  },
  {
    value: 'whisper-cpp',
    label: 'whisper.cpp (local)',
    description: 'Fully on-device transcription using a local whisper.cpp build.',
  },
];

/** Transcription engine selection plus local whisper.cpp path configuration. */
export function TranscriptionSection(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [binaryPath, setBinaryPath] = useState(settings.whisperCpp?.binaryPath ?? '');
  const [modelPath, setModelPath] = useState(settings.whisperCpp?.modelPath ?? '');

  const current = settings.transcriptionProvider;

  async function saveWhisperPaths(): Promise<void> {
    await updateSettings({ whisperCpp: { binaryPath: binaryPath.trim(), modelPath: modelPath.trim() } });
  }

  return (
    <SettingsSection
      title="Transcription"
      description="Choose how your lectures are turned into text."
    >
      <motion.div
        className="grid gap-3 sm:grid-cols-2"
        variants={staggerChildren}
        initial="hidden"
        animate="show"
      >
        {TRANSCRIPTION_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          return (
            <motion.button
              key={opt.value}
              type="button"
              variants={fadeSlideUp}
              onClick={() => void updateSettings({ transcriptionProvider: opt.value })}
              aria-pressed={selected}
              className={cn(
                'rounded-panel border p-4 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                selected
                  ? 'border-primary/60 bg-gradient-primary-soft shadow-soft'
                  : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-panel',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-t1">{opt.label}</span>
                {selected && (
                  <Badge variant="primary" solid>
                    Selected
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-t3">{opt.description}</p>
            </motion.button>
          );
        })}
      </motion.div>

      {current === 'whisper-cpp' && (
        <Card padding="lg" className="space-y-4">
          <p className="text-sm text-t2">
            Point StuddyBuddy at your local whisper.cpp binary and model file.
          </p>
          <Input
            label="Binary path"
            placeholder="/usr/local/bin/whisper-cli"
            spellCheck={false}
            value={binaryPath}
            onChange={(e) => setBinaryPath(e.target.value)}
          />
          <Input
            label="Model path"
            placeholder="/models/ggml-base.en.bin"
            spellCheck={false}
            value={modelPath}
            onChange={(e) => setModelPath(e.target.value)}
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={saveWhisperPaths}>
              Save paths
            </Button>
          </div>
        </Card>
      )}
    </SettingsSection>
  );
}

// ————————————————————————————————————————————————————————————————
//  Appearance
// ————————————————————————————————————————————————————————————————

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const MOTION_OPTIONS: { value: AppSettings['reduceMotion']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'off', label: 'Full' },
  { value: 'on', label: 'Reduced' },
];

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
];

/** Theme, motion, default difficulty, and language preferences — applied live. */
export function AppearanceSection(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <SettingsSection title="Appearance" description="Make StuddyBuddy feel like yours.">
      <Card padding="lg" className="divide-y divide-stroke">
        <SettingRow
          label="Theme"
          description="Match your system or lock a look."
          control={
            <SegmentedControl
              aria-label="Theme"
              options={THEME_OPTIONS}
              value={settings.theme}
              onChange={(v) => void updateSettings({ theme: v })}
            />
          }
        />
        <SettingRow
          label="Motion"
          description="Reduce animations for comfort or accessibility."
          control={
            <SegmentedControl
              aria-label="Motion"
              options={MOTION_OPTIONS}
              value={settings.reduceMotion}
              onChange={(v) => void updateSettings({ reduceMotion: v })}
            />
          }
        />
        <SettingRow
          label="Default difficulty"
          description="The starting level for generated study materials."
          control={
            <SegmentedControl
              aria-label="Default difficulty"
              options={DIFFICULTY_OPTIONS}
              value={settings.defaultDifficulty}
              onChange={(v) => void updateSettings({ defaultDifficulty: v })}
            />
          }
        />
        <SettingRow
          label="Lecture language"
          htmlFor="setting-language"
          description="Helps transcription recognise the right words."
          control={
            <Select
              id="setting-language"
              className="sm:w-52"
              options={LANGUAGE_OPTIONS}
              value={settings.language}
              onChange={(e) => void updateSettings({ language: e.target.value })}
            />
          }
        />
      </Card>
    </SettingsSection>
  );
}

// ————————————————————————————————————————————————————————————————
//  Study
// ————————————————————————————————————————————————————————————————

/** Study-workflow preferences: auto study kits and audio retention. */
export function StudySection(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <SettingsSection title="Study" description="How StuddyBuddy handles each recorded lecture.">
      <Card padding="lg" className="divide-y divide-stroke">
        <SettingRow
          label="Auto-generate study kit"
          htmlFor="setting-autokit"
          description="Create notes, a summary, flashcards, and a quiz after every lecture."
          control={
            <Switch
              id="setting-autokit"
              checked={settings.autoGenerateStudyKit}
              onChange={(v) => void updateSettings({ autoGenerateStudyKit: v })}
            />
          }
        />
        <SettingRow
          label="Keep raw audio"
          htmlFor="setting-keepaudio"
          description="Store the original recording on disk after transcription completes."
          control={
            <Switch
              id="setting-keepaudio"
              checked={settings.keepAudio}
              onChange={(v) => void updateSettings({ keepAudio: v })}
            />
          }
        />
      </Card>
    </SettingsSection>
  );
}

// ————————————————————————————————————————————————————————————————
//  Data & Backup
// ————————————————————————————————————————————————————————————————

/** App info, backup export, and restore-from-backup with a confirm step. */
export function DataSection(): JSX.Element {
  const toast = useToast();
  const { data: info, loading } = useAsync(() => api.system.getInfo(), []);

  const [backingUp, setBackingUp] = useState(false);
  const [restorePath, setRestorePath] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  async function openDataDir(): Promise<void> {
    if (!info) return;
    try {
      await api.system.openPath(info.dataDir);
    } catch (e) {
      toast.error('Could not open folder', { description: (e as Error).message });
    }
  }

  async function handleBackup(): Promise<void> {
    setBackingUp(true);
    try {
      const { filePath } = await api.system.backup();
      toast.success('Backup created', {
        description: filePath,
        action: {
          label: 'Reveal',
          onClick: () => {
            void api.system.openPath(filePath);
          },
        },
      });
    } catch (e) {
      toast.error('Backup failed', { description: (e as Error).message });
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestore(): Promise<void> {
    setRestoring(true);
    try {
      await api.system.restore(restorePath.trim());
      setConfirmOpen(false);
      setRestorePath('');
      toast.success('Restore complete', {
        description: 'Your knowledge base was restored from the backup.',
      });
    } catch (e) {
      toast.error('Restore failed', { description: (e as Error).message });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <SettingsSection
      title="Data & Backup"
      description="Everything lives on your device. Export a snapshot or restore one."
    >
      <Card padding="lg" className="space-y-4">
        {loading ? (
          <Skeleton height={44} />
        ) : info ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-t1">Data folder</p>
              <p className="truncate font-mono text-xs text-t3">{info.dataDir}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<FolderOpen size={15} />}
              onClick={openDataDir}
            >
              Open folder
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card padding="lg" className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-t1">
            <Archive size={18} className="text-primary" />
            <span className="font-display font-semibold">Back up now</span>
          </div>
          <p className="flex-1 text-sm text-t3">
            Save every course, lecture, and study material to a single portable file.
          </p>
          <Button variant="secondary" loading={backingUp} onClick={handleBackup}>
            Create backup
          </Button>
        </Card>

        <Card padding="lg" className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-t1">
            <RotateCcw size={18} className="text-primary" />
            <span className="font-display font-semibold">Restore</span>
          </div>
          <Input
            label="Backup file path"
            placeholder="/path/to/studdybuddy-backup.zip"
            spellCheck={false}
            value={restorePath}
            onChange={(e) => setRestorePath(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!restorePath.trim()}
            onClick={() => setConfirmOpen(true)}
          >
            Restore from file
          </Button>
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Restore from backup?"
        description="This replaces your current library with the contents of the backup. This can't be undone."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={restoring} onClick={handleRestore}>
              Restore
            </Button>
          </div>
        }
      >
        <p className="text-sm text-t2">
          Restoring from{' '}
          <span className="font-mono text-t1">{restorePath.trim() || 'the selected file'}</span>.
        </p>
      </Modal>
    </SettingsSection>
  );
}

// ————————————————————————————————————————————————————————————————
//  Plugins
// ————————————————————————————————————————————————————————————————

/** Enable/disable installed plugins. Built-ins are locked on. */
export function PluginsSection(): JSX.Element {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.plugins.list(), []);
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(plugin: PluginInfo, enabled: boolean): Promise<void> {
    setPending(plugin.id);
    try {
      await api.plugins.setEnabled(plugin.id, enabled);
      toast.success(enabled ? 'Plugin enabled' : 'Plugin disabled', {
        description: plugin.name,
      });
      reload();
    } catch (e) {
      toast.error('Could not update plugin', { description: (e as Error).message });
    } finally {
      setPending(null);
    }
  }

  return (
    <SettingsSection
      title="Plugins"
      description="Extend StuddyBuddy with providers, exporters, and visualizations."
    >
      {loading && (
        <Card padding="lg">
          <Skeleton height={20} width="30%" />
          <Skeleton className="mt-3" height={16} width="70%" />
        </Card>
      )}

      {error && !loading && (
        <EmptyState
          icon={<Puzzle size={22} />}
          title="Couldn't load plugins"
          hint="Something went wrong reading the plugin registry."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {!loading && !error && data && data.length === 0 && (
        <EmptyState icon={<Puzzle size={22} />} title="No plugins installed yet" />
      )}

      {!loading && !error && data && data.length > 0 && (
        <Card padding="lg" className="divide-y divide-stroke">
          {data.map((plugin) => {
            const switchId = `plugin-${plugin.id}`;
            return (
              <div
                key={plugin.id}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-t1">{plugin.name}</span>
                    <Badge variant="neutral">v{plugin.version}</Badge>
                    {plugin.builtIn ? (
                      <Badge variant="sky">Built-in</Badge>
                    ) : (
                      <Badge variant="bronze">Community</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-t3">{plugin.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {plugin.builtIn && <span className="text-xs text-t3">Locked on</span>}
                  <Switch
                    id={switchId}
                    checked={plugin.enabled}
                    disabled={plugin.builtIn || pending === plugin.id}
                    onChange={(v) => void toggle(plugin, v)}
                    label={`${plugin.name} ${plugin.enabled ? 'enabled' : 'disabled'}`}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </SettingsSection>
  );
}

// ————————————————————————————————————————————————————————————————
//  About
// ————————————————————————————————————————————————————————————————

/** App version and friendly credits. */
export function AboutSection(): JSX.Element {
  const { data: info } = useAsync(() => api.system.getInfo(), []);

  return (
    <SettingsSection title="About" description="The little study companion that has your back.">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-panel bg-gradient-primary text-white shadow-glow">
            <Sparkles size={22} />
          </span>
          <div>
            <p className="font-display text-lg font-semibold text-t1">StuddyBuddy</p>
            <p className="text-sm text-t3">
              Version {info?.version ?? '—'}
              {info?.platform ? ` · ${info.platform}` : ''}
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-start gap-2 text-sm text-t2">
            <Languages size={16} className="mt-0.5 shrink-0 text-primary" />
            <span>Your AI lecture companion — record, understand, and remember every class.</span>
          </div>
          <div className="flex items-start gap-2 text-sm text-t2">
            <DatabaseBackup size={16} className="mt-0.5 shrink-0 text-primary" />
            <span>Private by design. Your notes live on your device, not in the cloud.</span>
          </div>
          <div className="flex items-start gap-2 text-sm text-t2">
            <Info size={16} className="mt-0.5 shrink-0 text-primary" />
            <span>Made with care for students who deserve better study tools.</span>
          </div>
        </div>
      </Card>
    </SettingsSection>
  );
}
