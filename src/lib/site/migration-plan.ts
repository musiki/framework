// Pure planning for the one-time Task 7 site-pages migration
// (scripts/migrate-site-pages.mjs): turns a so-web `site-migration.json`
// manifest into an ordered list of create/skip operations against the
// current state of the space's `Site` folder tree.
//
// No astro/db imports — usable from plain `node --test` runs and from the
// migration script alike.

import { slugify } from './frontmatter.ts';

export type ManifestFolderItem = {
  kind: 'folder';
  /** Folder name as it will appear in the Site tree (and, if it becomes a
   * menu group, as the menu label). */
  title: string;
  /** Parent folder title, or null for a Site-root folder. Every non-null
   * parent must reference a folder item earlier in `items`. */
  parent: string | null;
};

export type ManifestNoteItem = {
  kind: 'note';
  /** Note title (`LiveClassNote.title`). */
  title: string;
  /** Title of the folder this note lives in — must reference a folder item
   * earlier in `items`. Site-root notes are not used by this migration
   * (every top-level section is a folder; see task-7-report.md), but the
   * type allows it for completeness. */
  parent: string;
  /** Site frontmatter (slug/menu/layout/draft/description) merged into the
   * note body ahead of the markdown. */
  frontmatter: Record<string, unknown>;
  /** Path to the markdown body file, relative to the manifest's own
   * directory (`scripts/site-migration/` in so-web). */
  markdownFile: string;
};

export type ManifestItem = ManifestFolderItem | ManifestNoteItem;

export type Manifest = { items: ManifestItem[] };

/** The subset of current-tree shape the planner needs to detect what
 * already exists — deliberately not `SpaceTreeFolder`/`SpaceTreeNote`
 * (no ids, visibility, etc.) so the migration script can build it cheaply
 * from a raw folder/note listing. */
export type ExistingFolder = { name: string; parentName: string | null };
export type ExistingNote = { folderName: string; slug: string };
export type ExistingTree = { folders: ExistingFolder[]; notes: ExistingNote[] };

export type CreateFolderStep = { action: 'create-folder'; title: string; parent: string | null };
export type SkipFolderStep = { action: 'skip-folder'; title: string; parent: string | null; reason: string };
export type CreateNoteStep = {
  action: 'create-note';
  title: string;
  parent: string;
  slug: string;
  frontmatter: Record<string, unknown>;
  markdownFile: string;
};
export type SkipNoteStep = { action: 'skip-note'; title: string; parent: string; slug: string; reason: string };

export type PlanStep = CreateFolderStep | SkipFolderStep | CreateNoteStep | SkipNoteStep;

/** The note's effective slug: its frontmatter `slug` when set, else the
 * slugified title — the same rule `buildSiteModel` uses. */
export function noteSlug(item: ManifestNoteItem): string {
  const raw = item.frontmatter?.slug;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : slugify(item.title);
}

const folderKey = (parentName: string | null, title: string) => `${parentName ?? ''}\u0000${title}`;
const noteKey = (folderName: string, slug: string) => `${folderName}\u0000${slug}`;

/**
 * Turns `manifest.items` (in manifest order — folders before the notes
 * they contain, matching the tree's own folders-first display order) into
 * an ordered list of steps: `create-folder`/`create-note` for anything not
 * already present under Site, `skip-folder`/`skip-note` for anything that
 * is (idempotency, compared by name/slug path — never by id, since a
 * re-run has no ids from the previous run to compare against).
 *
 * A folder created earlier in this same plan (not yet in `existing`)
 * becomes creatable-into immediately: notes naming it as `parent` are
 * planned as children of the about-to-be-created folder, not rejected for
 * "unknown parent".
 */
export function planMigration(manifest: Manifest, existing: ExistingTree): PlanStep[] {
  const knownFolders = new Set(existing.folders.map((f) => folderKey(f.parentName, f.name)));
  const knownNotes = new Set(existing.notes.map((n) => noteKey(n.folderName, n.slug)));
  const steps: PlanStep[] = [];

  for (const item of manifest.items) {
    if (item.kind === 'folder') {
      const key = folderKey(item.parent, item.title);
      if (knownFolders.has(key)) {
        steps.push({ action: 'skip-folder', title: item.title, parent: item.parent, reason: 'folder already exists' });
      } else {
        steps.push({ action: 'create-folder', title: item.title, parent: item.parent });
        knownFolders.add(key);
      }
      continue;
    }

    const slug = noteSlug(item);
    const key = noteKey(item.parent, slug);
    if (knownNotes.has(key)) {
      steps.push({ action: 'skip-note', title: item.title, parent: item.parent, slug, reason: 'note already exists at this slug' });
    } else {
      steps.push({
        action: 'create-note',
        title: item.title,
        parent: item.parent,
        slug,
        frontmatter: item.frontmatter,
        markdownFile: item.markdownFile,
      });
      knownNotes.add(key);
    }
  }

  return steps;
}
