// Server-side context for the mm pages (SSR): the commons space, the viewer's
// user id and role. Pages call the cores directly with it (the client scripts
// use /api/mm/*). Any failure here (no database, space not seeded) is thrown
// to the page, which renders the friendly "unavailable" state.

import { query } from '../db/pool';
import { resolveUserIdByEmail } from '../user-email';
import { loadMmSpace, type MmSpace } from './api-core.ts';
import { getCommonsRole } from './concepts';
import type { QueryFn } from './concepts-core.ts';
import type { CommonsRole } from '../tenant/space-roles.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

export type MmViewer = { space: MmSpace; userId: string | null; role: CommonsRole | null; signedIn: boolean };

export class MmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MmUnavailableError';
  }
}

export async function loadMmViewer(locals: any): Promise<MmViewer> {
  const space = await loadMmSpace(poolQ);
  if (!space) throw new MmUnavailableError('mm commons space is not seeded');
  const email = locals?.session?.user?.email;
  const userId = email ? await resolveUserIdByEmail(email) : null;
  const role = userId ? await getCommonsRole(space.id, userId) : null;
  return { space, userId, role, signedIn: Boolean(locals?.session?.user) };
}

/** Whether `userId` proposed the concept (members may edit their own concepts' definitions). */
export async function isConceptAuthor(conceptId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await poolQ(
    `SELECT 1 FROM "Concept" WHERE id = $1::uuid AND "createdBy" = $2::uuid LIMIT 1`,
    [conceptId, userId],
  );
  if (error) throw error;
  return Boolean(data && data.length);
}

/** Logs a page data failure without leaking details to the reader. */
export function logPageError(tag: string, err: unknown): void {
  console.error(`[mm:page:${tag}]`, err instanceof Error ? `${err.name}: ${err.message}` : err);
}
