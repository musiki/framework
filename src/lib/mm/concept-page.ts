// Server-side data for the mm concept page, shared by its two routes:
//   /<slug>    (internal /mm-app/root/<slug>) — the permalink, a namespace
//              shared with the forum groups: live concept → concept page;
//              else a group → its board page (`board`); else a rename alias
//              → 301; else 404 (slugs.ts resolveRootSlug);
//   /c/<slug>  (internal /mm-app/c/<slug>)       — the old URL: 301 to the
//              permalink, except for older slugs that cannot live at the root
//              (reserved word, non-canonical), which are still served here.
// Resolution: live concept → page; rename alias → 301 to the concept's
// current permalink; anything else → 404. The page also carries the concept's
// discussion thread (its thread URLs 301 here, see board-pages.ts).

import { getConcept, listConcepts, resolveConceptSlug, type ConceptListItem, type ConceptView } from './concepts';
import { listRelationTypes, type RelationTypeView } from './relation-types';
import { getForumByPath, listPosts, type ThreadView } from './forum';
import { can } from './policy';
import { isConceptAuthor, loadMmViewer, logPageError, type MmViewer } from './page-data';
import { conceptPath, pageErrorState } from './view';
import { isRootSlug, resolveRootSlug } from './slugs';
import { boardPageFor, type BoardPageData, type PageState } from './board-pages';
import type { MmLang } from './ui-lang';

export type ConceptPageData = {
  state: PageState;
  /** Set when the request must be answered with a 301 to this path (query kept). */
  redirect: string | null;
  viewer: MmViewer | null;
  concept: ConceptView | null;
  /** Concepts the relation picker offers (members+; never this one). */
  others: ConceptListItem[];
  isAuthor: boolean;
  relationTypes: RelationTypeView[];
  /**
   * The concept's discussion thread with its posts (Discussion section), or
   * null when it has none or its board is archived (the thread is closed).
   */
  discussion: ThreadView | null;
  /** Root route only: the slug names a forum group, whose board page is shown instead. */
  board: BoardPageData | null;
};

export async function loadConceptPage(
  locals: unknown,
  isMm: boolean,
  lang: MmLang,
  slug: string,
  route: 'root' | 'legacy',
  search = '',
): Promise<ConceptPageData> {
  const out: ConceptPageData = {
    state: 'ok', redirect: null, viewer: null, concept: null, others: [], isAuthor: false, relationTypes: [], discussion: null,
    board: null,
  };
  if (!isMm || !slug || slug.length > 200 || (route === 'root' && !isRootSlug(slug))) return { ...out, state: 'notFound' };
  try {
    const viewer = await loadMmViewer(locals);
    out.viewer = viewer;
    const concept = await getConcept({ spaceId: viewer.space.id, slug, viewerUserId: viewer.userId, lang });
    if (!concept) {
      // The root is shared with the forum groups (the old /c/ URL never names a group).
      const found = route === 'root' ? await getForumByPath({ spaceId: viewer.space.id, group: slug }) : null;
      const resolved = found ? null : await resolveConceptSlug({ spaceId: viewer.space.id, slug });
      switch (resolveRootSlug({ concept: false, group: Boolean(found), alias: resolved?.kind === 'alias' })) {
        case 'group':
          return { ...out, board: await boardPageFor(viewer, found!.group, null) };
        case 'alias':
          return { ...out, redirect: `${conceptPath(resolved!.slug)}${search}` };
        default:
          return { ...out, state: 'notFound' };
      }
    }
    // The old /c/<slug> URL of a concept that has a root permalink.
    if (route === 'legacy' && isRootSlug(concept.slug)) return { ...out, redirect: `${conceptPath(concept.slug)}${search}` };
    out.concept = concept;
    const role = viewer.role;
    const [isAuthor, others, relationTypes, discussion] = await Promise.all([
      role === 'member' ? isConceptAuthor(concept.id, viewer.userId) : Promise.resolve(false),
      can(role, 'createRelation') ? listConcepts({ spaceId: viewer.space.id }) : Promise.resolve([]),
      // Archived types too: existing relations may still use them (labels); the picker offers only live ones.
      listRelationTypes({ spaceId: viewer.space.id, includeArchived: true }),
      // listPosts is null for an archived thread or board: the discussion is closed.
      concept.threadId && !concept.originArchived
        ? listPosts({ spaceId: viewer.space.id, threadId: concept.threadId, viewerUserId: viewer.userId, lang })
        : Promise.resolve(null),
    ]);
    out.isAuthor = isAuthor;
    out.others = others.filter((c) => c.slug !== concept.slug);
    out.relationTypes = relationTypes;
    // Only the concept's own thread (listPosts names its concept) is shown as its discussion.
    out.discussion = discussion && discussion.thread.concept?.slug === concept.slug ? discussion : null;
  } catch (err) {
    logPageError('concept', err);
    out.state = pageErrorState(err);
  }
  return out;
}
