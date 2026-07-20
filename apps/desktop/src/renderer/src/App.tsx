import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { Toaster } from '@renderer/components/toast';
import { initAppSubscriptions, useAppStore } from '@renderer/stores/app-store';
import { AppRoutes } from './routes';

/**
 * The application root: initializes settings/theme + all push-event
 * subscriptions once on mount, honors the reduced-motion preference globally
 * via `MotionConfig`, and renders the router inside an error boundary with the
 * global toast layer.
 */
export default function App() {
  const reduceMotion = useAppStore((s) => s.settings.reduceMotion);

  useEffect(() => {
    const teardown = initAppSubscriptions();
    return teardown;
  }, []);

  // Framer honors this alongside the CSS motion policy; 'user' follows the OS.
  const reducedMotion = reduceMotion === 'on' ? 'always' : reduceMotion === 'off' ? 'never' : 'user';

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion={reducedMotion}>
        <AppRoutes />
        <Toaster />
      </MotionConfig>
    </ErrorBoundary>
  );
}
