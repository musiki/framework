// Pure view helpers for the mm pages (no astro/db imports; tested in
// view.test.mjs): which definition a reader sees in their language, labels,
// safe source links, dates and public paths.

import { isRootSlug } from './slugs.ts';

export type ViewLang = 'en' | 'nb' | 'nn';
type Versioned = { definition: string; lang: string };

/** Fallback chain per reader language: nn → nb → en, nb → en, en → nb (en is always required, nb only if en is somehow absent). */
const CHAIN: Record<ViewLang, ViewLang[]> = {
  en: ['en', 'nb'],
  nb: ['nb', 'en'],
  nn: ['nn', 'nb', 'en'],
};

export type DefinitionPick<V> = {
  /** The version shown, or null when the concept has no definition at all. */
  version: V | null;
  /** Language of the shown version. */
  lang: ViewLang | null;
  /**
   * True when the reader's language has no hand-written definition and the
   * English one is shown instead (the page says so visibly; never machine
   * translated). nn reading nb is the policy fallback, not "missing".
   */
  missingTranslation: boolean;
  /** Another language the reader can switch to (en ↔ nb), when it exists. */
  alternate: 'en' | 'nb' | null;
};

export function pickDefinition<V extends Versioned>(
  current: Partial<Record<string, V>>,
  readerLang: ViewLang,
): DefinitionPick<V> {
  const chain = CHAIN[readerLang] ?? CHAIN.en;
  let lang: ViewLang | null = null;
  for (const l of chain) {
    if (current[l]) {
      lang = l;
      break;
    }
  }
  const version = lang ? (current[lang] as V) : null;
  const missingTranslation = readerLang !== 'en' && lang === 'en';
  let alternate: 'en' | 'nb' | null = null;
  if (lang === 'en' && current.nb && readerLang === 'en') alternate = 'nb';
  else if ((lang === 'nb' || lang === 'nn') && current.en) alternate = 'en';
  return { version, lang, missingTranslation, alternate };
}

/** Concept label in the reader's language: the hand-written Bokmål label for nb/nn when present, else English. */
export function conceptLabel(c: { label: string; labelNb?: string | null }, readerLang: ViewLang): { text: string; lang: 'en' | 'nb' } {
  if (readerLang !== 'en' && c.labelNb && c.labelNb.trim()) return { text: c.labelNb, lang: 'nb' };
  return { text: c.label, lang: 'en' };
}

