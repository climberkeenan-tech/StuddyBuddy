import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { pageTransition } from '@renderer/lib/motion';
import { PageTitleProvider } from '@renderer/lib/hooks';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * The application frame: a fixed navigation sidebar, a top bar, and a scrolling
 * main region whose routed page cross-fades on navigation. Provides the page
 * title context that the Topbar and pages share.
 */
export function AppShell() {
  const location = useLocation();
  return (
    <PageTitleProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                variants={pageTransition}
                initial="initial"
                animate="animate"
                exit="exit"
                className="mx-auto w-full max-w-6xl px-6 py-8"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </PageTitleProvider>
  );
}
