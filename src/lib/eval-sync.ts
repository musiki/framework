import { query } from './db/pool';
import {
  buildEvalCatalog,
  resolveEvalCatalogEntry,
  type EvalCatalogEntry,
} from './eval-catalog';

type JsonRecord = Record<string, unknown>;

type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;

export type EvalCatalogSyncError = {
  evalId: string;
  message: string;
};

export type EvalCatalogSyncResult = {
  ok: boolean;
  reason: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scanned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: EvalCatalogSyncError[];
  cached: boolean;
};

export type EvalCatalogSyncOptions = {
  force?: boolean;
  reason?: string;
  ttlMs?: number;
  logger?: LoggerLike;
  supabase?: SupabaseClient;
};

type EvalCatalogSyncState = {
  finishedAtMs: number;
  result: EvalCatalogSyncResult;
};

const DEFAULT_TTL_MS = 45_000;
const NETWORK_FAILURE_BACKOFF_MS = 5 * 60_000;

let syncState: EvalCatalogSyncState | null = null;
let inFlightSync: Promise<EvalCatalogSyncResult> | null = null;
let networkFailureBackoffUntilMs = 0;

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeSlugPath = (value: string): string => cleanString(value).replace(/^\/+|\/+$/g, '');

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? cause.message : cleanString(cause);
    return [error.message, causeMessage].filter(Boolean).join(' / ');
  }

  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error || 'Unknown error');
};

const isNetworkFetchError = (error: unknown): boolean => {
  const message = describeError(error).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('enotfound') ||
    message.includes('eai_again') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('networkerror')
  );
};

const valuesDiffer = (left: unknown, right: unknown): boolean => {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    return value ?? null;
  };

  const l = normalize(left);
  const r = normalize(right);

  if (typeof l === 'string' || typeof r === 'string') {
    return String(l ?? '') !== String(r ?? '');
  }

  if (typeof l === 'number' || typeof r === 'number') {
    const ln = Number(l ?? NaN);
    const rn = Number(r ?? NaN);
    if (Number.isNaN(ln) && Number.isNaN(rn)) return false;
    return ln !== rn;
  }

  return JSON.stringify(l) !== JSON.stringify(r);
};

const extractColumnNameFromError = (message: string): string => {
  if (!message) return '';

  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
    /column "([^"]+)" does not exist/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return cleanString(match[1]);
  }

  return '';
};

const updateAssignmentSafe = async (
  assignmentId: string,
  payload: JsonRecord,
): Promise<void> => {
  let draft = { ...payload };
  let attempts = 0;

  while (Object.keys(draft).length > 0 && attempts < 14) {
    attempts += 1;
    const cols = Object.keys(draft);
    const vals = Object.values(draft);
    const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    
    const { error } = await query(
      `UPDATE "Assignment" SET ${setSql} WHERE "id" = $${cols.length + 1}`,
      [...vals, assignmentId]
    );

    if (!error) return;

    // PG error code for undefined_column is 42703
    const isMissingColumn = error.code === '42703';
    const missingColumn = isMissingColumn ? extractColumnNameFromError(String(error.message || '')) : '';
    
    if (missingColumn && Object.prototype.hasOwnProperty.call(draft, missingColumn)) {
      delete draft[missingColumn];
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(draft, 'settings')) {
      delete draft.settings;
      continue;
    }

    throw error;
  }
};

const insertAssignmentSafe = async (
  payload: JsonRecord,
): Promise<void> => {
  let draft = { ...payload };
  let attempts = 0;

  while (Object.keys(draft).length > 0 && attempts < 14) {
    attempts += 1;
    const cols = Object.keys(draft);
    const vals = Object.values(draft);
    const colSql = cols.map(c => `"${c}"`).join(', ');
    const placeholderSql = cols.map((_, i) => `$${i + 1}`).join(', ');

    const { error } = await query(
      `INSERT INTO "Assignment" (${colSql}) VALUES (${placeholderSql})`,
      vals
    );

    if (!error) return;

    const isMissingColumn = error.code === '42703';
    const missingColumn = isMissingColumn ? extractColumnNameFromError(String(error.message || '')) : '';

    if (missingColumn && Object.prototype.hasOwnProperty.call(draft, missingColumn)) {
      delete draft[missingColumn];
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(draft, 'weight')) {
      delete draft.weight;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(draft, 'settings')) {
      delete draft.settings;
      continue;
    }

    throw error;
  }
};

function toAssignmentCandidate(entry: EvalCatalogEntry): JsonRecord {
  return {
    id: entry.evalId,
    type: entry.evalType,
    mode: entry.mode,
    points: entry.points,
    prompt: entry.prompt,
    group: entry.group,
    options: entry.options,
    contentHash: entry.contentHash,
    contentVersion: entry.contentVersion,
    settings: entry.evalSnapshot,
    courseId: entry.courseId,
    slug: entry.entryId,
  };
}

