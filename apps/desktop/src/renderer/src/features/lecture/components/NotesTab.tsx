import { useState } from 'react';
import { NotebookPen, Sparkles } from 'lucide-react';
import type { NoteBlock, NotesContent, StudyMaterial, StudyMaterialMeta } from '@studdybuddy/shared';
import { api } from '@renderer/lib/api';
import { useAsync } from '@renderer/lib/hooks';
import { useToast } from '@renderer/components/toast';
import { Button, Card, EmptyState, Skeleton } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { InlineText, calloutMeta } from '../lecture-utils';

export interface NotesTabProps {
  lectureId: string;
  /** The notes material for this lecture, if one has been generated. */
  notesMeta: StudyMaterialMeta | undefined;
  /** True while the lecture analysis is still being produced. */
  processing: boolean;
  /** Called after generating notes so the parent can refresh its material list. */
  onGenerated: () => void;
}

/**
 * Renders AI-generated study notes as a rich document — heading hierarchy,
 * bullet lists, and semantic callout blocks (definitions, examples, warnings,
 * common mistakes, key facts, formulas) with keyword highlighting. Offers a
 * one-click generate action when no notes exist yet.
 */
export function NotesTab({ lectureId, notesMeta, processing, onGenerated }: NotesTabProps) {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);

  const { data: material, loading } = useAsync<StudyMaterial | null>(
    () => (notesMeta ? api.materials.get(notesMeta.id) : Promise.resolve(null)),
    [notesMeta?.id],
  );

  async function generate() {
    setGenerating(true);
    try {
      await api.materials.generate(lectureId, 'notes');
      toast.success('Study notes ready');
      onGenerated();
    } catch (e) {
      toast.error('Could not generate notes', { description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  if (notesMeta && loading) {
    return (
      <div className="space-y-3">
        <Skeleton height={28} width="40%" />
        <Skeleton height={16} />
        <Skeleton height={16} width="90%" />
        <Skeleton height={64} />
        <Skeleton height={16} width="80%" />
      </div>
    );
  }

  if (!notesMeta || !material || material.type !== 'notes') {
    return (
      <EmptyState
        icon={<NotebookPen size={22} />}
        title="No study notes yet"
        hint={
          processing
            ? 'This lecture is still processing. You can generate polished notes as soon as it’s ready.'
            : 'Turn this lecture into clean, structured notes with definitions, key facts, and common mistakes called out.'
        }
        action={
          <Button leftIcon={<Sparkles size={16} />} loading={generating} disabled={processing} onClick={generate}>
            Generate notes
          </Button>
        }
      />
    );
  }

  return (
    <Card padding="lg" className="space-y-4">
      {(material.content as NotesContent).blocks.map((block) => (
        <NoteBlockView key={block.id} block={block} />
      ))}
    </Card>
  );
}

function NoteBlockView({ block }: { block: NoteBlock }) {
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 2;
      const cls =
        level === 1
          ? 'text-xl font-semibold text-t1 first:mt-0 mt-2'
          : level === 2
            ? 'text-lg font-semibold text-t1 mt-3'
            : 'text-base font-semibold text-t2 mt-2';
      return <h3 className={cn('font-display', cls)}>{block.text}</h3>;
    }
    case 'paragraph':
      return (
        <p className="text-sm leading-relaxed text-t2">
          <InlineText text={block.text ?? ''} keywords={block.keywords} />
        </p>
      );
    case 'bullets':
      return (
        <ul className="space-y-1.5 pl-1">
          {(block.items ?? []).map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-t2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>
                <InlineText text={item} keywords={block.keywords} />
              </span>
            </li>
          ))}
        </ul>
      );
    default: {
      // Callout blocks: definition, example, warning, mistake, fact, formula.
      const { Icon, label, icon, ring, tint } = calloutMeta(block.type, block.icon, block.accent);
      const heading = block.term ?? label;
      return (
        <div className={cn('flex gap-3 rounded-xl border p-3.5', ring, tint)}>
          <span className={cn('mt-0.5 shrink-0', icon)}>
            <Icon size={18} />
          </span>
          <div className="min-w-0 space-y-1">
            {heading && (
              <p className={cn('text-[11px] font-semibold uppercase tracking-wide', icon)}>{heading}</p>
            )}
            <p
              className={cn(
                'text-sm leading-relaxed text-t1',
                block.type === 'formula' && 'font-mono text-[13px]',
              )}
            >
              <InlineText text={block.text ?? ''} keywords={block.keywords} />
            </p>
          </div>
        </div>
      );
    }
  }
}
