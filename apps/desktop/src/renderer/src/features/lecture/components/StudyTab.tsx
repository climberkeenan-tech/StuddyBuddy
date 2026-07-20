import { useState } from 'react';
import { ArrowLeft, Sparkles, Wand2 } from 'lucide-react';
import type { Difficulty, MaterialType, StudyMaterialMeta } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useToast } from '@renderer/components/toast';
import { Badge, Button, Card, EmptyState, SegmentedControl } from '@renderer/components/ui';
import { relativeTime } from '@renderer/lib/format';
import { MATERIAL_META, difficultyVariant } from '../lecture-utils';
import { FlashcardReviewer } from './FlashcardReviewer';
import { QuizPlayer } from './QuizPlayer';

/** Material types offered as generate-on-demand actions in this tab. */
const OFFERED: MaterialType[] = ['flashcards', 'quiz-mcq', 'quiz-short-answer', 'summary-concise', 'notes'];

const QUIZ_TYPES: MaterialType[] = ['quiz-mcq', 'quiz-short-answer', 'practice-test'];

export interface StudyTabProps {
  lectureId: string;
  materials: StudyMaterialMeta[];
  processing: boolean;
  onReload: () => void;
}

type Active = { kind: 'flashcards' | 'quiz'; materialId: string; title: string } | null;

/**
 * The active-recall tab. Lists every study material generated for the lecture,
 * launches a FlashcardReviewer or QuizPlayer for interactive ones, and offers
 * one-tap generation (at a chosen difficulty) for material types not yet made.
 */
export function StudyTab({ lectureId, materials, processing, onReload }: StudyTabProps) {
  const toast = useToast();
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [busyType, setBusyType] = useState<MaterialType | null>(null);
  const [active, setActive] = useState<Active>(null);

  const present = new Set(materials.map((m) => m.type));
  const missing = OFFERED.filter((t) => !present.has(t));

  async function generate(type: MaterialType) {
    setBusyType(type);
    try {
      await api.materials.generate(lectureId, type, { difficulty });
      toast.success(`${MATERIAL_META[type].label} ready`);
      onReload();
    } catch (e) {
      toast.error('Could not generate material', { description: (e as Error).message });
    } finally {
      setBusyType(null);
    }
  }

  if (active) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setActive(null)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-t2 transition-colors hover:text-t1"
          >
            <ArrowLeft size={16} /> Back to materials
          </button>
          <span className="truncate text-sm font-medium text-t3">{active.title}</span>
        </div>
        {active.kind === 'flashcards' ? (
          <FlashcardReviewer materialId={active.materialId} />
        ) : (
          <QuizPlayer materialId={active.materialId} lectureId={lectureId} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Generation controls */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-t1">
              <Wand2 size={16} className="text-primary" /> Generate study material
            </h3>
            <p className="mt-0.5 text-xs text-t3">Pick a difficulty, then create anything you’re missing.</p>
          </div>
          <SegmentedControl<Difficulty>
            aria-label="Generation difficulty"
            size="sm"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
        </div>
        {missing.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {missing.map((type) => {
              const meta = MATERIAL_META[type];
              const Icon = meta.icon;
              return (
                <Button
                  key={type}
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icon size={15} />}
                  loading={busyType === type}
                  disabled={busyType !== null || processing}
                  onClick={() => generate(type)}
                >
                  {meta.label}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-t3">You’ve generated every material type for this lecture. Nice and thorough.</p>
        )}
      </Card>

      {/* Materials list */}
      {materials.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={22} />}
          title={processing ? 'Still processing…' : 'No study materials yet'}
          hint={
            processing
              ? 'Once this lecture is ready you can build flashcards, quizzes, and summaries in a tap.'
              : 'Generate a study kit from the header, or create individual materials above.'
          }
        />
      ) : (
        <div className="space-y-2">
          {materials.map((m) => {
            const meta = MATERIAL_META[m.type];
            const Icon = meta.icon;
            const isQuiz = QUIZ_TYPES.includes(m.type);
            const isCards = m.type === 'flashcards';
            return (
              <Card key={m.id} padding="sm" className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary">
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-t1">{m.title}</p>
                  <p className="flex items-center gap-2 text-xs text-t3">
                    <span>{meta.label}</span>
                    <span aria-hidden>·</span>
                    <span>{relativeTime(m.createdAt)}</span>
                  </p>
                </div>
                <Badge variant={difficultyVariant(m.difficulty)}>{m.difficulty}</Badge>
                {isCards && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setActive({ kind: 'flashcards', materialId: m.id, title: m.title })}
                  >
                    Review
                  </Button>
                )}
                {isQuiz && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setActive({ kind: 'quiz', materialId: m.id, title: m.title })}
                  >
                    Take quiz
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
