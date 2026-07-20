import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookOpenText, FileText, GraduationCap, ListTree, NotebookPen } from 'lucide-react';
import type { Course, LectureAnalysis, Transcript } from '@studdybuddy/shared';
import type { Lecture } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync, useIpcEvent, usePageTitle } from '@renderer/lib/hooks';
import { useToast } from '@renderer/components/toast';
import { Button, EmptyState, Skeleton, Tabs } from '@renderer/components/ui';
import { LectureHeader } from './components/LectureHeader';
import { TranscriptTab } from './components/TranscriptTab';
import { NotesTab } from './components/NotesTab';
import { ConceptsTab } from './components/ConceptsTab';
import { StudyTab } from './components/StudyTab';

interface CoreData {
  lecture: Lecture | null;
  course: Course | null;
  analysis: LectureAnalysis | null;
  transcript: Transcript | null;
}

type TabValue = 'transcript' | 'notes' | 'concepts' | 'study';

const TABS = [
  { value: 'transcript' as const, label: 'Transcript', icon: <FileText size={15} /> },
  { value: 'notes' as const, label: 'Notes', icon: <NotebookPen size={15} /> },
  { value: 'concepts' as const, label: 'Concepts', icon: <ListTree size={15} /> },
  { value: 'study' as const, label: 'Study', icon: <GraduationCap size={15} /> },
];

/**
 * The lecture workspace — the app's richest page. Loads a lecture's transcript,
 * AI analysis, and study materials, and presents them across four tabs
 * (Transcript, Notes, Concepts, Study) beneath a sticky, course-tinted header
 * that launches slides, interactive mode, AI Q&A, and study-kit generation.
 */
export default function LecturePage() {
  const { lectureId, courseId } = useParams<{ lectureId: string; courseId: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<TabValue>('transcript');
  const [kitJobId, setKitJobId] = useState<string | null>(null);

  const core = useAsync<CoreData>(async () => {
    if (!lectureId) return { lecture: null, course: null, analysis: null, transcript: null };
    const [lecture, analysis, transcript] = await Promise.all([
      api.lectures.get(lectureId),
      api.analysis.get(lectureId),
      api.transcripts.get(lectureId),
    ]);
    const resolvedCourseId = lecture?.courseId ?? courseId;
    const course = resolvedCourseId ? await api.courses.get(resolvedCourseId) : null;
    return { lecture, course, analysis, transcript };
  }, [lectureId, courseId]);

  const materials = useAsync(
    () => (lectureId ? api.materials.list(lectureId) : Promise.resolve([])),
    [lectureId],
  );

  const lecture = core.data?.lecture ?? null;
  usePageTitle(lecture?.title ?? 'Lecture', 'Transcript, analysis, and study materials.');

  // Refresh when this lecture finishes its pipeline or a background job completes.
  useIpcEvent('lecture:ready', (p) => {
    if (p.lectureId === lectureId) {
      core.reload();
      materials.reload();
    }
  });
  useIpcEvent('job:progress', (p) => {
    if (p.jobId === kitJobId && (p.state === 'succeeded' || p.state === 'failed')) {
      setKitJobId(null);
      materials.reload();
      core.reload();
    }
  });

  async function generateKit() {
    if (!lectureId) return;
    try {
      const { jobId } = await api.materials.generateKit(lectureId);
      setKitJobId(jobId);
      toast.info('Building your study kit…', { description: 'Notes, flashcards and a quiz — this only takes a moment.' });
    } catch (e) {
      toast.error('Could not start study-kit generation', { description: (e as Error).message });
    }
  }

  const analysis = core.data?.analysis ?? undefined;
  const transcript = core.data?.transcript ?? undefined;
  const processing = lecture?.status === 'processing' || lecture?.status === 'recording';
  const notesMeta = useMemo(() => (materials.data ?? []).find((m) => m.type === 'notes'), [materials.data]);
  const topics = lecture?.topics.length ? lecture.topics : (analysis?.concepts.slice(0, 3).map((c) => c.name) ?? []);

  if (core.loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton height={16} width={160} />
          <Skeleton height={32} width="55%" />
          <Skeleton height={16} width={220} />
        </div>
        <Skeleton height={40} />
        <Skeleton height={240} />
      </div>
    );
  }

  if (!lecture) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={<BookOpenText size={22} />}
          title="Lecture not found"
          hint="This lecture may have been removed. Head back to your courses to keep studying."
          action={<Button onClick={() => nav('/')}>Back to dashboard</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LectureHeader
        lecture={lecture}
        course={core.data?.course ?? undefined}
        topics={topics}
        onGenerateKit={generateKit}
        generatingKit={kitJobId !== null}
      />

      <Tabs items={TABS} value={tab} onChange={(v) => setTab(v as TabValue)} aria-label="Lecture workspace" />

      <div role="tabpanel">
        {tab === 'transcript' && (
          <TranscriptTab lectureId={lecture.id} transcript={transcript} processing={Boolean(processing)} />
        )}
        {tab === 'notes' && (
          <NotesTab
            lectureId={lecture.id}
            notesMeta={notesMeta}
            processing={Boolean(processing)}
            onGenerated={() => materials.reload()}
          />
        )}
        {tab === 'concepts' && (
          <ConceptsTab lectureId={lecture.id} analysis={analysis} processing={Boolean(processing)} />
        )}
        {tab === 'study' && (
          <StudyTab
            lectureId={lecture.id}
            materials={materials.data ?? []}
            processing={Boolean(processing)}
            onReload={() => materials.reload()}
          />
        )}
      </div>
    </div>
  );
}
