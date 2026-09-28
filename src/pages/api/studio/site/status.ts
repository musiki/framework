import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { json } from '../../../../lib/forum-server';
import { getStudioUserId, listMemberships, studioEnabled } from '../../../../lib/tenant/studio-db';

export const prerender = false;

function statusPath(): string {
  return process.env.SO_BUILD_STATUS || '/opt/so/.last-build.json';
}

// GET /api/studio/site/status -> the contents of the so-web rebuild
// watcher's last-build report, or { ok: null } when it hasn't run (or run
// yet) on this machine. Author-only: only the dissertation's author needs
// to see build health.
export const GET: APIRoute = async ({ locals }) => {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);

  const memberships = await listMemberships(locals.tenant.id, userId);
  const isAuthor = memberships.some((m) => m.role === 'author');
  if (!isAuthor) return json({ error: 'Forbidden' }, 403);

  try {
    const raw = await fs.readFile(statusPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return json(parsed);
    }
    return json({ ok: null });
  } catch {
    // Missing file, unreadable, or invalid JSON: report "unknown" rather
    // than a server error — no build has produced a status yet.
    return json({ ok: null });
  }
};
