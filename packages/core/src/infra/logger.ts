/**
 * Structured, leveled logging with pluggable transports.
 * The app installs a file transport in main; tests use the ring buffer only.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

export type LogTransport = (record: LogRecord) => void;

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

const RING_SIZE = 2000;

export class LogManager {
  private transports: LogTransport[] = [];
  private ring: LogRecord[] = [];
  minLevel: LogLevel = 'info';

  addTransport(t: LogTransport): void {
    this.transports.push(t);
  }

  /** Most recent records, oldest first. */
  recent(limit = 500): LogRecord[] {
    return this.ring.slice(-limit);
  }

  emit(record: LogRecord): void {
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER[this.minLevel]) return;
    this.ring.push(record);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    for (const t of this.transports) {
      try {
        t(record);
      } catch {
        // A broken transport must never take the app down.
      }
    }
  }

  getLogger(scope: string): Logger {
    const make = (fullScope: string): Logger => ({
      debug: (message, data) =>
        this.emit({ at: Date.now(), level: 'debug', scope: fullScope, message, data }),
      info: (message, data) =>
        this.emit({ at: Date.now(), level: 'info', scope: fullScope, message, data }),
      warn: (message, data) =>
        this.emit({ at: Date.now(), level: 'warn', scope: fullScope, message, data }),
      error: (message, data) =>
        this.emit({ at: Date.now(), level: 'error', scope: fullScope, message, data }),
      child: (sub) => make(`${fullScope}:${sub}`),
    });
    return make(scope);
  }
}

export function formatRecord(r: LogRecord): string {
  const time = new Date(r.at).toISOString();
  const data = r.data ? ` ${safeJson(r.data)}` : '';
  return `${time} [${r.level.toUpperCase().padEnd(5)}] ${r.scope}: ${r.message}${data}`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}

export const consoleTransport: LogTransport = (r) => {
  const fn = r.level === 'error' ? console.error : r.level === 'warn' ? console.warn : console.log;
  fn(formatRecord(r));
};
