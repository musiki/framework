import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

const LABEL_MAX = 120;
const VALID_DIMENSIONS = new Set(['thematic', 'rhetorical', 'emergent', 'manual']);
const ALL_ROLES = [
  'excluir',
  'afirmacion', 'definicion', 'contexto', 'literatura', 'ejemplo', 'analisis', 'contraste', 'transicion', 'sintesis', 'metodo', 'conclusion',
  'reflection', 'method', 'example', 'analysis', 'synthesis', 'closure',
  'scene_opening', 'image', 'motif_introduction', 'motif_return', 'variation', 'voice_shift', 'interruption', 'description', 'action', 'memory', 'dialogue', 'tension', 'turn', 'ellipsis', 'montage', 'resonance',
  'process_note', 'artistic_question', 'material_observation', 'technical_constraint', 'decision', 'discard', 'variant', 'documentation', 'peer_feedback', 'ai_feedback', 'revision', 'public_artifact'
];
const VALID_RHETORICAL_ROLES = new Set(ALL_ROLES.map(r => `rol:${r}`));
const VALID_TRACE_ROLES = new Set(ALL_ROLES);
const VALID_TRACE_MODES = new Set([
  'academic', 'thesis', 'lit_art', 'artistic_research', 'seminar', 'submission',
  'borrador', 'seminario', 'tesis', 'artistico', 'entrega'
]);
const TEXT_HASH_RE = /^[0-9a-f]{40}$/;

type RequestObject = Record<string, unknown>;

function asObject(value: unknown): RequestObject {
  return value !== null && typeof value === 'object' ? value as RequestObject : {};
}

function safeJsonRecords(value: unknown, maxItems = 50): object[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is object => item !== null && typeof item === 'object' && !Array.isArray(item))
    .slice(0, maxItems);
}

async function ownsNote(noteId: string, userId: string): Promise<boolean> {
  const { data } = await query(
    `SELECT id FROM "LiveClassNote" WHERE id = $1 AND "userId" = $2`,
    [noteId, userId],
  );
  return Boolean(data?.length);
}

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId = cleanString(url.searchParams.get('noteId') ?? '', 36);
  if (!noteId) return json({ error: 'noteId required' }, 400);

  if (!await ownsNote(noteId, user.id)) return json({ error: 'Not found' }, 403);

  const { data: codes, error: codesError } = await query(
    `SELECT id, note_id AS "noteId", para_index AS "paraIndex", label,
            dimension, source, confidence, created_at AS "createdAt", mode
     FROM "LiveClassNoteCode"
     WHERE note_id = $1
     ORDER BY para_index ASC, created_at ASC`,
    [noteId],
  );
  if (codesError) return json({ error: codesError.message }, 500);

  const { data: traces, error: tracesError } = await query(
    `SELECT DISTINCT ON (para_index)
            id, note_id AS "noteId", para_index AS "paraIndex", text_hash AS "textHash",
            main_theme AS "temaPrincipal", rhetorical_role AS "rolRetorico",
            concepts AS conceptos, relations AS relaciones, diagnostics AS diagnosticos,
            COALESCE(mode, analysis_mode) AS modo, paragraph_id AS "paragraphId",
            rhythm, sentences, source, updated_at AS "updatedAt"
     FROM "LiveClassNoteTrace"
     WHERE note_id = $1
     ORDER BY para_index ASC, updated_at DESC`,
    [noteId],
  );
  if (tracesError) return json({ error: tracesError.message }, 500);
  return json({ codes: codes ?? [], traces: traces ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body      = asObject(await request.json().catch(() => ({})));
  const noteId    = cleanString(body?.noteId ?? '', 36);
  const paraIndex = parseInt(String(body?.paraIndex ?? '-1'), 10);
  const label     = cleanString(String(body?.label ?? '').trim(), LABEL_MAX);
  const isLocalNlp = body?.source === 'local_nlp';
  if (isLocalNlp) {
    return json({ error: 'Local derived concepts belong in hash-keyed paragraph traces' }, 409);
  }
  const source = 'manual';
  const dimension = VALID_DIMENSIONS.has(body?.dimension) ? String(body.dimension) : 'manual';
  const confidence = 1;
  const mode = typeof body?.mode === 'string' && VALID_TRACE_MODES.has(body.mode)
    ? body.mode
    : 'academic';

  if (!noteId || !label || paraIndex < 0) return json({ error: 'noteId, paraIndex ≥ 0, label required' }, 400);
  if (dimension === 'rhetorical' && !VALID_RHETORICAL_ROLES.has(label)) {
    return json({ error: 'Invalid rhetorical role' }, 400);
  }

  if (!await ownsNote(noteId, user.id)) return json({ error: 'Not found' }, 403);

  const upsertSql = dimension === 'rhetorical'
    ? `INSERT INTO "LiveClassNoteCode" (id, note_id, para_index, label, dimension, source, confidence, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (note_id, para_index) WHERE dimension = 'rhetorical'
       DO UPDATE SET label = EXCLUDED.label, source = EXCLUDED.source,
                     confidence = EXCLUDED.confidence, mode = EXCLUDED.mode, created_at = now()
       RETURNING id, note_id AS "noteId", para_index AS "paraIndex",
                 label, dimension, source, confidence, mode`
    : `INSERT INTO "LiveClassNoteCode" (id, note_id, para_index, label, dimension, source, confidence, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (note_id, para_index, label) DO UPDATE SET mode = EXCLUDED.mode, created_at = now()
       RETURNING id, note_id AS "noteId", para_index AS "paraIndex",
                 label, dimension, source, confidence, mode`;
  const { data, error } = await query(
    upsertSql,
    [crypto.randomUUID(), noteId, paraIndex, label, dimension, source, confidence, mode],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ code: data?.[0] });
};

