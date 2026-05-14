import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { query } from '../../../lib/db/pool';
import { resolveUserIdByEmail } from '../../../lib/user-email';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = (await getSession(request)) as any;
    const email = String(session?.user?.email || '').toLowerCase().trim();
    if (!email) return new Response(null, { status: 204 });

    const userId = await resolveUserIdByEmail(email).catch(() => null);
    if (!userId) return new Response(null, { status: 204 });

    const { data: recent } = await query(
      `SELECT id FROM "PlatformLoginLog"
       WHERE "userId" = $1 AND "createdAt" > NOW() - INTERVAL '4 hours'
       LIMIT 1`,
      [userId],
    );
    if (recent && recent.length > 0) return new Response(null, { status: 204 });

    const name = String(session?.user?.name || '').trim() || null;
    await query(
      `INSERT INTO "PlatformLoginLog" ("userId", email, name, "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [userId, email, name],
    );
  } catch {
    // never fail the page
  }
  return new Response(null, { status: 204 });
};
