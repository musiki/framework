// Pure site model: turns the so studio's `Site` folder tree (folders + notes,
// already filtered by the caller to Site descendants with effective
// visibility `public`) into public pages, paths and a header menu.
//
// No astro/db imports — usable from plain `node --test` runs and from the
// so studio server code alike (see src/lib/writing/tree/model.ts, which this
// reuses for sibling ordering).

import { displayOrderFolders, displayOrderNotes } from '../writing/tree/model.ts';
import { parseFrontmatter, slugify, type SiteFrontmatter } from './frontmatter.ts';

export type SiteFolder = {
  id: string;
  parentId: string;
  name: string;
  position?: number | null;
};

export type SiteNote = {
  id: string;
  folderId: string;
  title: string;
  body: string;
  position?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type SitePage = {
  id: string;
  title: string;
  path: string;
  layout: 'page' | 'home' | 'blog' | 'tags';
  description?: string;
  date: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  markdown: string;
};

export type MenuItem = {
  title: string;
  path: string;
  children: MenuItem[];
};

export type SiteModel = {
  pages: SitePage[];
  menu: MenuItem[];
};

type ParsedNote = SiteNote & { fm: SiteFrontmatter; markdown: string };

type Item = { kind: 'folder'; folder: SiteFolder } | { kind: 'note'; note: ParsedNote };

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Join a path prefix with a slug, treating '' and '/' as the same (root) prefix. */
function joinPath(prefix: string, slug: string): string {
  if (prefix === '' || prefix === '/') return `/${slug}`;
  return `${prefix}/${slug}`;
}

export function buildSiteModel(input: { siteFolderId: string; folders: SiteFolder[]; notes: SiteNote[] }): SiteModel {
  const { siteFolderId, folders, notes } = input;

  const foldersByParent = new Map<string, SiteFolder[]>();
  for (const f of folders) {
    const list = foldersByParent.get(f.parentId) ?? [];
    list.push(f);
    foldersByParent.set(f.parentId, list);
  }

  const notesByFolder = new Map<string, ParsedNote[]>();
  for (const n of notes) {
    const { data, body } = parseFrontmatter(n.body);
    if (data.draft === true) continue; // drafts excluded
    const list = notesByFolder.get(n.folderId) ?? [];
    list.push({ ...n, fm: data, markdown: body });
    notesByFolder.set(n.folderId, list);
  }

  // Same display order the studio tree renders: folders before notes at
  // every level, exactly like buildTree in ../writing/tree/model.ts. Home
  // is the first item in this order at the Site root that yields at least
  // one page (see homeIndex below) — empty/drafts-only folders are skipped.
  function orderedChildren(parentId: string): Item[] {
    const childFolders = displayOrderFolders(foldersByParent.get(parentId) ?? [], 'en');
    const childNotes = displayOrderNotes(notesByFolder.get(parentId) ?? [], 'en');
    return [
      ...childFolders.map((folder): Item => ({ kind: 'folder', folder })),
      ...childNotes.map((note): Item => ({ kind: 'note', note })),
    ];
  }

  // Every path handed out so far. A collision gets the next *unused*
  // `-N` suffix, so a later page whose own slug happens to be `foo-2`
  // (or an earlier one that already took it) can never collide with a
  // generated suffix: foo, foo, foo-2 -> /foo, /foo-2, /foo-3.
  const used = new Set<string>();
  function dedupe(path: string): string {
    let candidate = path;
    for (let n = 2; used.has(candidate); n++) candidate = `${path}-${n}`;
    used.add(candidate);
    return candidate;
  }

  // Whether a folder (recursively) contains at least one publishable
  // (non-draft) note — i.e. whether it would produce any page at all.
  const yieldsCache = new Map<string, boolean>();
  function folderYieldsPages(folderId: string): boolean {
    const cached = yieldsCache.get(folderId);
    if (cached !== undefined) return cached;
    yieldsCache.set(folderId, false); // cycle guard
    const result =
      (notesByFolder.get(folderId)?.length ?? 0) > 0 ||
      (foldersByParent.get(folderId) ?? []).some((f) => folderYieldsPages(f.id));
    yieldsCache.set(folderId, result);
    return result;
  }
  function itemYieldsPages(item: Item): boolean {
    return item.kind === 'note' || folderYieldsPages(item.folder.id);
  }

  function pageFrom(note: ParsedNote, path: string): SitePage {
    const createdAt = toIso(note.createdAt);
    return {
      id: note.id,
      title: note.title,
      path,
      layout: note.fm.layout ?? 'page',
      ...(note.fm.description !== undefined ? { description: note.fm.description } : {}),
      date: note.fm.date ?? createdAt,
      tags: note.fm.tags ?? [],
      createdAt,
      updatedAt: toIso(note.updatedAt),
      markdown: note.markdown,
    };
  }

  function buildFromItems(items: Item[], pathPrefix: string, isHomeLevel: boolean): { pages: SitePage[]; menu: MenuItem[] } {
    const pages: SitePage[] = [];
    const menu: MenuItem[] = [];

    // Home is the first root item that actually yields a page: an empty
    // (or drafts-only) folder sorted first must not swallow `/`.
    const homeIndex = isHomeLevel ? items.findIndex(itemYieldsPages) : -1;

    items.forEach((item, index) => {
      const isHomeItem = isHomeLevel && index === homeIndex;

      if (item.kind === 'note') {
        const note = item.note;
        const slug = note.fm.slug || slugify(note.title);
        const rawPath = isHomeItem ? '/' : joinPath(pathPrefix, slug);
        const path = dedupe(rawPath);
        pages.push(pageFrom(note, path));
        if (note.fm.menu !== false) {
          menu.push({ title: note.title, path, children: [] });
        }
        return;
      }

      const folder = item.folder;
      const folderSlug = slugify(folder.name);
      const folderPathPrefix = isHomeItem ? '/' : joinPath(pathPrefix, folderSlug);

      // Landing lookup only ever considers this folder's own direct notes
      // (never descends into subfolders), even when a subfolder happens to
      // contain its own `slug: index` note.
      const directNotes = displayOrderNotes(notesByFolder.get(folder.id) ?? [], 'en');
      const indexNote = directNotes.find((n) => n.fm.slug === 'index');
      const landing = indexNote ?? directNotes[0];

      const childItems = orderedChildren(folder.id).filter(
        (it) => !(landing && it.kind === 'note' && it.note.id === landing.id),
      );

      // Page generation is unaffected by menu visibility: the landing page
      // (if any) and every descendant page are always produced.
      const pagesHere: SitePage[] = [];
      let landingPath: string | undefined;
      if (landing) {
        landingPath = dedupe(isHomeItem ? '/' : folderPathPrefix);
        pagesHere.push(pageFrom(landing, landingPath));
      }

      const sub = buildFromItems(childItems, folderPathPrefix, false);
      pagesHere.push(...sub.pages);
      pages.push(...pagesHere);

      // Menu groups never flatten: a folder with any menu-visible
      // descendant (its own visible landing, or anything nested — direct
      // notes, or subfolder groups, recursively) always gets exactly one
      // group entry `{ title: folderName, path, children }` here, never
      // its children promoted to this level in its place.
      //
      // `path` is the landing's path when the landing exists and is
      // menu-visible; otherwise it falls back to the path of the first
      // menu-visible descendant in depth-first display order — which is
      // exactly `sub.menu[0].path`, since `sub.menu` was itself built by
      // this same rule, in display order, one level down.
      const landingVisible = !!landing && landing.fm.menu !== false;
      const childrenVisible = sub.menu.length > 0;
      if (landingVisible || childrenVisible) {
        const groupPath = landingVisible ? (landingPath as string) : sub.menu[0].path;
        menu.push({ title: folder.name, path: groupPath, children: sub.menu });
      }
      // A folder with no visible landing and no visible descendants
      // contributes nothing to the menu. If it also has no publishable
      // pages at all, `pagesHere` was empty too, so it's fully omitted.
    });

    return { pages, menu };
  }

  const { pages, menu } = buildFromItems(orderedChildren(siteFolderId), '', true);
  return { pages, menu };
}
