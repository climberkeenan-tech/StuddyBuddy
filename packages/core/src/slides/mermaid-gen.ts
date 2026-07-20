/**
 * Helpers that emit *valid* Mermaid source from arbitrary lecture-derived text.
 *
 * Mermaid gives many characters syntactic meaning — parentheses and square
 * brackets shape nodes, `"` delimits labels, `:` splits mindmap node/icon,
 * `|` fences edge labels, `-->` is an edge. Feeding raw concept names ("ATP
 * synthase (F1F0)", "Krebs cycle: step 3") straight into a diagram produces a
 * parse error and a blank render. Every label therefore passes through
 * {@link sanitizeMermaidLabel}, which strips those characters and caps length,
 * so the generated diagrams parse regardless of how messy the source text is.
 */

/** Characters that carry syntactic meaning in Mermaid node/edge labels. */
const UNSAFE_LABEL_CHARS = /[()[\]{}"'`<>|;:#&]/g;

/**
 * Make an arbitrary string safe to drop into a Mermaid label: collapse
 * whitespace, remove characters Mermaid treats as syntax (brackets, quotes,
 * colons, pipes), neutralize arrow-like `--` runs, and cap the length. Never
 * returns an empty string (falls back to `"node"`) so a node is always named.
 */
export function sanitizeMermaidLabel(raw: string, maxLen = 40): string {
  const cleaned = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(UNSAFE_LABEL_CHARS, ' ')
    .replace(/-{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return 'node';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1).trimEnd()}…` : cleaned;
}

/** One branch of a mindmap: a first-level node and its leaf children. */
export interface MindmapBranch {
  label: string;
  children: string[];
}

/**
 * Build a Mermaid `mindmap` with a circular root, first-level `branches`, and
 * their leaf `children`. Hierarchy is expressed through indentation (two spaces
 * per level). Duplicate or empty leaves within a branch are dropped so the
 * diagram stays clean.
 *
 * @example
 * mindmap('DNA Replication', [{ label: 'Enzymes', children: ['Helicase', 'Ligase'] }])
 * // mindmap
 * //   root((DNA Replication))
 * //     Enzymes
 * //       Helicase
 * //       Ligase
 */
export function mindmap(root: string, branches: MindmapBranch[]): string {
  const lines: string[] = ['mindmap', `  root((${sanitizeMermaidLabel(root, 40)}))`];
  for (const branch of branches) {
    const label = sanitizeMermaidLabel(branch.label, 40);
    lines.push(`    ${label}`);
    const seen = new Set<string>();
    for (const child of branch.children) {
      const leaf = sanitizeMermaidLabel(child, 40);
      if (leaf === 'node' || leaf === label || seen.has(leaf)) continue;
      seen.add(leaf);
      lines.push(`      ${leaf}`);
    }
  }
  return lines.join('\n');
}

/** A directed edge for {@link flowchart}; `label` annotates the arrow. */
export interface FlowchartEdge {
  from: string;
  to: string;
  label?: string;
}

/**
 * Build a Mermaid `flowchart` from directed `edges`. Nodes are de-duplicated by
 * their sanitized label and assigned stable ids (`n0`, `n1`, …); labels are
 * quoted and sanitized so brackets/quotes in the source can never break the
 * syntax. An empty edge list still yields a valid single-node diagram.
 *
 * @example
 * flowchart([{ from: 'Unwind', to: 'Prime' }, { from: 'Prime', to: 'Extend' }])
 */
export function flowchart(edges: FlowchartEdge[], direction: 'TD' | 'LR' | 'TB' = 'TD'): string {
  const ids = new Map<string, string>();
  const nodeDecls: string[] = [];
  const idFor = (label: string): string => {
    const clean = sanitizeMermaidLabel(label, 40);
    const existing = ids.get(clean);
    if (existing) return existing;
    const id = `n${ids.size}`;
    ids.set(clean, id);
    nodeDecls.push(`  ${id}["${clean}"]`);
    return id;
  };

  const edgeLines: string[] = [];
  for (const edge of edges) {
    const from = idFor(edge.from);
    const to = idFor(edge.to);
    const label = edge.label ? sanitizeMermaidLabel(edge.label, 24) : '';
    edgeLines.push(label ? `  ${from} -->|${label}| ${to}` : `  ${from} --> ${to}`);
  }

  if (nodeDecls.length === 0) nodeDecls.push('  n0["Overview"]');
  return [`flowchart ${direction}`, ...nodeDecls, ...edgeLines].join('\n');
}
