import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

let syncState: EvalCatalogSyncState | null = null;
let inFlightSync: Promise<EvalCatalogSyncResult> | null = null;

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeSlugPath = (value: string): string => cleanString(value).replace(/^\/+|\/+$/g, '');

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

  const patterns = [/Could not find the '([^']+)' column/i, /column "([^"]+)" of relation/i];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return cleanString(match[1]);
  }

  return '';
};

type SupportedEnvKey =
  | 'SUPABASE_URL'
  | 'PUBLIC_SUPABASE_URL'
  | 'SUPABASE_KEY'
  | 'SUPABASE_ANON_KEY';

const runtimeEnv = (key: SupportedEnvKey): string => {
  // Vite module runner does not allow dynamic import.meta.env[key] access.
  const viteValue =
    key === 'SUPABASE_URL'
      ? import.meta.env.SUPABASE_URL
      : key === 'PUBLIC_SUPABASE_URL'
        ? import.meta.env.PUBLIC_SUPABASE_URL
        : key === 'SUPABASE_KEY'
          ? import.meta.env.SUPABASE_KEY
          : import.meta.env.SUPABASE_ANON_KEY;

  if (typeof viteValue === 'string' && viteValue.trim()) return viteValue.trim();

  const processValue = process.env?.[key];
  if (typeof processValue === 'string' && processValue.trim()) return processValue.trim();

  return '';
};

const resolveSupabaseClient = (explicit?: SupabaseClient): SupabaseClient | null => {
  if (explicit) return explicit;

  const supabaseUrl = runtimeEnv('SUPABASE_URL') || runtimeEnv('PUBLIC_SUPABASE_URL');
  const supabaseKey = runtimeEnv('SUPABASE_KEY') || runtimeEnv('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
};

const toAssignmentCandidate = (entry: EvalCatalogEntry): JsonRecord => {
  const entryId = normalizeSlugPath(entry.entryId);
  const fallbackCourseId = cleanString(entryId.split('/')[0]);
  const courseId = cleanString(entry.courseId) || fallbackCourseId || 'sin-curso';
  const slug = entryId || `${courseId}/assignment/${entry.evalId}`;
  const title = cleanString(entry.entryTitle) || entry.evalId;
  const prompt = cleanString(entry.prompt);

  return {
    id: entry.evalId,
    courseId,
    slug,
    title,
    description: prompt || slug || title,
    type: cleanString(entry.evalType) || 'unknown',
    mode: cleanString(entry.mode) || 'self',
    prompt,
    points: Number(entry.points || 0) || 0,
    lessonId: entryId,
    sourcePath: cleanString(entry.sourcePath),
    noteType: cleanString(entry.noteType),
    noteTypeLabel: cleanString(entry.noteTypeLabel),
    contentHash: cleanString(entry.contentHash),
    contentVersion: cleanString(entry.contentVersion),
    settings: {
      evalId: entry.evalId,
      evalType: cleanString(entry.evalType) || 'unknown',
      mode: cleanString(entry.mode) || 'self',
      prompt,
      group: cleanString(entry.group),
      options: Array.isArray(entry.options) ? entry.options : [],
      sourceCollection: cleanString(entry.sourceCollection),
      entryId,
      entryTitle: title,
      noteType: cleanString(entry.noteType),
      noteTypeLabel: cleanString(entry.noteTypeLabel),
      sourcePath: cleanString(entry.sourcePath),
      contentHash: cleanString(entry.contentHash),
      contentVersion: cleanString(entry.contentVersion),
      evalSnapshot: entry.evalSnapshot || {},
    },
    weight: 1,
    updatedAt: new Date().toISOString(),
  };
};

const buildUpdatePayload = (
  existingAssignment: JsonRecord,
  candidate: JsonRecord,
): JsonRecord => {
  const existingKeys = new Set(Object.keys(existingAssignment || {}));
  const updatePayload: JsonRecord = {};

  Object.entries(candidate).forEach(([key, value]) => {
    if (key === 'id') return;
    if (!existingKeys.has(key)) return;
    if (valuesDiffer(existingAssignment[key], value)) {
      updatePayload[key] = value;
    }
  });

  return updatePayload;
};

const updateAssignmentSafe = async (
  supabase: SupabaseClient,
  assignmentId: string,
  payload: JsonRecord,
): Promise<void> => {
  let draft = { ...payload };
  let attempts = 0;

  while (Object.keys(draft).length > 0 && attempts < 14) {
    attempts += 1;
    const { error } = await supabase.from('Assignment').update(draft).eq('id', assignmentId);
    if (!error) return;

    const missingColumn = extractColumnNameFromError(String(error.message || ''));
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
  supabase: SupabaseClient,
  payload: JsonRecord,
): Promise<void> => {
  let draft = { ...payload };
  let attempts = 0;

  while (Object.keys(draft).length > 0 && attempts < 14) {
    attempts += 1;
    const { error } = await supabase.from('Assignment').insert([draft]);
    if (!error) return;

    const missingColumn = extractColumnNameFromError(String(error.message || ''));
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

const runEvalCatalogSync = async (
  options: Required<Pick<EvalCatalogSyncOptions, 'reason' | 'logger'>> &
    Pick<EvalCatalogSyncOptions, 'supabase'>,
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

  const supabase = resolveSupabaseClient(options.supabase);
  if (!supabase) {
    result.ok = false;
    result.errors.push({
      evalId: '*',
      message: 'SUPABASE_URL/SUPABASE_KEY are not available for eval catalog sync.',
    });
    const finishedMs = Date.now();
    result.finishedAt = new Date(finishedMs).toISOString();
    result.durationMs = finishedMs - startedMs;
    return result;
  }

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

    for (const entry of resolvedEntries) {
      try {
        const candidate = toAssignmentCandidate(entry);
        const { data: existing, error: findError } = await supabase
          .from('Assignment')
          .select('*')
          .eq('id', entry.evalId)
          .maybeSingle();

        if (findError) throw findError;

        if (!existing) {
          await insertAssignmentSafe(supabase, candidate);
          result.inserted += 1;
          continue;
        }

        const updatePayload = buildUpdatePayload(existing as JsonRecord, candidate);
        if (Object.keys(updatePayload).length === 0) {
          result.unchanged += 1;
          continue;
        }

        await updateAssignmentSafe(supabase, entry.evalId, updatePayload);
        result.updated += 1;
      } catch (error: any) {
        const message = String(error?.message || error || 'Unknown sync error');
        result.errors.push({ evalId: entry.evalId, message });
        options.logger.error(`[eval-sync] ${entry.evalId}: ${message}`);
      }
    }
  } catch (error: any) {
    const message = String(error?.message || error || 'Unable to build eval catalog');
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

  if (!force && syncState && now - syncState.finishedAtMs < ttlMs) {
    return { ...syncState.result, cached: true };
  }

  if (inFlightSync) return inFlightSync;

  inFlightSync = runEvalCatalogSync({
    reason,
    logger,
    supabase: options.supabase,
  })
    .then((result) => {
      syncState = {
        finishedAtMs: Date.now(),
        result,
      };
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
