import { Fragment, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * A small, dependency-free Markdown renderer covering the subset the app
 * generates: `#`/`##`/`###` headings, `**bold**`, `*italic*`, `` `code` ``,
 * fenced code blocks, `-`/`1.` lists, `>` blockquotes, `[links](url)`, and
 * pipe tables. Output is styled with design tokens and safe (no raw HTML).
 */
export function Markdown({ children, className }: MarkdownProps) {
  return <div className={cn('sb-markdown space-y-3 text-sm leading-relaxed text-t2', className)}>{renderBlocks(children)}</div>;
}

/** Parse block-level structure into React nodes. */
function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      out.push(
        <pre key={key++} className="overflow-x-auto rounded-xl border border-stroke bg-bg/60 p-3 text-[13px] text-t1">
          <code className="font-mono">{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      const cls = level === 1 ? 'text-lg font-semibold text-t1' : level === 2 ? 'text-base font-semibold text-t1' : 'text-sm font-semibold text-t1';
      const Tag = (`h${Math.min(level + 1, 6)}` as unknown) as keyof JSX.IntrinsicElements;
      out.push(
        <Tag key={key++} className={cn('font-display', cls)}>
          {renderInline(text)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      out.push(
        <blockquote key={key++} className="border-l-2 border-primary/50 bg-primary/5 py-1 pl-3 pr-2 text-t2">
          {buf.map((b, bi) => (
            <p key={bi}>{renderInline(b)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Table (pipe with a separator row)
    if (line.includes('|') && /^\s*\|?.*\|.*$/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]+$/.test(lines[i + 1] ?? '')) {
      const header = splitRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitRow(lines[i] ?? ''));
        i++;
      }
      out.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} className="border-b border-stroke-strong px-3 py-1.5 text-left font-semibold text-t1">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-stroke px-3 py-1.5 text-t2">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={key++} className="space-y-1 pl-1">
          {buf.map((item, ii) => (
            <li key={ii} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(
        <ol key={key++} className="space-y-1 pl-1">
          {buf.map((item, ii) => (
            <li key={ii} className="flex gap-2">
              <span className="min-w-[1.25rem] shrink-0 font-semibold text-primary">{ii + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph — gather consecutive non-empty, non-block lines
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? '')) {
      buf.push(lines[i] ?? '');
      i++;
    }
    out.push(
      <p key={key++} className="text-t2">
        {renderInline(buf.join(' '))}
      </p>,
    );
  }

  return out;
}

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,3})\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^>\s?/.test(line) ||
    line.trimStart().startsWith('```')
  );
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Render inline formatting: bold, italic, code, and links. */
function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  // Order matters: code first (so we don't format inside it), then links, bold, italic.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, match.index)}</Fragment>);
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded-md border border-stroke bg-bg/60 px-1 py-0.5 font-mono text-[0.85em] text-primary">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-t1">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={key++} href={link[2]} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
            {link[1]}
          </a>,
        );
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return nodes;
}
