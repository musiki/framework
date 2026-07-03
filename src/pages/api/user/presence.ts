import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { query } from '../../../lib/db/pool';
import { resolveUserIdByEmail } from '../../../lib/user-email';

type PresenceUser = {
  userId: string;
  name: string;
  image: string;
  role: string;
  courseId: string;
  lastActiveAt: number;
};

// Global in-memory presence store on the server
const presenceStore = new Map<string, PresenceUser>();

// Cleanup helper: remove users inactive for more than 45 seconds
const cleanupPresence = () => {
  const cutoff = Date.now() - 45_000;
  for (const [userId, user] of presenceStore.entries()) {
    if (user.lastActiveAt < cutoff) {
      presenceStore.delete(userId);
    }
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = (await getSession(request)) as any;
    const email = String(session?.user?.email || '').toLowerCase().trim();
    if (!email) {
      cleanupPresence();
      return new Response(JSON.stringify({ users: Array.from(presenceStore.values()) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resolvedUserId = await resolveUserIdByEmail(email).catch(() => null);
    
    const { data: dbUserRows } = resolvedUserId
      ? await query(`SELECT id, role, name, image FROM "User" WHERE "id" = $1`, [resolvedUserId])
      : await query(`SELECT id, role, name, image FROM "User" WHERE LOWER("email") = $1`, [email]);
      
    const dbUser = dbUserRows?.[0] || null;
    if (!dbUser) {
      cleanupPresence();
      return new Response(JSON.stringify({ users: Array.from(presenceStore.values()) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json().catch(() => ({}));
    const courseId = String(body?.courseId || '').trim();

    const userId = String(dbUser.id);
    presenceStore.set(userId, {
      userId,
      role: String(dbUser.role || 'student').trim(),
      name: String(dbUser.name || session.user.name || session.user.email || ''),
      image: String(dbUser.image || session.user.image || ''),
      courseId,
      lastActiveAt: Date.now(),
    });

    cleanupPresence();

    return new Response(JSON.stringify({ users: Array.from(presenceStore.values()) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Presence error:', error);
    cleanupPresence();
    return new Response(JSON.stringify({ users: Array.from(presenceStore.values()) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
