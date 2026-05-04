import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const result = await query(
    `SELECT id, url, name, type, folder, source, "createdBy", "sortOrder", "createdAt"
     FROM "LiveClassResource"
     WHERE "roomName" = $1
       AND source IN ('chat', 'sa', 'sv', 'external-media')
     ORDER BY "createdAt" ASC`,
    [roomName],
  );

  if (result.error) return json({ error: result.error.message }, 500);
  return json({ items: result.data ?? [] });
};
