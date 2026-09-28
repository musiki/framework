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

  if (typeof raw.slug === 'string' && raw.slug.trim() !== '') {
    data.slug = raw.slug;
  }
  if (typeof raw.menu === 'boolean') {
    data.menu = raw.menu;
  }
  if (typeof raw.layout === 'string' && ALLOWED_LAYOUTS.has(raw.layout)) {
    data.layout = raw.layout as SiteFrontmatter['layout'];
  }
  if (typeof raw.draft === 'boolean') {
    data.draft = raw.draft;
  }
  if (typeof raw.description === 'string') {
    data.description = raw.description;
  }

  return { data, body: parsed.content };
}

/**
 * Slugify a title: lowercase, NFKD-normalize and strip diacritics, replace
 * runs of non-alphanumeric characters with `-`, trim leading/trailing `-`.
 * Falls back to `'page'` when the result would be empty.
 */
export function slugify(title: string): string {
  const normalized = (title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'page';
}
