import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { query } from '../../../lib/db/pool';
import { resolveUserIdByEmail } from '../../../lib/user-email';

export const POST: APIRoute = async ({ request }) => {
  const session = (await getSession(request)) as any;
  const user = session?.user;

  if (!user?.email) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const nextSettings = body?.settings || {};

    const normalizedEmail = String(user.email).toLowerCase().trim();
    
    // Resolve user ID using existing multi-email logic
    // Passing null for supabase as resolveUserIdByEmail has been updated
    const userId = await resolveUserIdByEmail(normalizedEmail).catch(() => null);
    
    if (!userId) {
      // Fallback to direct email lookup if not in UserEmail table yet
      const { data: userRows } = await query(
        `SELECT id, settings FROM "User" WHERE "email" ILIKE $1 LIMIT 1`,
        [normalizedEmail]
      );
      const directUser = userRows?.[0];
      
      if (!directUser) {
        return new Response(JSON.stringify({ error: 'User not found in DB' }), { status: 404 });
      }

      const mergedSettings = { ...(directUser.settings || {}), ...nextSettings };
      const { error: updateError } = await query(
        `UPDATE "User" SET settings = $1, "updatedAt" = $2 WHERE id = $3`,
        [mergedSettings, new Date().toISOString(), directUser.id]
      );
      
      if (updateError) throw updateError;
    } else {
      // Fetch current settings to merge
      const { data: userRows } = await query(
        `SELECT settings FROM "User" WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const currentUser = userRows?.[0];

      const mergedSettings = { ...(currentUser?.settings || {}), ...nextSettings };
      const { error: updateError } = await query(
        `UPDATE "User" SET settings = $1, "updatedAt" = $2 WHERE id = $3`,
        [mergedSettings, new Date().toISOString(), userId]
      );
      
      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({ success: true }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Error updating user settings:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed to update settings' }), { status: 500 });
  }
};
