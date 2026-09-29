import { mmRoute, json, requireUuidParam } from '../../../../lib/mm/api';
import { listPosts } from '../../../../lib/mm/forum';
import { normalizeMmLang } from '../../../../lib/mm/ui-lang';

export const prerender = false;

// Public: thread + posts. `bodyHtml` is rendered and sanitized by the core;
// `body` is the markdown source (JSON text, null when hidden/deleted).
// `?lang=nb` localizes citation rendering (default en).
export const GET = mmRoute({ tag: 'mm:thread' }, async ({ params, url }, { space, userId }) => {
  const threadId = requireUuidParam(params.id, 'thread id');
  const lang = normalizeMmLang(url.searchParams.get('lang')) ?? 'en';
  const view = await listPosts({ spaceId: space.id, threadId, viewerUserId: userId, lang });
  if (!view) return json({ error: 'Not found' }, 404);
  return json(view);
});
