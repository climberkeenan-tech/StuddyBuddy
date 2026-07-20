import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@renderer/lib/cn';

export interface MermaidDiagramProps {
  /** Mermaid source to render. */
  source: string;
  /** Renders against the dark or light mermaid theme. */
  dark?: boolean;
  className?: string;
}

let seq = 0;

/**
 * Renders a Mermaid diagram to inline SVG by lazily importing the `mermaid`
 * library only when a diagram slide is shown. If mermaid fails to load or the
 * source can't be parsed, it degrades gracefully to the raw diagram source so
 * the slide is never blank.
 */
export function MermaidDiagram({ source, dark = true, className }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`sb-mermaid-${seq++}`);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'neutral',
          securityLevel: 'strict',
          fontFamily: 'Inter Variable, system-ui, sans-serif',
        });
        const { svg: out } = await mermaid.render(idRef.current, source);
        if (!cancelled) setSvg(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  if (failed) {
    return (
      <div className={cn('flex flex-col items-center gap-3 text-t3', className)}>
        <AlertTriangle size={22} className="text-amber" />
        <p className="text-sm">This diagram couldn't be rendered. Here's its source:</p>
        <pre className="max-w-full overflow-auto rounded-xl border border-stroke bg-surface p-4 text-left text-xs text-t2">
          {source}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={cn('flex items-center justify-center text-t3', className)} aria-live="polite">
        <span className="h-6 w-6 animate-spin-slow rounded-full border-2 border-stroke border-t-primary" />
      </div>
    );
  }

  return (
    <div
      className={cn('flex items-center justify-center [&_svg]:h-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full', className)}
      role="img"
      aria-label="Diagram"
      // eslint-disable-next-line react/no-danger -- mermaid output is sanitized SVG (securityLevel: strict)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
