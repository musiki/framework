// Server-side data for the mm forum pages, shared by the group and channel
// routes (src/pages/mm-app/f/[forum]/…):
//   /f/<group>                      group page (or a plain forum without channels)
//   /f/<group>/<channel>            channel page
//   /f/<group>/t/<thread>           thread of the group itself
//   /f/<group>/<channel>/t/<thread> thread of a channel
// A concept's discussion thread (under its correct board URL) is a 301 to the
// concept page, /<slug>?from=thread, where it is shown and answered; a
// relation type's definition thread likewise to /r/<type slug>?from=thread.
// A thread requested under a board it does not belong to is a 404 (never a
// redirect), as is a channel of another group or the reserved channel slug.

import { getForumByPath, listPosts, listThreads, type ForumSummary, type ThreadSummary, type ThreadView } from './forum';
import { listConcepts, type ConceptListItem } from './concepts';
import { loadMmViewer, logPageError, type MmViewer } from './page-data';
import { boardMatchesPath, conceptThreadRedirect, pageErrorState, threadRedirect } from './view';
import { typePath } from './relation-type-ui';
import { isUuid } from '../tenant/space-roles';
import type { MmLang } from './ui-lang';

export type PageState = 'ok' | 'notFound' | 'unavailable';

export type BoardPageData = {
  state: PageState;
  viewer: MmViewer | null;
  /** The board shown: the group itself, or the channel. */
  forum: ForumSummary | null;
  /** The group (same as `forum` on a group page). */
  group: ForumSummary | null;
  threads: ThreadSummary[];
  concepts: ConceptListItem[];
};

export async function loadBoardPage(
  locals: unknown,
  isMm: boolean,
  groupSlug: string,
  channelSlug: string | null,
): Promise<BoardPageData> {
  const out: BoardPageData = { state: 'ok', viewer: null, forum: null, group: null, threads: [], concepts: [] };
  if (!isMm) return { ...out, state: 'notFound' };
  try {
    out.viewer = await loadMmViewer(locals);
    const found = await getForumByPath({ spaceId: out.viewer.space.id, group: groupSlug, channel: channelSlug });
    if (!found || (channelSlug !== null && !found.channel)) return { ...out, state: 'notFound' };
    out.group = found.group;
    out.forum = found.channel ?? found.group;
    [out.threads, out.concepts] = await Promise.all([
      listThreads({ spaceId: out.viewer.space.id, forumId: out.forum.id, viewerUserId: out.viewer.userId }),
      listConcepts({ spaceId: out.viewer.space.id, forumId: out.forum.id }),
    ]);
  } catch (err) {
    logPageError(channelSlug ? 'channel' : 'forum', err);
    out.state = pageErrorState(err);
  }
  return out;
}

export async function loadThreadPage(
  locals: unknown,
  isMm: boolean,
  lang: MmLang,
  groupSlug: string,
  channelSlug: string | null,
  threadId: string,
  search = '',
): Promise<{ state: PageState; view: ThreadView | null; redirect: string | null }> {
  if (!isMm || !isUuid(threadId)) return { state: 'notFound', view: null, redirect: null };
  try {
    const viewer = await loadMmViewer(locals);
    const view = await listPosts({ spaceId: viewer.space.id, threadId, viewerUserId: viewer.userId, lang });
    // The thread must belong to the board named by the URL (group or group/channel).
    if (!view || !boardMatchesPath(view.thread.forum, groupSlug, channelSlug)) return { state: 'notFound', view: null, redirect: null };
    // A concept's discussion thread lives on the concept page (Discussion section).
    // No fragment in the Location: the browser keeps the reader's own (#post-…);
    // ?from=thread lets the page land on the Discussion otherwise (scripts/mm/fold.ts).
    if (view.thread.concept) return { state: 'ok', view: null, redirect: conceptThreadRedirect(view.thread.concept.slug, search) };
    // A relation type's definition thread lives on its page /r/<slug> (Discussion section).
    if (view.thread.relationType) return { state: 'ok', view: null, redirect: threadRedirect(typePath(view.thread.relationType.slug), search) };
    return { state: 'ok', view, redirect: null };
  } catch (err) {
    logPageError('thread', err);
    return { state: pageErrorState(err), view: null, redirect: null };
  }
}

