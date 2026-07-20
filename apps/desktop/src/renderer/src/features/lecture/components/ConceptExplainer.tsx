import { useEffect, useRef, useState } from 'react';
import { HelpCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { Explanation } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useToast } from '@renderer/components/toast';
import { Badge, Button, Markdown, Modal, Spinner } from '@renderer/components/ui';
import { Mermaid } from './Mermaid';

const STYLE_LABEL: Record<Explanation['style'], string> = {
  simple: 'Plain language',
  analogy: 'By analogy',
  'step-by-step': 'Step by step',
  visual: 'Visual diagram',
  example: 'Worked example',
};

export interface ConceptExplainerProps {
  open: boolean;
  onClose: () => void;
  lectureId: string;
  /** Concept to explain; drives the request. */
  conceptName: string | null;
}

/**
 * A modal that asks the AI to explain a concept from the lecture. Each
 * "I still don't understand" press re-requests the explanation at a higher
 * attempt, which cycles the teaching style (plain → analogy → steps → example →
 * visual), and appends the fresh take so the student can compare approaches.
 */
export function ConceptExplainer({ open, onClose, lectureId, conceptName }: ConceptExplainerProps) {
  const toast = useToast();
  const [explanations, setExplanations] = useState<Explanation[]>([]);
  const [loading, setLoading] = useState(false);
  const attemptRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function request(attempt: number) {
    if (!conceptName) return;
    setLoading(true);
    try {
      const result = await api.explain.concept({ lectureId, conceptName, attempt });
      attemptRef.current = attempt;
      setExplanations((prev) => (attempt === 1 ? [result] : [...prev, result]));
    } catch (e) {
      toast.error('Could not load an explanation', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  // Kick off the first explanation whenever the modal opens for a concept.
  useEffect(() => {
    if (open && conceptName) {
      setExplanations([]);
      attemptRef.current = 0;
      void request(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conceptName, lectureId]);

  // Keep the newest explanation in view as the thread grows.
  useEffect(() => {
    if (explanations.length > 1) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [explanations.length]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          {conceptName ?? 'Explain concept'}
        </span>
      }
      description="A friendly, AI-generated walkthrough. Not clicking yet? Ask for another angle."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={15} />}
            loading={loading && explanations.length > 0}
            disabled={loading || explanations.length === 0}
            onClick={() => void request(attemptRef.current + 1)}
          >
            I still don&apos;t understand
          </Button>
        </>
      }
    >
      <div ref={scrollRef} className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
        {explanations.length === 0 && loading && (
          <div className="flex items-center justify-center py-10">
            <Spinner label="Thinking it through…" />
          </div>
        )}

        {explanations.map((ex, i) => (
          <article key={i} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="primary" leftIcon={<HelpCircle size={12} />}>
                {STYLE_LABEL[ex.style]}
              </Badge>
              {i > 0 && <span className="text-xs text-t3">Another angle</span>}
            </div>
            <Markdown>{ex.markdown}</Markdown>
            {ex.mermaid && <Mermaid code={ex.mermaid} />}
            {i < explanations.length - 1 && <hr className="border-stroke" />}
          </article>
        ))}

        {explanations.length > 0 && loading && (
          <div className="flex items-center gap-2 text-sm text-t3">
            <Spinner size={14} />
            Finding another way to explain it…
          </div>
        )}
      </div>
    </Modal>
  );
}
