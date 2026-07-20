import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap, LayoutDashboard, Mic, Plus, Sparkles, Flame, Settings, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { levelForXp, levelProgress } from '@renderer/lib/xp';
import { useAppStore } from '@renderer/stores/app-store';
import { useAsync } from '@renderer/lib/hooks';
import { api } from '@renderer/lib/api';
import { Badge, ProgressRing, Skeleton } from '@renderer/components/ui';
import { CourseIcon } from '@renderer/features/courses/CourseIcon';
import { CourseDialog } from '@renderer/features/courses/CourseDialog';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should keep this item active. */
  match?: string[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/record', label: 'Record', icon: Mic },
  { to: '/search', label: 'Ask AI', icon: Sparkles },
  { to: '/review', label: 'Review', icon: Layers },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/**
 * The primary navigation rail: brand wordmark, main nav with a sliding active
 * pill, the student's class list with due-review badges, and a footer showing
 * the streak flame and level ring.
 */
export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const courses = useAppStore((s) => s.courses);
  const coursesLoaded = useAppStore((s) => s.coursesLoaded);
  const gamification = useAppStore((s) => s.gamification);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: summary } = useAsync(() => api.dashboard.getSummary(), []);
  const dueByCourse = new Map((summary?.dueReviews ?? []).map((d) => [d.courseId, d.dueCards]));

  const xp = gamification?.xp ?? 0;
  const level = gamification ? gamification.level : levelForXp(xp);
  const streak = gamification?.streak.current ?? 0;

  function isActive(item: NavItem): boolean {
    if (item.to === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.to) || (item.match?.some((m) => location.pathname.startsWith(m)) ?? false);
  }

  return (
    <>
      <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-stroke bg-panel/60 backdrop-blur-xl">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary text-white shadow-glow">
            <GraduationCap size={20} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-gradient">StuddyBuddy</span>
        </div>

        {/* Main nav */}
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'focus-ring relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                  active ? 'text-t1' : 'text-t3 hover:text-t2',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    className="absolute inset-0 rounded-xl border border-primary/25 bg-primary/12"
                    transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                  />
                )}
                <Icon size={18} className={cn('relative z-10', active && 'text-primary')} />
                <span className="relative z-10">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Classes */}
        <div className="mt-6 flex items-center justify-between px-5 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-t3">Your classes</span>
          <button
            type="button"
            aria-label="Add class"
            onClick={() => setDialogOpen(true)}
            className="focus-ring flex h-6 w-6 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-overlay hover:text-t1"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          {!coursesLoaded ? (
            <div className="flex flex-col gap-2 px-2 py-1">
              {[0, 1].map((i) => (
                <Skeleton key={i} height={40} />
              ))}
            </div>
          ) : courses.length === 0 ? (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="focus-ring mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-xl border border-dashed border-stroke-strong px-3 py-3 text-sm text-t3 transition-colors hover:border-primary/40 hover:text-t2"
            >
              <Plus size={15} /> Add your first class
            </button>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {courses.map((course) => {
                const due = dueByCourse.get(course.id) ?? 0;
                const active = location.pathname.startsWith(`/courses/${course.id}`);
                return (
                  <li key={course.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/courses/${course.id}`)}
                      className={cn(
                        'focus-ring flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm transition-colors',
                        active ? 'bg-overlay text-t1' : 'text-t2 hover:bg-overlay/60 hover:text-t1',
                      )}
                    >
                      <CourseIcon icon={course.icon} color={course.color} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-medium">{course.name}</span>
                      {due > 0 && (
                        <Badge variant="primary" className="shrink-0">
                          {due}
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer: streak + level */}
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-stroke px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber/12 text-amber">
              <Flame size={18} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-t1">{streak} day{streak === 1 ? '' : 's'}</p>
              <p className="text-[11px] text-t3">Study streak</p>
            </div>
          </div>
          <ProgressRing value={levelProgress(xp)} size={40} thickness={4} aria-label={`Level ${level} progress`}>
            <span className="text-[11px] font-bold text-t1">{level}</span>
          </ProgressRing>
        </div>
      </aside>

      <CourseDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
