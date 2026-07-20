/** Format a media offset (ms) as "m:ss" or "h:mm:ss". */
export function formatOffset(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Local-time day key "YYYY-MM-DD" used for streaks and daily stats. */
export function dayKey(at: number | Date = new Date()): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days between two day keys (b - a). */
export function dayKeyDiff(a: string, b: string): number {
  const [ay = 0, am = 1, ad = 1] = a.split('-').map(Number);
  const [by = 0, bm = 1, bd = 1] = b.split('-').map(Number);
  const utcA = Date.UTC(ay, am - 1, ad);
  const utcB = Date.UTC(by, bm - 1, bd);
  return Math.round((utcB - utcA) / 86_400_000);
}

/** Human-friendly duration, e.g. "1h 12m" or "45m". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '<1m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
