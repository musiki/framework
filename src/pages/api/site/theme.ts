import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { isElevatedGlobalRole } from '../../../lib/roles';
import {
  DEFAULT_SITE_THEME,
  isSiteTheme,
  readGlobalSiteTheme,
  writeGlobalSiteTheme,
} from '../../../lib/site-theme';

export const prerender = false;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export const GET: APIRoute = async () => {
  try {
    return json({ theme: await readGlobalSiteTheme() });
  } catch (error) {
    console.error('Unable to read the global site theme:', error);
    return json({ theme: DEFAULT_SITE_THEME, fallback: true });
  }
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const session = (locals as { session?: { user?: { email?: string | null } } | null }).session;
  const email = String(session?.user?.email || '').trim();
  if (!email) return json({ error: 'Not authenticated' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const requestedTheme =
    body && typeof body === 'object' && 'theme' in body
      ? (body as { theme?: unknown }).theme
      : undefined;
  if (!isSiteTheme(requestedTheme)) {
    return json({ error: 'Theme must be default or invulne' }, 400);
  }

  try {
    const { data, error } = await query<{ id: string; role: string }>(
      `SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1 ORDER BY "updatedAt" DESC`,
      [email],
      0,
    );
    if (error) throw error;

    const requester = data?.find((row) => isElevatedGlobalRole(row.role)) || data?.[0];
    if (!requester || !isElevatedGlobalRole(requester.role)) {
      return json({ error: 'Only teachers can change the global theme' }, 403);
    }

    const theme = await writeGlobalSiteTheme(requestedTheme, requester.id);
    return json({ theme });
  } catch (error) {
    console.error('Unable to update the global site theme:', error);
    return json({ error: 'Unable to update the global theme' }, 500);
  }
};
