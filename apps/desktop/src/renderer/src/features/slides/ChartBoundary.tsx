import { Component, type ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * A small, local error boundary for the lazy chart renderer. A malformed
 * chart spec from a real AI provider must never blow up the whole slideshow —
 * this degrades to a compact inline notice instead, keeping the deck usable.
 */
export class ChartBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-t3">
          <BarChart3 size={26} />
          <span className="text-sm">This chart couldn’t be rendered.</span>
        </div>
      );
    }
    return this.props.children;
  }
}
