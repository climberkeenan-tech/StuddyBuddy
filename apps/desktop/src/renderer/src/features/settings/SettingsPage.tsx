import { useState } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Database, Info, Mic, Palette, Puzzle, Sparkles } from 'lucide-react';
import { usePageTitle } from '@renderer/lib/hooks';
import { PageHeader } from '@renderer/components/layout';
import { Tabs } from '@renderer/components/ui';
import { fadeSlideUp } from '@renderer/lib/motion';
import { ProvidersSection } from './ProvidersSection';
import {
  AboutSection,
  AppearanceSection,
  DataSection,
  PluginsSection,
  SettingsSection,
  StudySection,
  TranscriptionSection,
} from './sections';

type SectionKey =
  | 'providers'
  | 'transcription'
  | 'appearance'
  | 'study'
  | 'data'
  | 'plugins'
  | 'about';

const TAB_ITEMS: { value: SectionKey; label: string; icon: React.ReactNode }[] = [
  { value: 'providers', label: 'AI Providers', icon: <Cpu size={15} /> },
  { value: 'transcription', label: 'Transcription', icon: <Mic size={15} /> },
  { value: 'appearance', label: 'Appearance', icon: <Palette size={15} /> },
  { value: 'study', label: 'Study', icon: <Sparkles size={15} /> },
  { value: 'data', label: 'Data & Backup', icon: <Database size={15} /> },
  { value: 'plugins', label: 'Plugins', icon: <Puzzle size={15} /> },
  { value: 'about', label: 'About', icon: <Info size={15} /> },
];

/**
 * The Settings page. A tabbed control center for AI providers, transcription,
 * appearance, study behavior, data & backup, plugins, and app info. Every change
 * persists through the app store / api and is reflected on load.
 */
export default function SettingsPage(): JSX.Element {
  usePageTitle('Settings', 'Providers, appearance, data, and more.');
  const [section, setSection] = useState<SectionKey>('providers');

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Tune StuddyBuddy to fit the way you study." />

      <Tabs
        aria-label="Settings sections"
        items={TAB_ITEMS}
        value={section}
        onChange={(v) => setSection(v as SectionKey)}
      />

      <motion.div key={section} variants={fadeSlideUp} initial="hidden" animate="show">
        {section === 'providers' && (
          <SettingsSection
            title="AI Providers"
            description="Pick the engine that analyzes your lectures and generates study materials."
          >
            <ProvidersSection />
          </SettingsSection>
        )}
        {section === 'transcription' && <TranscriptionSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'study' && <StudySection />}
        {section === 'data' && <DataSection />}
        {section === 'plugins' && <PluginsSection />}
        {section === 'about' && <AboutSection />}
      </motion.div>
    </div>
  );
}
