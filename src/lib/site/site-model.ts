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
};

export type SitePage = {
  id: string;
  title: string;
  path: string;
  layout: 'page' | 'home' | 'blog' | 'tags';
  description?: string;
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

/** Join a path prefix with a slug, treating '' and '/' as the same (root) prefix. */
function joinPath(prefix: string, slug: string): string {
  if (prefix === '' || prefix === '/') return `/${slug}`;
  return `${prefix}/${slug}`;
}

function itemPosition(item: Item): number | null {
  return (item.kind === 'folder' ? item.folder.position : item.note.position) ?? null;
}

function itemLabel(item: Item): string {
  return item.kind === 'folder' ? item.folder.name : item.note.title;
}

function itemId(item: Item): string {
  return item.kind === 'folder' ? item.folder.id : item.note.id;
}

/**
 * Merge already-position-sorted folders and notes of one sibling group into
 * a single deterministic "tree order": position ascending first (null
 * positions last), then label (`name`/`title`) via
 * `localeCompare(..., 'en', { sensitivity: 'base' })`, then folders before
 * notes, then `id` as a final tie-break.
 */
function mergeByPosition(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const pa = itemPosition(a);
    const pb = itemPosition(b);
    if (pa !== null && pb !== null) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    const cmp = itemLabel(a).localeCompare(itemLabel(b), 'en', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return itemId(a).localeCompare(itemId(b));
  });
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

  function orderedChildren(parentId: string): Item[] {
    const childFolders = displayOrderFolders(foldersByParent.get(parentId) ?? [], 'en');
    const childNotes = displayOrderNotes(notesByFolder.get(parentId) ?? [], 'en');
    const items: Item[] = [
      ...childFolders.map((folder): Item => ({ kind: 'folder', folder })),
      ...childNotes.map((note): Item => ({ kind: 'note', note })),
    ];
    return mergeByPosition(items);
  }

  const used = new Map<string, number>();
  function dedupe(path: string): string {
    const count = (used.get(path) ?? 0) + 1;
    used.set(path, count);
    return count === 1 ? path : `${path}-${count}`;
  }

  function pageFrom(note: ParsedNote, path: string): SitePage {
    return {
      id: note.id,
      title: note.title,
      path,
      layout: note.fm.layout ?? 'page',
      ...(note.fm.description !== undefined ? { description: note.fm.description } : {}),
      markdown: note.markdown,
    };
  }

  function buildFromItems(items: Item[], pathPrefix: string, isHomeLevel: boolean): { pages: SitePage[]; menu: MenuItem[] } {
    const pages: SitePage[] = [];
    const menu: MenuItem[] = [];

    items.forEach((item, index) => {
      const isHomeItem = isHomeLevel && index === 0;

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

      const directNotes = displayOrderNotes(notesByFolder.get(folder.id) ?? [], 'en');
      const indexNote = directNotes.find((n) => n.fm.slug === 'index');
      const landing = indexNote ?? directNotes[0];

      const childItems = orderedChildren(folder.id).filter(
        (it) => !(landing && it.kind === 'note' && it.note.id === landing.id),
      );

      if (!landing) {
        // No direct publishable note: folder contributes no page of its
        // own. Recurse so non-empty subfolders still surface, nested under
        // this folder's path prefix. A folder with neither a direct note
        // nor any publishable descendant is fully omitted (nothing pushed).
        const sub = buildFromItems(childItems, folderPathPrefix, false);
        pages.push(...sub.pages);
        menu.push(...sub.menu);
        return;
      }

      const landingRawPath = isHomeItem ? '/' : folderPathPrefix;
      const landingPath = dedupe(landingRawPath);
      pages.push(pageFrom(landing, landingPath));

      const sub = buildFromItems(childItems, folderPathPrefix, false);
      pages.push(...sub.pages);

      if (landing.fm.menu !== false) {
        menu.push({ title: folder.name, path: landingPath, children: sub.menu });
      } else {
        // Landing explicitly hidden from the menu: don't add a folder group
        // entry, but its submenu entries (if any) still surface at the top
        // of this level rather than being silently dropped.
        menu.push(...sub.menu);
      }
    });

    return { pages, menu };
  }

  const { pages, menu } = buildFromItems(orderedChildren(siteFolderId), '', true);
  return { pages, menu };
}
