import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CalendarClock, Network, Star, X } from 'lucide-react';
import type { Concept, LectureAnalysis } from '@studdybuddy/shared';
import { Badge, Button, ProgressRing, SegmentedControl } from '@renderer/components/ui';
import { cn } from '@renderer/lib/cn';
import { formatOffset } from '@renderer/lib/format';
import { importanceAccent } from '../lib';

export interface ConceptMapProps {
  analysis: LectureAnalysis;
  onExit: () => void;
  /** Records a "reviewed" completion (game-completed) for the hub. */
  onReviewed: () => void;
}

type MapView = 'mind' | 'timeline';

interface ConceptNodeData extends Record<string, unknown> {
  label: string;
  tier: 'primary' | 'sky' | 't3';
  importance: number;
}
type ConceptNodeType = Node<ConceptNodeData, 'concept'>;

const TIER_RING: Record<ConceptNodeData['tier'], string> = {
  primary: 'border-primary/70 bg-gradient-primary-soft',
  sky: 'border-sky/60 bg-sky/10',
  t3: 'border-stroke-strong bg-surface',
};

/** Custom draggable node rendered with app tokens; importance drives its accent. */
function ConceptNode({ data, selected }: NodeProps<ConceptNodeType>) {
  return (
    <div
      className={cn(
        'flex max-w-[180px] items-center gap-2 rounded-panel border px-3 py-2 shadow-soft transition-shadow',
        TIER_RING[data.tier],
        selected && 'shadow-glow ring-2 ring-primary',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-t3" />
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ opacity: 0.4 + data.importance * 0.6 }}
      />
      <span className="font-display text-xs font-semibold leading-tight text-t1">{data.label}</span>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-t3" />
    </div>
  );
}

const nodeTypes = { concept: ConceptNode };

/** Radially lay concepts out: the most important sits at the center. */
function layoutNodes(concepts: Concept[]): ConceptNodeType[] {
  const ordered = [...concepts].sort((a, b) => b.importance - a.importance);
  const cx = 300;
  const cy = 210;
  const radius = 190;
  return ordered.map((c, i) => {
    let x = cx;
    let y = cy;
    if (i > 0) {
      const angle = ((i - 1) / Math.max(1, ordered.length - 1)) * Math.PI * 2;
      x = cx + Math.cos(angle) * radius;
      y = cy + Math.sin(angle) * radius;
    }
    return {
      id: c.id,
      type: 'concept' as const,
      position: { x, y },
      data: { label: c.name, tier: importanceAccent(c.importance), importance: c.importance },
    };
  });
}

function buildEdges(concepts: Concept[]): Edge[] {
  const ids = new Set(concepts.map((c) => c.id));
  const edges: Edge[] = [];
  for (const c of concepts) {
    for (const rel of c.related) {
      if (!ids.has(rel.conceptId)) continue;
      edges.push({
        id: `${c.id}-${rel.conceptId}`,
        source: c.id,
        target: rel.conceptId,
        label: rel.relation,
        animated: true,
        style: { stroke: 'rgb(var(--sb-primary) / 0.5)' },
        labelStyle: { fontSize: 10, fill: 'rgb(var(--sb-t3))' },
        labelBgStyle: { fill: 'rgb(var(--sb-surface))' },
      });
    }
  }
  return edges;
}

