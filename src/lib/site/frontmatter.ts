// Pure frontmatter parsing + slugify for the site model.
//
// No astro/db imports — usable from plain `node --test` runs and from the
// so studio server code alike.

import matter from 'gray-matter';

export type SiteFrontmatter = {
  slug?: string;
  menu?: boolean;
  layout?: 'page' | 'home' | 'blog' | 'tags';
  draft?: boolean;
  description?: string;
};

const ALLOWED_LAYOUTS = new Set(['page', 'home', 'blog', 'tags']);

/**
 * Parse the leading `---`-delimited YAML frontmatter block from `markdown`.
 * Returns the validated, known frontmatter keys plus the markdown body with
 * the frontmatter block stripped. Unknown keys are ignored; known keys with
 * an invalid type/value are dropped (not coerced) rather than throwing.
 */
export function parseFrontmatter(markdown: string): { data: SiteFrontmatter; body: string } {
  let parsed: { data: Record<string, unknown>; content: string };
  try {
    parsed = matter(markdown);
  } catch {
    // Malformed YAML: treat as no frontmatter at all.
    return { data: {}, body: markdown };
  }

  const raw = parsed.data ?? {};
  const data: SiteFrontmatter = {};

  if (typeof raw.slug === 'string') {
    const slug = sanitizeSlug(raw.slug);
    if (slug !== undefined) data.slug = slug;
  }
  if (typeof raw.menu === 'boolean') {
    data.menu = raw.menu;
  }
  if (typeof raw.layout === 'string' && ALLOWED_LAYOUTS.has(raw.layout)) {
    data.layout = raw.layout as SiteFrontmatter['layout'];
  }
  if (typeof raw.draft === 'boolean') {
    data.draft = raw.draft;
  } else if (typeof raw.draft === 'string') {
    // `draft: "true"` (quoted) is a common authoring slip; treating it as
    // "not a draft" would publish the note. Accept the obvious truthy
    // spellings; anything else leaves the note published as before.
    const v = raw.draft.trim().toLowerCase();
    if (v === 'true' || v === 'yes') data.draft = true;
  }
  if (typeof raw.description === 'string') {
    data.description = raw.description;
  }

  return { data, body: parsed.content };
}

/**
 * Sanitize a frontmatter `slug:` value into a single safe path segment.
 * Strips leading/trailing `/`, rejects anything containing `..`, then runs
 * the result through the same slugify rules as titles (so whitespace,
 * inner slashes and punctuation collapse to `-`). Returns `undefined`
 * (slug ignored, title-derived slug used instead) when nothing usable is
 * left.
 */
export function sanitizeSlug(value: string): string | undefined {
  const stripped = value.trim().replace(/^\/+|\/+$/g, '');
  if (stripped === '' || stripped.includes('..')) return undefined;
  const slug = slugifyRaw(stripped);
  return slug === '' ? undefined : slug;
}

function slugifyRaw(title: string): string {
  const normalized = (title ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slugify a title: lowercase, NFKD-normalize and strip diacritics, replace
 * runs of non-alphanumeric characters with `-`, trim leading/trailing `-`.
 * Falls back to `'page'` when the result would be empty.
 */
export function slugify(title: string): string {
  return slugifyRaw(title) || 'page';
}
