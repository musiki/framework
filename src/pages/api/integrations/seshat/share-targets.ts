import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/pool';

export const prerender = false;

const bearerToken = (request: Request) => {
  const match = String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

const equalSecret = (received: string, expected: string) => {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

const normalize = (value: unknown) => String(value ?? '').trim();
const normalizeEmail = (value: unknown) => normalize(value).toLowerCase();
const surnameFromName = (value: unknown) => {
  const parts = normalize(value).split(/\s+/).filter(Boolean);
  return parts.at(-1) || '';
};

type ShareTarget = {
  id: string;
  type: 'user' | 'group';
  label: string;
  email?: string;
  emails?: string[];
  memberCount?: number;
};

export const GET: APIRoute = async ({ request, url }) => {
  const expected = String(process.env.SESHAT_INTEGRATION_TOKEN || '').trim();
  if (!expected || !equalSecret(bearerToken(request), expected)) {
    return Response.json({ error: 'integration_authentication_required' }, { status: 401 });
  }

  const viewerEmail = normalizeEmail(request.headers.get('x-seshat-owner'));
  const search = normalize(url.searchParams.get('q')).toLocaleLowerCase('es').slice(0, 120);

  try {
    const [{ data: userRows, error: usersError }, { data: profileRows, error: profilesError }] = await Promise.all([
      query(
        `SELECT id, name, email
           FROM "User"
          WHERE email IS NOT NULL AND BTRIM(email) <> ''
          ORDER BY COALESCE(NULLIF(BTRIM(name), ''), email) ASC`,
      ),
      query(
        `SELECT DISTINCT ON (s."userId", s."assignmentId")
                s."userId", s."assignmentId", s.payload, s."submittedAt", u.name, u.email
           FROM "Submission" s
           JOIN "User" u ON u.id = s."userId"
          WHERE s."assignmentId" LIKE '__meta__:course-student-profile:%'
            AND COALESCE(s.payload->>'grupo', s.payload->>'group', '') <> ''
          ORDER BY s."userId", s."assignmentId", s."submittedAt" DESC NULLS LAST`,
      ),
    ]);

    if (usersError) throw usersError;
    if (profilesError) throw profilesError;

    const users: ShareTarget[] = (userRows || [])
      .map((row: any) => {
        const email = normalizeEmail(row?.email);
        const name = normalize(row?.name) || email;
        return { id: `user:${row?.id || email}`, type: 'user' as const, label: name, email };
      })
      .filter((target) => target.email && target.email !== viewerEmail);

    const groups = new Map<string, { grupo: string; courseId: string; year: string; members: Map<string, string> }>();
    for (const row of profileRows || []) {
      const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
      const grupo = normalize(payload?.grupo || payload?.group);
      const courseId = normalize(payload?.courseId || payload?.course || payload?.courseSlug);
      const year = normalize(payload?.year);
      const email = normalizeEmail(row?.email);
      if (!grupo || !courseId || !year || !email) continue;
      const key = `${courseId.toLocaleLowerCase('es')}::${year}::${grupo.toLocaleLowerCase('es')}`;
      const group = groups.get(key) || { grupo, courseId, year, members: new Map<string, string>() };
      group.members.set(email, surnameFromName(row?.name) || email.split('@')[0]);
      groups.set(key, group);
    }

    const groupTargets: ShareTarget[] = Array.from(groups.entries()).map(([key, group]) => {
      const emails = Array.from(group.members.keys()).filter((email) => email !== viewerEmail).sort();
      const surnames = Array.from(new Set(group.members.values())).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
      return {
        id: `group:${key}`,
        type: 'group',
        label: `Grupo ${group.grupo} ${group.courseId} ${group.year} (${surnames.join(', ')})`,
        emails,
        memberCount: emails.length,
      };
    }).filter((target) => (target.emails?.length || 0) > 0);

    const matches = (target: ShareTarget) => {
      if (!search) return true;
      return [target.label, target.email, ...(target.emails || [])]
        .some((value) => normalize(value).toLocaleLowerCase('es').includes(search));
    };

    const targets = [...groupTargets, ...users]
      .filter(matches)
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === 'group' ? -1 : 1;
        return left.label.localeCompare(right.label, 'es', { numeric: true, sensitivity: 'base' });
      })
      .slice(0, 50);

    return Response.json({ targets }, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error) {
    console.error('[musiki:seshat:share-targets]', error);
    return Response.json({ error: 'share_targets_failed' }, { status: 500 });
  }
};