/** The interactive React Flow graph. Click a node to inspect its details. */
function MindMap({ analysis }: { analysis: LectureAnalysis }) {
  const initialNodes = useMemo(() => layoutNodes(analysis.concepts), [analysis]);
  const initialEdges = useMemo(() => buildEdges(analysis.concepts), [analysis]);
  const [nodes, , onNodesChange] = useNodesState<ConceptNodeType>(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = analysis.concepts.find((c) => c.id === selectedId) ?? null;
  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedId(node.id), []);

  if (analysis.concepts.length === 0) {
    return (
      <div className="flex h-[440px] items-center justify-center rounded-panel border border-stroke bg-surface text-sm text-t3">
        No concepts to map for this lecture yet.
      </div>
    );
  }

  return (
    <div className="h-[440px] overflow-hidden rounded-panel border border-stroke bg-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedId(null)}
        fitView
        proOptions={{ hideAttribution: true }}
        className="[&_.react-flow__controls]:!shadow-soft"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgb(var(--sb-t3) / 0.3)" />
        <Controls showInteractive={false} className="!border-stroke !bg-panel" />
        {selected && (
          <Panel position="top-right" className="!m-3 w-64">
            <div className="rounded-panel border border-stroke bg-overlay p-4 shadow-pop">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h4 className="font-display text-sm font-semibold text-t1">{selected.name}</h4>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close concept details"
                  className="focus-ring rounded-md p-0.5 text-t3 hover:text-t1"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-xs leading-relaxed text-t2">{selected.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="primary" leftIcon={<Star size={11} />}>
                  {Math.round(selected.examLikelihood * 100)}% exam
                </Badge>
                <Badge variant="neutral">{selected.mentions} mentions</Badge>
                <Badge variant={selected.difficulty >= 0.65 ? 'rose' : 'neutral'}>
                  {selected.difficulty >= 0.65 ? 'tricky' : 'manageable'}
                </Badge>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

/** Chronological view of the lecture's key dates. */
function TimelineView({ analysis }: { analysis: LectureAnalysis }) {
  const dates = [...analysis.keyDates].sort((a, b) => a.atMs - b.atMs);
  if (dates.length === 0) {
    return (
      <div className="flex h-[440px] flex-col items-center justify-center gap-2 rounded-panel border border-stroke bg-surface text-center">
        <CalendarClock size={28} className="text-t3" />
        <p className="text-sm text-t2">This lecture has no key dates to plot.</p>
        <p className="text-xs text-t3">Try the mind map to explore its concepts instead.</p>
      </div>
    );
  }
  return (
    <div className="h-[440px] overflow-y-auto rounded-panel border border-stroke bg-surface p-6">
      <ol className="relative ml-3 space-y-6 border-l-2 border-stroke pl-6">
        {dates.map((d) => (
          <li key={d.id} className="relative">
            <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-gradient-primary text-[9px] font-bold text-white shadow-glow">
              •
            </span>
            <p className="font-display text-sm font-semibold text-t1">{d.label}</p>
            <p className="mt-0.5 text-sm text-t2">{d.event}</p>
            <p className="mt-1 text-xs text-t3">at {formatOffset(d.atMs)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Concept Map — an interactive knowledge graph of the lecture's concepts
 * (draggable nodes colored by importance, click to inspect) with a toggle to a
 * chronological timeline of the lecture's key dates.
 */
export function ConceptMap({ analysis, onExit, onReviewed }: ConceptMapProps) {
  const [view, setView] = useState<MapView>('mind');
  const [reviewed, setReviewed] = useState(false);

  const importantCount = analysis.concepts.filter((c) => c.importance >= 0.85).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<MapView>
          aria-label="Concept map view"
          value={view}
          onChange={setView}
          options={[
            { value: 'mind', label: 'Mind map', icon: <Network size={14} /> },
            { value: 'timeline', label: 'Timeline', icon: <CalendarClock size={14} /> },
          ]}
        />
        <div className="flex items-center gap-3">
          <ProgressRing value={importantCount / Math.max(1, analysis.concepts.length)} size={34} thickness={4} aria-label="Share of high-importance concepts">
            <Star size={12} className="text-primary" />
          </ProgressRing>
          <span className="text-xs text-t3">
            {analysis.concepts.length} concepts · {analysis.keyDates.length} dates
          </span>
        </div>
      </div>

      {view === 'mind' ? <MindMap analysis={analysis} /> : <TimelineView analysis={analysis} />}

      <p className="text-xs text-t3">
        {view === 'mind'
          ? 'Drag nodes to rearrange them, scroll to zoom, and click a concept to see its exam odds.'
          : 'The order your professor introduced each moment — great for essay questions.'}
      </p>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onExit}>
          Close
        </Button>
        <Button
          onClick={() => {
            if (!reviewed) {
              setReviewed(true);
              onReviewed();
            }
            onExit();
          }}
        >
          {reviewed ? 'Done' : 'Mark reviewed'}
        </Button>
      </div>
    </div>
  );
}
