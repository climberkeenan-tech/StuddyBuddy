import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, SbError } from '../infra/errors';
import type { QueryOptions } from './types';

/**
 * Shared query/filesystem helpers used by both storage adapters.
 *
 * Both adapters funnel their final filtering/sorting through these functions so
 * query semantics (strict equality, ordering, missing-field handling) are
 * byte-for-byte identical no matter which backend is active. That equivalence
 * is what the adapter contract test suite asserts.
 */

const COLLECTION_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reject collection names that are not simple identifiers. Collection names
 * become SQLite table names and JSON file basenames, so this is the single
 * guard against SQL identifier injection and path traversal.
 */
export function assertCollectionName(collection: string): void {
  if (!COLLECTION_NAME_RE.test(collection)) {
    throw new SbError(ErrorCodes.VALIDATION, `Invalid collection name "${collection}"`, {
      details: { collection },
    });
  }
}

/** Strict-equality match of every `where` field against the doc's top-level fields. */
export function matchesWhere(
  doc: unknown,
  where: Record<string, string | number | boolean> | undefined,
): boolean {
  if (!where) return true;
  if (typeof doc !== 'object' || doc === null) return false;
  const record = doc as Record<string, unknown>;
  for (const [field, value] of Object.entries(where)) {
    if (record[field] !== value) return false;
  }
  return true;
}

/**
 * Deterministic value comparator for orderBy. Numbers compare numerically,
 * everything else by code-unit string comparison (locale-independent so results
 * are stable across machines). Missing/null values sort after present ones in
 * ascending order; descending is a full negation.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * Apply the full QueryOptions pipeline (where → orderBy → offset → limit) to an
 * in-memory doc array. Sort is stable (V8 guarantee), so equal keys keep their
 * incoming order.
 */
export function applyQueryOptions<T>(docs: T[], options?: QueryOptions): T[] {
  let out = options?.where ? docs.filter((d) => matchesWhere(d, options.where)) : [...docs];
  const orderBy = options?.orderBy;
  if (orderBy) {
    const sign = orderBy.direction === 'desc' ? -1 : 1;
    out.sort((a, b) => {
      const av = (a as Record<string, unknown>)[orderBy.field];
      const bv = (b as Record<string, unknown>)[orderBy.field];
      return sign * compareValues(av, bv);
    });
  }
  const offset = options?.offset ?? 0;
  if (offset > 0) out = out.slice(offset);
  if (options?.limit !== undefined) out = out.slice(0, Math.max(0, options.limit));
  return out;
}

/** Throw VALIDATION unless every dumped doc is an object with a string id. */
export function assertRestorableDocs(collection: string, docs: unknown[]): void {
  for (const doc of docs) {
    const id = (doc as { id?: unknown } | null)?.id;
    if (typeof doc !== 'object' || doc === null || typeof id !== 'string' || id.length === 0) {
      throw new SbError(
        ErrorCodes.VALIDATION,
        `Backup collection "${collection}" contains a document without a string id`,
        { details: { collection } },
      );
    }
  }
}

let tmpCounter = 0;

/**
 * Crash-safe file write: write to a unique sibling tmp file, then rename over
 * the target. Rename is atomic on the same filesystem, so readers never observe
 * a half-written file.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${tmpCounter++}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}
