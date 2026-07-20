/**
 * Formatting helpers for the renderer. Time/duration primitives are
 * re-exported from the shared package so features import from one place.
 */
export { formatOffset, formatDuration, dayKey } from '@studdybuddy/shared';

/** "just now", "5m ago", "3h ago", "2d ago", else a short local date. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Mar 14" style short date. */
export function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Whole days from now until `timestamp` (0 = today, negative = past). */
export function daysUntil(timestamp: number, now: number = Date.now()): number {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((startOfDay(timestamp) - startOfDay(now)) / 86_400_000);
}

/** "in 12 days" / "tomorrow" / "today" / "3 days ago". */
export function formatCountdown(timestamp: number, now: number = Date.now()): string {
  const days = daysUntil(timestamp, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Time-of-day greeting for the dashboard. */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
