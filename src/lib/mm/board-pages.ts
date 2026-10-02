// Server-side data for the mm forum pages, shared by the group and channel
// routes. Boards live at the root (concepts and groups share it):
//   /<group>                      group page (or a plain forum without channels;
//                                 src/pages/mm-app/root/[slug].astro, after the
//                                 concept check — lib/mm/concept-page.ts)
//   /<group>/<channel>            channel page   (src/pages/mm-app/b/…)
//   /<group>/t/<thread>           thread of the group itself
//   /<group>/<channel>/t/<thread> thread of a channel
// The old /f/… URLs (src/pages/mm-app/f/[forum]/…) load the same data and
// answer 301 to the root path, query kept; a board whose slug cannot live at
// the root (view.ts forumPath) is still served there.
// A concept's discussion thread (under its correct board URL) is a 301 to the
// concept page, /<slug>?from=thread, where it is shown and answered; a
// relation type's definition thread likewise to /r/<type slug>?from=thread.
// A thread requested under a board it does not belong to is a 404 (never a
// redirect), as is a channel of another group or the reserved channel slug.

import { getForumByPath, listPosts, listThreads, type ForumSummary, type ThreadSummary, type ThreadView } from './forum';
import { listConcepts, resolveConceptSlug, type ConceptListItem } from './concepts';
import { loadMmViewer, logPageError, type MmViewer } from './page-data';
import {
  boardMatchesPath, boardPath, boardThreadPath, conceptThreadRedirect, legacyForumRedirect, pageErrorState, threadRedirect,
} from './view';
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
    return await boardPageFor(out.viewer, found.group, found.channel);
  } catch (err) {
    logPageError(channelSlug ? 'channel' : 'forum', err);
    out.state = pageErrorState(err);
  }
  return out;
}

/** Board page data for a group (or one of its channels) already found. */
export async function boardPageFor(viewer: MmViewer, group: ForumSummary, channel: ForumSummary | null): Promise<BoardPageData> {
  const forum = channel ?? group;
  const out: BoardPageData = { state: 'ok', viewer, forum, group, threads: [], concepts: [] };
  try {
    [out.threads, out.concepts] = await Promise.all([
      listThreads({ spaceId: viewer.space.id, forumId: forum.id, viewerUserId: viewer.userId }),
      listConcepts({ spaceId: viewer.space.id, forumId: forum.id }),
    ]);
  } catch (err) {
    logPageError(channel ? 'channel' : 'forum', err);
    out.state = pageErrorState(err);
  }
  return out;
}

/**
 * The old /f/<group>[/<channel>] URL of a loaded board: its root path (query
 * kept), or null when the board stays under /f/ — a slug that cannot live at
 * the root, or a group whose slug a live concept holds (data older than the
 * shared namespace: the root shows the concept).
 */
export async function legacyBoardRedirect(data: BoardPageData, search = ''): Promise<string | null> {
  if (data.state !== 'ok' || !data.forum || !data.viewer) return null;
  const target = legacyForumRedirect(boardPath(data.forum), search);
  if (!target || data.forum.parent) return target;
  try {
    const held = await resolveConceptSlug({ spaceId: data.viewer.space.id, slug: data.forum.slug });
    return held?.kind === 'live' ? null : target;
  } catch (err) {
    logPageError('forum', err);
    return null;
  }
}

/**
 * A thread page's data. `legacy`: the request came by the old /f/… URL, which
 * answers 301 to the thread's root path (query kept) when it has one.
 */
export async function loadThreadPage(
  locals: unknown,
  isMm: boolean,
  lang: MmLang,
  groupSlug: string,
  channelSlug: string | null,
  threadId: string,
  search = '',
  legacy = false,
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
    const moved = legacy && view.thread.forum ? legacyForumRedirect(boardThreadPath(view.thread.forum, view.thread.id), search) : null;
    if (moved) return { state: 'ok', view: null, redirect: moved };
    return { state: 'ok', view, redirect: null };
  } catch (err) {
    logPageError('thread', err);
    return { state: pageErrorState(err), view: null, redirect: null };
  }
}