// PUT /api/live/notes/trace — persist paragraph traces calculated in-browser.
export const PUT: APIRoute = async ({ request, locals }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = asObject(await request.json().catch(() => ({})));
  const noteId = cleanString(body.noteId ?? '', 36);
  const rawTraces = Array.isArray(body.traces) ? body.traces.slice(0, 250) : [];
  if (!noteId || rawTraces.length === 0) return json({ error: 'noteId and traces required' }, 400);
  if (!await ownsNote(noteId, user.id)) return json({ error: 'Not found' }, 403);

  const saved = [];
  for (const raw of rawTraces) {
    const trace = asObject(raw);
    const paraIndex = typeof trace.paraIndex === 'number' && Number.isInteger(trace.paraIndex)
      ? trace.paraIndex
      : -1;
    const textHash = cleanString(trace.textHash ?? '', 40).toLowerCase();
    const temaPrincipal = cleanString(trace.temaPrincipal ?? '', LABEL_MAX) || null;
    const rolRetorico = cleanString(trace.rolRetorico ?? '', 32) || null;
    const modo = typeof trace.modo === 'string' && VALID_TRACE_MODES.has(trace.modo)
      ? trace.modo
      : 'academic';
    const paragraphId = typeof trace.paragraphId === 'string' ? trace.paragraphId : null;
    const rhythm = typeof trace.rhythm === 'object' && trace.rhythm !== null ? trace.rhythm : {};
    const sentences = Array.isArray(trace.sentences) ? trace.sentences : [];

    if (paraIndex < 0 || !TEXT_HASH_RE.test(textHash)) {
      return json({ error: 'Invalid paragraph trace key' }, 400);
    }
    if (rolRetorico && !VALID_TRACE_ROLES.has(rolRetorico)) {
      return json({ error: 'Invalid rhetorical role' }, 400);
    }

    const { data, error } = await query(
      `INSERT INTO "LiveClassNoteTrace"
         (id, note_id, para_index, text_hash, main_theme, rhetorical_role,
          concepts, relations, diagnostics, analysis_mode, source,
          paragraph_id, rhythm, sentences, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, 'local_nlp', $11, $12::jsonb, $13::jsonb, $14)
       ON CONFLICT (note_id, para_index, text_hash) DO UPDATE
       SET main_theme = EXCLUDED.main_theme,
           rhetorical_role = EXCLUDED.rhetorical_role,
           concepts = EXCLUDED.concepts,
           relations = EXCLUDED.relations,
           diagnostics = EXCLUDED.diagnostics,
           analysis_mode = EXCLUDED.analysis_mode,
           paragraph_id = EXCLUDED.paragraph_id,
           rhythm = EXCLUDED.rhythm,
           sentences = EXCLUDED.sentences,
           mode = EXCLUDED.mode,
           updated_at = now()
       RETURNING id, note_id AS "noteId", para_index AS "paraIndex",
                 text_hash AS "textHash", main_theme AS "temaPrincipal",
                 rhetorical_role AS "rolRetorico", concepts AS conceptos,
                 relations AS relaciones, diagnostics AS diagnosticos,
                 COALESCE(mode, analysis_mode) AS modo, source, updated_at AS "updatedAt",
                 paragraph_id AS "paragraphId", rhythm, sentences`,
      [
        crypto.randomUUID(), noteId, paraIndex, textHash, temaPrincipal, rolRetorico,
        JSON.stringify(safeJsonRecords(trace.conceptos)),
        JSON.stringify(safeJsonRecords(trace.relaciones)),
        JSON.stringify(safeJsonRecords(trace.diagnosticos)),
        modo,
        paragraphId,
        JSON.stringify(rhythm),
        JSON.stringify(safeJsonRecords(sentences, 50)),
        modo,
      ],
    );
    if (error) return json({ error: error.message }, 500);
    if (data?.[0]) saved.push(data[0]);
  }
  return json({ traces: saved });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const { error } = await query(
    `DELETE FROM "LiveClassNoteCode" nc
     USING "LiveClassNote" n
     WHERE nc.id = $1 AND nc.note_id = n.id AND n."userId" = $2`,
    [id, user.id],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
