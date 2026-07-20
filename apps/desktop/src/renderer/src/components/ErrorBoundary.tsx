import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it and shows a friendly recovery
 * panel instead of a blank screen. "Try again" clears the error to re-render;
 * "Reload app" does a hard reload. Wrap the whole app in one.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
     
    console.error('StuddyBuddy crashed:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private reload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen w-screen items-center justify-center p-6">
        <div className="glass-panel flex max-w-md flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose/12 text-rose">
            <AlertTriangle size={28} />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-t1">Something went sideways</h1>
            <p className="mt-1.5 text-sm text-t3">
              StuddyBuddy hit an unexpected error. Your data is safe — try again, and if it keeps happening, reload the app.
            </p>
          </div>
          {error.message && (
            <pre className="max-h-28 w-full overflow-auto rounded-lg border border-stroke bg-bg/60 p-3 text-left text-xs text-t3">
              {error.message}
            </pre>
          )}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-primary px-4 text-sm font-medium text-white shadow-soft hover:shadow-glow"
            >
              <RotateCcw size={16} /> Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="focus-ring inline-flex h-10 items-center rounded-xl border border-stroke-strong bg-surface px-4 text-sm font-medium text-t1 hover:bg-overlay"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
