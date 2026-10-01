// Server-side data for the mm concept page, shared by its two routes:
//   /<slug>    (internal /mm-app/concept/<slug>) — the permalink;
//   /c/<slug>  (internal /mm-app/c/<slug>)       — the old URL: 301 to the
//              permalink, except for older slugs that cannot live at the root
//              (reserved word, non-canonical), which are still served here.
// Resolution: live concept → page; rename alias → 301 to the concept's
// current permalink; anything else → 404.

import { getConcept, listConcepts, resolveConceptSlug, type ConceptListItem, type ConceptView } from './concepts';
import { listRelationTypes, type RelationTypeView } from './relation-types';
import { can } from './policy';
import { isConceptAuthor, loadMmViewer, logPageError, type MmViewer } from './page-data';
import { conceptPath, pageErrorState } from './view';
import { isRootSlug } from './slugs';
import type { PageState } from './board-pages';
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
    state: 'ok', redirect: null, viewer: null, concept: null, others: [], isAuthor: false, relationTypes: [],
  };
  if (!isMm || !slug || slug.length > 200 || (route === 'root' && !isRootSlug(slug))) return { ...out, state: 'notFound' };
  try {
    const viewer = await loadMmViewer(locals);
    out.viewer = viewer;
    const concept = await getConcept({ spaceId: viewer.space.id, slug, viewerUserId: viewer.userId, lang });
    if (!concept) {
      const resolved = await resolveConceptSlug({ spaceId: viewer.space.id, slug });
      if (resolved?.kind === 'alias') return { ...out, redirect: `${conceptPath(resolved.slug)}${search}` };
      return { ...out, state: 'notFound' };
    }
    // The old /c/<slug> URL of a concept that has a root permalink.
    if (route === 'legacy' && isRootSlug(concept.slug)) return { ...out, redirect: `${conceptPath(concept.slug)}${search}` };
    out.concept = concept;
    const role = viewer.role;
    const [isAuthor, others, relationTypes] = await Promise.all([
      role === 'member' ? isConceptAuthor(concept.id, viewer.userId) : Promise.resolve(false),
      can(role, 'createRelation') ? listConcepts({ spaceId: viewer.space.id }) : Promise.resolve([]),
      // Archived types too: existing relations may still use them (labels); the picker offers only live ones.
      listRelationTypes({ spaceId: viewer.space.id, includeArchived: true }),
    ]);
    out.isAuthor = isAuthor;
    out.others = others.filter((c) => c.slug !== concept.slug);
    out.relationTypes = relationTypes;
  } catch (err) {
    logPageError('concept', err);
    out.state = pageErrorState(err);
  }
  return out;
}