/** Only absolute http(s) URLs become links; anything else (javascript:, data:, relative) is shown as text. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const DATE_LOCALE: Record<ViewLang, string> = { en: 'en-GB', nb: 'nb-NO', nn: 'nn-NO' };

/** Short date (e.g. "29 Sep 2026" / "29. sep. 2026"); empty for invalid input. */
export function formatDate(iso: string | null | undefined, readerLang: ViewLang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(DATE_LOCALE[readerLang] ?? 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

/** UTC calendar day of an ISO date ('2026-09-29'); '' for invalid input. */
export function dayKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Versions grouped by the day they were written (UTC), in the order given
 * (history is newest first, so the groups are too). Each group carries the
 * day key (stable anchor material) and its display date.
 */
export function groupByDay<V extends { createdAt: string }>(
  versions: V[],
  readerLang: ViewLang,
): Array<{ day: string; label: string; items: V[] }> {
  const groups: Array<{ day: string; label: string; items: V[] }> = [];
  for (const v of versions) {
    const day = dayKey(v.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(v);
    else groups.push({ day, label: formatDate(v.createdAt, readerLang), items: [v] });
  }
  return groups;
}

/** /f/<group> or, with a channel, /f/<group>/<channel>. */
export const forumPath = (slug: string, channel?: string | null) =>
  `/f/${encodeURIComponent(slug)}${channel ? `/${encodeURIComponent(channel)}` : ''}`;
/** /f/<group>/t/<id> (group-level thread) or /f/<group>/<channel>/t/<id>. */
export const threadPath = (forumSlug: string, threadId: string, channel?: string | null) =>
  `${forumPath(forumSlug, channel)}/t/${encodeURIComponent(threadId)}`;

/** A board as the cores return it: a group (parent null) or a channel (parent = its group). */
export type BoardRef = { slug: string; title?: string; parent?: { slug: string; title?: string } | null };

/** Public path of a board (group or channel). */
export const boardPath = (b: BoardRef) => (b.parent ? forumPath(b.parent.slug, b.slug) : forumPath(b.slug));
/** Public path of a thread in board `b`. */
export const boardThreadPath = (b: BoardRef, threadId: string) =>
  b.parent ? threadPath(b.parent.slug, threadId, b.slug) : threadPath(b.slug, threadId);

/**
 * Whether the URL segments (/f/<group>[/<channel>]) name board `b`. A
 * group-level URL only matches a group, a channel URL only that channel of
 * that group; anything else is a 404 on the page.
 */
export function boardMatchesPath(b: BoardRef | null | undefined, group: string, channel: string | null = null): boolean {
  if (!b) return false;
  if (channel === null) return !b.parent && b.slug === group;
  return !!b.parent && b.parent.slug === group && b.slug === channel;
}

export type Crumb = { label: string; href: string | null };

/**
 * Breadcrumbs group › channel › (current page): every ancestor is a link;
 * the last crumb is the current page (href null, rendered with
 * aria-current="page").
 */
export function forumCrumbs(b: BoardRef & { title: string }, current: string | null = null): Crumb[] {
  const crumbs: Crumb[] = [];
  if (b.parent) crumbs.push({ label: b.parent.title ?? b.parent.slug, href: forumPath(b.parent.slug) });
  crumbs.push({ label: b.title, href: current === null ? null : boardPath(b) });
  if (current !== null) crumbs.push({ label: current, href: null });
  return crumbs;
}
/**
 * A concept's permalink: the root (/<slug>) when the slug can live there
 * (slugs.ts isRootSlug); older slugs that cannot (a reserved word, an odd
 * spelling) keep /c/<slug>, where the concept page is still served.
 */
export const conceptPath = (slug: string) => (isRootSlug(slug) ? `/${slug}` : `/c/${encodeURIComponent(slug)}`);

/**
 * Where an old URL of an item's discussion thread goes: the item's page
 * (`path`, a same-origin path built from a validated slug) with the request's
 * query kept and from=thread added (no fragment).
 */
export function threadRedirect(path: string, search = ''): string {
  const params = new URLSearchParams(search);
  params.set('from', 'thread');
  return `${path}?${params.toString()}`;
}

/** The concept page for an old URL of its discussion thread (threadRedirect). */
export const conceptThreadRedirect = (slug: string, search = '') => threadRedirect(conceptPath(slug), search);

/**
 * A user's name as it may appear publicly: trimmed, and never anything that
 * looks like an e-mail address (musiki fills User.name from sign-in profiles;
 * a name containing '@' is treated as no name). Null when unusable.
 */
export function publicName(name: unknown): string | null {
  const s = typeof name === 'string' ? name.trim() : '';
  return s && !s.includes('@') ? s : null;
}

/**
 * Display name for a user reference: deleted users get `deletedLabel`
 * ("Former member"); living users without a usable name get `unnamedLabel`
 * ("Member", defaults to `deletedLabel` for older callers).
 */
export function displayName(
  ref: { name: string | null; deleted: boolean } | null | undefined,
  deletedLabel: string,
  unnamedLabel: string = deletedLabel,
): string {
  if (!ref || ref.deleted) return deletedLabel;
  return publicName(ref.name) ?? unnamedLabel;
}

/**
 * Page state for an error thrown while loading data: a domain 404 from a core
 * (e.g. the forum was archived between two reads) is "not found"; anything
 * else (database down, space not seeded) is "unavailable".
 */
export function pageErrorState(err: unknown): 'notFound' | 'unavailable' {
  const e = err as { name?: unknown; status?: unknown } | null;
  const domain = e?.name === 'ForumError' || e?.name === 'ConceptError' || e?.name === 'MmApiError';
  return domain && e?.status === 404 ? 'notFound' : 'unavailable';
}

/**
 * Plain-text excerpt of a markdown definition (meta descriptions, lists):
 * code/LilyPond fences and HTML dropped, math delimiters, link/image/wiki
 * syntax and emphasis markers removed, whitespace collapsed, at most `max`
 * characters (cut at a word boundary, with an ellipsis). Text only: callers
 * must still escape it (Astro does).
 */
export function definitionExcerpt(markdown: unknown, max = 200): string {
  let s = typeof markdown === 'string' ? markdown : '';
  s = s
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|$)/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^ {0,3}(#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
