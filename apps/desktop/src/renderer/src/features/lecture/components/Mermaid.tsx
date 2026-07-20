import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@renderer/components/ui';

let seq = 0;

export interface MermaidProps {
  /** Mermaid diagram source. */
  code: string;
}

/**
 * Lazily renders a Mermaid diagram to inline SVG. Mermaid is a heavy dependency
 * so it is imported on demand the first time a diagram is shown. If rendering
 * fails for any reason (parse error, unavailable in the environment) it falls
 * back to showing the diagram source as a code block rather than breaking.
 */
export function Mermaid({ code }: MermaidProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`sb-mermaid-${(seq += 1)}`);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const dark =
          typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
          fontFamily: 'Inter Variable, system-ui, sans-serif',
        });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-xl border border-stroke bg-bg/60 p-3 text-[13px] text-t2">
        <code className="font-mono">{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-stroke bg-bg/40 py-8">
        <Spinner label="Drawing diagram…" />
      </div>
    );
  }

  return (
    <div
      className="sb-mermaid flex justify-center overflow-x-auto rounded-xl border border-stroke bg-bg/40 p-4 [&_svg]:h-auto [&_svg]:max-w-full"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
