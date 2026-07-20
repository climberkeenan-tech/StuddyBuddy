import { createHashRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from '@renderer/components/layout';
import DashboardPage from '@renderer/features/dashboard/DashboardPage';
import RecordPage from '@renderer/features/recording/RecordPage';
import CoursePage from '@renderer/features/courses/CoursePage';
import LecturePage from '@renderer/features/lecture/LecturePage';
import SlidesPage from '@renderer/features/slides/SlidesPage';
import SearchPage from '@renderer/features/search/SearchPage';
import ReviewPage from '@renderer/features/review/ReviewPage';
import LearnPage from '@renderer/features/learn/LearnPage';
import SettingsPage from '@renderer/features/settings/SettingsPage';

/**
 * The app's route table. Every page renders inside {@link AppShell} (sidebar +
 * topbar + animated outlet). Uses a hash router so it works from `file://` in
 * the packaged Electron app.
 */
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'record', element: <RecordPage /> },
      { path: 'courses/:courseId', element: <CoursePage /> },
      { path: 'courses/:courseId/lectures/:lectureId', element: <LecturePage /> },
      { path: 'lectures/:lectureId/slides', element: <SlidesPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'learn/:lectureId', element: <LearnPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

/** Mounts the application router. */
export function AppRoutes() {
  return <RouterProvider router={router} />;
}
