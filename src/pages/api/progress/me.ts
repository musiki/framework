import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { buildEvalCatalog } from '../../../lib/eval-catalog';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const lastSegment = (value: string): string => {
  const parts = String(value || '').split('/').filter(Boolean);
  return (parts[parts.length - 1] || String(value || '')).replace(/\.(md|mdx)$/i, '');
};

// GET /api/progress/me[?courseId=...]
// Server-authoritative progress per note for the current user, derived from the
// Submission table joined with the eval catalog (evalId -> note). Returns one
// record per note that has at least one submission, plus a flat submissions
// summary. `read` is not tracked server-side (kept client-side in localStorage).
export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) return json({ error: 'Not authenticated' }, 401);

  try {
    const url = new URL(request.url);
    const courseFilter = String(url.searchParams.get('courseId') || '').trim();

    const { data: userRows } = await query(
      'SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1',
      [currentUser.email],
    );
    const userId = userRows?.[0]?.id;
    if (!userId) return json({ notes: [], totals: { submissions: 0, notes: 0 } });

    const { data: submissions } = await query(
      `SELECT "assignmentId", "payload", "score", "submittedAt"
       FROM "Submission" WHERE "userId" = $1`,
      [userId],
    );

    const catalog = await buildEvalCatalog();

    const byNote = new Map<string, any>();
    let matched = 0;
    for (const sub of submissions || []) {
      const evalId = String(sub?.assignmentId || '');
      if (!evalId) continue;
      const entry = catalog.get(evalId)?.[0];
      if (!entry) continue;
      if (courseFilter && entry.courseId && entry.courseId !== courseFilter) continue;
      matched += 1;

      const key = entry.entryId || evalId;
      const rec = byNote.get(key) || {
        entryId: entry.entryId,
        noteSlug: lastSegment(entry.entryId || entry.sourcePath || evalId),
        courseId: entry.courseId || '',
        title: entry.entryTitle || '',
        completed: false,
        evaluated: false,
        submissions: 0,
      };
      rec.submissions += 1;

      const payload = (sub?.payload && typeof sub.payload === 'object') ? sub.payload : {};
      const isMcc = entry.evalType === 'mcc';
      const completedFlag = payload?.completed === true
        || (payload?.answer && typeof payload.answer === 'object' && payload.answer.completed === true);
      if (isMcc) {
        if (completedFlag) rec.completed = true;
      } else {
        rec.evaluated = true;
      }
      byNote.set(key, rec);
    }

    const notes = [...byNote.values()];
    return json({
      notes,
      totals: { submissions: matched, notes: notes.length },
    });
  } catch (error: any) {
    console.error('[progress/me] error:', error?.message || error);
    return json({ error: error?.message || 'progress error' }, 500);
  }
};
