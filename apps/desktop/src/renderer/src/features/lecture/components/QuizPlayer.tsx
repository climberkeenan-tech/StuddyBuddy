import { useRef, useState } from 'react';
import { Check, RotateCcw, Trophy, X } from 'lucide-react';
import type { QuizAnswer, QuizContent, QuizQuestion, StudyMaterial } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync } from '@renderer/lib/hooks';
import { useToast } from '@renderer/components/toast';
import { Button, Card, Markdown, Progress, Skeleton, Textarea } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';

export interface QuizPlayerProps {
  materialId: string;
  lectureId: string;
}

/**
 * An interactive quiz runner supporting both multiple-choice and short-answer
 * questions. MCQs reveal the correct choice and an explanation on selection;
 * short answers are AI-graded against the rubric. Progress is tracked and the
 * completed attempt is submitted for scoring and weak-area tracking.
 */
export function QuizPlayer({ materialId, lectureId }: QuizPlayerProps) {
  const toast = useToast();
  const startedAt = useRef(Date.now());
  const { data: material, loading } = useAsync<StudyMaterial | null>(
    () => api.materials.get(materialId),
    [materialId],
  );

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<{ score: number; feedback: string } | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <Skeleton height={280} />;
  const isQuiz =
    material &&
    (material.type === 'quiz-mcq' || material.type === 'quiz-short-answer' || material.type === 'practice-test');
  if (!material || !isQuiz) {
    return <p className="py-8 text-center text-sm text-t3">This quiz couldn’t be loaded.</p>;
  }

  const questions: QuizQuestion[] = (material.content as QuizContent).questions;
  if (questions.length === 0) {
    return <p className="py-8 text-center text-sm text-t3">This quiz has no questions yet.</p>;
  }

  const question = questions[index];

  function reset() {
    setSelected(null);
    setText('');
    setRevealed(false);
    setGrade(null);
  }

  function restart() {
    reset();
    setIndex(0);
    setAnswers([]);
    setFinalScore(null);
    startedAt.current = Date.now();
  }

  async function checkShortAnswer(q: Extract<QuizQuestion, { kind: 'short-answer' }>) {
    setGrading(true);
    try {
      const result = await api.quizzes.gradeShortAnswer({ materialId, questionId: q.id, response: text });
      setGrade(result);
      setRevealed(true);
    } catch (e) {
      toast.error('Could not grade your answer', { description: (e as Error).message });
    } finally {
      setGrading(false);
    }
  }

  function currentAnswer(): QuizAnswer | null {
    if (!question) return null;
    if (question.kind === 'mcq') {
      if (selected === null) return null;
      const correct = selected === question.correctIndex;
      return { questionId: question.id, response: selected, correct, score: correct ? 1 : 0 };
    }
    if (!grade) return null;
    return { questionId: question.id, response: text, correct: grade.score >= 0.5, score: grade.score };
  }

  async function next() {
    const answer = currentAnswer();
    if (!answer) return;
    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    if (index + 1 >= questions.length) {
      setSubmitting(true);
      try {
        const attempt = await api.quizzes.submitAttempt({
          materialId,
          lectureId,
          answers: nextAnswers,
          startedAt: startedAt.current,
          finishedAt: Date.now(),
        });
        setFinalScore(attempt.score);
      } catch (e) {
        toast.error('Could not submit your attempt', { description: (e as Error).message });
        setFinalScore(nextAnswers.reduce((s, a) => s + a.score, 0) / nextAnswers.length);
      } finally {
        setSubmitting(false);
      }
    } else {
      reset();
      setIndex((i) => i + 1);
    }
  }

  if (finalScore !== null) {
    const pct = Math.round(finalScore * 100);
    const aced = finalScore >= 0.9;
    return (
      <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
        <span
          className={cn(
            'flex h-16 w-16 items-center justify-center rounded-2xl',
            aced ? 'bg-gradient-gold text-white' : 'bg-gradient-primary-soft text-primary',
          )}
        >
          <Trophy size={28} />
        </span>
        <div>
          <h3 className="font-display text-2xl font-semibold text-t1">{pct}%</h3>
          <p className="mt-1 text-sm text-t3">
            {aced
              ? 'Outstanding — you’ve got this cold.'
              : pct >= 60
                ? 'Solid work. Revisit the ones you missed and you’ll nail it.'
                : 'Good effort. Review the concepts above and give it another go.'}
          </p>
        </div>
        <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={restart}>
          Retake quiz
        </Button>
      </Card>
    );
  }

  if (!question) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={index / questions.length} aria-label="Quiz progress" className="flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-t3">
          {index + 1} / {questions.length}
        </span>
      </div>

      <Card padding="lg" className="space-y-4">
        <p className="font-display text-base font-semibold text-t1">{question.prompt}</p>

        {question.kind === 'mcq' ? (
          <div className="space-y-2">
            {question.choices.map((choice, i) => {
              const isCorrect = i === question.correctIndex;
              const isChosen = i === selected;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={revealed}
                  onClick={() => {
                    setSelected(i);
                    setRevealed(true);
                  }}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default',
                    !revealed && 'border-stroke bg-surface hover:border-primary/40 hover:bg-overlay',
                    revealed && isCorrect && 'border-success/50 bg-success/10 text-t1',
                    revealed && isChosen && !isCorrect && 'border-rose/50 bg-rose/10 text-t1',
                    revealed && !isCorrect && !isChosen && 'border-stroke bg-surface opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                      revealed && isCorrect
                        ? 'border-success bg-success text-white'
                        : revealed && isChosen && !isCorrect
                          ? 'border-rose bg-rose text-white'
                          : 'border-stroke-strong text-t3',
                    )}
                  >
                    {revealed && isCorrect ? (
                      <Check size={13} />
                    ) : revealed && isChosen && !isCorrect ? (
                      <X size={13} />
                    ) : (
                      String.fromCharCode(65 + i)
                    )}
                  </span>
                  <span>{choice}</span>
                </button>
              );
            })}
            {revealed && (
              <div className="rounded-xl border border-stroke bg-bg/50 p-3 text-sm text-t2">
                <span className="font-semibold text-t1">
                  {selected === question.correctIndex ? 'Correct! ' : 'Not quite. '}
                </span>
                {question.explanation}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={revealed}
              rows={4}
              placeholder="Type your answer in your own words…"
              aria-label="Your answer"
            />
            {!revealed ? (
              <Button
                variant="secondary"
                loading={grading}
                disabled={!text.trim() || grading}
                onClick={() => checkShortAnswer(question)}
              >
                Check answer
              </Button>
            ) : (
              grade && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-t1">Score: {Math.round(grade.score * 100)}%</span>
                  </div>
                  <p className="rounded-xl border border-stroke bg-bg/50 p-3 text-sm text-t2">{grade.feedback}</p>
                  <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Model answer
                    </p>
                    <Markdown>{question.modelAnswer}</Markdown>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </Card>

      {revealed && (
        <Button fullWidth loading={submitting} onClick={next}>
          {index + 1 >= questions.length ? 'Finish quiz' : 'Next question'}
        </Button>
      )}
    </div>
  );
}