function buildUpdatePayload(existing: JsonRecord, candidate: JsonRecord): JsonRecord {
  const update: JsonRecord = {};
  const keys = Object.keys(candidate);
  
  for (const key of keys) {
    if (valuesDiffer(existing[key], candidate[key])) {
      update[key] = candidate[key];
    }
  }
  
  return update;
}

const CONCURRENCY_LIMIT = 1; // Strict serial processing for SSH tunnel stability

const runEvalCatalogSync = async (
  options: Required<Pick<EvalCatalogSyncOptions, 'reason' | 'logger'>>,
): Promise<EvalCatalogSyncResult> => {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const result: EvalCatalogSyncResult = {
    ok: true,
    reason: options.reason,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    scanned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    cached: false,
  };

  try {
    const catalog = await buildEvalCatalog();
    const resolvedEntries: EvalCatalogEntry[] = [];

    catalog.forEach((entries) => {
      const entry = resolveEvalCatalogEntry(entries, '') || entries[0] || null;
      if (!entry) {
        result.skipped += 1;
        return;
      }
      resolvedEntries.push(entry);
    });

    result.scanned = resolvedEntries.length;

    // Process entries with limited concurrency to respect SSH tunnel bandwidth/sockets
    const chunks = [];
    for (let i = 0; i < resolvedEntries.length; i += CONCURRENCY_LIMIT) {
      chunks.push(resolvedEntries.slice(i, i + CONCURRENCY_LIMIT));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (entry) => {
        try {
          const candidate = toAssignmentCandidate(entry);
          const { data: existingRows, error: findError } = await query(
            'SELECT * FROM "Assignment" WHERE "id" = $1 LIMIT 1',
            [entry.evalId]
          );

          if (findError) throw findError;
          const existing = existingRows?.[0];

          if (!existing) {
            await insertAssignmentSafe(candidate);
            result.inserted += 1;
            return;
          }

          const updatePayload = buildUpdatePayload(existing as JsonRecord, candidate);
          if (Object.keys(updatePayload).length === 0) {
            result.unchanged += 1;
            return;
          }

          await updateAssignmentSafe(entry.evalId, updatePayload);
          result.updated += 1;
        } catch (error: any) {
          const message = describeError(error);
          if (isNetworkFetchError(error)) {
            result.errors.push({ evalId: '*', message: `Database network unavailable: ${message}` });
            options.logger.warn(`[eval-sync] Database network unavailable; backing off: ${message}`);
            // Note: We continue the loop but this error will trigger backoff in the caller
          } else {
            result.errors.push({ evalId: entry.evalId, message });
            options.logger.error(`[eval-sync] ${entry.evalId}: ${message}`);
          }
        }
      }));

      // Break if we hit a fatal network error
      if (result.errors.some(e => e.evalId === '*')) break;
    }
  } catch (error: any) {
    const message = describeError(error) || 'Unable to build eval catalog';
    result.errors.push({ evalId: '*', message });
    options.logger.error(`[eval-sync] fatal: ${message}`);
  }

  if (result.errors.length > 0) {
    result.ok = false;
  }

  const finishedMs = Date.now();
  result.finishedAt = new Date(finishedMs).toISOString();
  result.durationMs = finishedMs - startedMs;
  return result;
};

export async function ensureEvalCatalogSynced(
  options: EvalCatalogSyncOptions = {},
): Promise<EvalCatalogSyncResult> {
  const reason = cleanString(options.reason) || 'unspecified';
  const logger = options.logger || console;
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const force = Boolean(options.force);
  const now = Date.now();

  if (!force && networkFailureBackoffUntilMs > now && syncState) {
    return { ...syncState.result, cached: true };
  }

  if (!force && syncState && now - syncState.finishedAtMs < ttlMs) {
    return { ...syncState.result, cached: true };
  }

  if (inFlightSync) return inFlightSync;

  inFlightSync = runEvalCatalogSync({
    reason,
    logger,
  })
    .then((result) => {
      syncState = {
        finishedAtMs: Date.now(),
        result,
      };
      const hasNetworkError = result.errors.some((entry) => isNetworkFetchError(entry.message));
      networkFailureBackoffUntilMs = hasNetworkError ? Date.now() + NETWORK_FAILURE_BACKOFF_MS : 0;
      return result;
    })
    .finally(() => {
      inFlightSync = null;
    });

  return inFlightSync;
}

export async function forceEvalCatalogSync(
  options: Omit<EvalCatalogSyncOptions, 'force'> = {},
): Promise<EvalCatalogSyncResult> {
  return ensureEvalCatalogSynced({ ...options, force: true });
}

export function clearEvalCatalogSyncCache(): void {
  syncState = null;
}
