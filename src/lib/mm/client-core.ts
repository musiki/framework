// Pure helpers shared by the mm client scripts (src/scripts/mm/*): `@citekey`
// detection and `[@citekey]` insertion in the composer and API error → message mapping.
// No DOM, no fetch: tested in client-core.test.mjs.

/** Characters Seshat citekeys use after the `@` (remark-seshat-citations style). */
const CITEKEY_CHAR = /[A-Za-z0-9_:.#$%&+?<>~/-]/;
const MAX_QUERY = 60;

/**
 * If the caret is right after `@partial` (the `@` at the start or after
 * whitespace/opening punctuation), returns the partial key and where the `@`
 * is; otherwise null. An empty partial (just `@`) is returned too, so the
 * caller can decide to wait for more characters.
 */
export function findCitekeyQuery(text: string, caret: number): { start: number; query: string } | null {
  if (typeof text !== 'string' || caret < 1 || caret > text.length) return null;
  let i = caret;
  while (i > 0 && CITEKEY_CHAR.test(text[i - 1]) && caret - i <= MAX_QUERY) i -= 1;
  if (i < 1 || text[i - 1] !== '@') return null;
  const at = i - 1;
  if (at > 0 && !/[\s([{;,"'“]/.test(text[at - 1])) return null; // e-mail addresses, foo@bar
  const query = text.slice(i, caret);
  if (query.length > MAX_QUERY) return null;
  return { start: at, query };
}

/**
 * Replaces `@partial` (from `start` to `caret`) with `[@citekey] ` — the
 * bracketed form the renderer (remark-seshat-citations) resolves — and
 * returns the new text and caret. An opening `[` typed before the `@` and a
 * closing `]` right after the caret are absorbed, so `[@sti]` does not become
 * `[[@key]]]`.
 */
export function insertCitekey(text: string, start: number, caret: number, citekey: string): { text: string; caret: number } {
  const from = start > 0 && text[start - 1] === '[' ? start - 1 : start;
  let after = text.slice(caret);
  if (after.startsWith(']')) after = after.slice(1);
  const insert = `[@${citekey}]`;
  const spacer = after === '' || /^[\s.,;:!?)\]]/.test(after) ? (after === '' ? ' ' : '') : ' ';
  const next = text.slice(0, from) + insert + spacer + after;
  return { text: next, caret: from + insert.length + spacer.length };
}

export type ApiErrorKind = 'rateLimited' | 'signIn' | 'forbidden' | 'notFound' | 'conflict' | 'invalid' | 'generic';

/** Maps an API status to the kind of message the UI shows (429 gets its own gentle message). */
export function apiErrorKind(status: number): ApiErrorKind {
  if (status === 429) return 'rateLimited';
  if (status === 401) return 'signIn';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'invalid';
  return 'generic';
}

/**
 * Message for a failed call: validation (400) and conflict (409) messages
 * from the API are short, domain-level English strings and are shown after
 * the localized lead; everything else uses the localized message only.
 */
export function apiErrorMessage(
  status: number,
  apiMessage: unknown,
  strings: Record<ApiErrorKind, string>,
): string {
  const kind = apiErrorKind(status);
  const lead = strings[kind] ?? strings.generic;
  const detail = typeof apiMessage === 'string' ? apiMessage.trim().slice(0, 200) : '';
  if ((kind === 'invalid' || kind === 'conflict') && detail) return `${lead} (${detail})`;
  return lead;
}

export type SlugErrorKind = 'taken' | 'forum' | 'reserved' | 'format' | 'length' | 'required';

/**
 * Concept slug forms (propose, rename): the API's slug errors (concepts-core
 * cleanCustomSlug / 409 'concept slug already exists' / 409 'concept slug is
 * a forum address') get their own localized message instead of the generic
 * lead; null for anything else.
 */
export function slugErrorKind(status: number, apiMessage: unknown): SlugErrorKind | null {
  if (typeof apiMessage !== 'string') return null;
  if (status === 409) return /slug already exists/i.test(apiMessage) ? 'taken' : /forum address/i.test(apiMessage) ? 'forum' : null;
  if (status !== 400 || !/slug/i.test(apiMessage)) return null;
  if (/reserved word/i.test(apiMessage)) return 'reserved';
  if (/characters/i.test(apiMessage) && /\d+.\d+/.test(apiMessage)) return 'length';
  if (/lowercase letters/i.test(apiMessage)) return 'format';
  if (/slug required/i.test(apiMessage)) return 'required';
  return null;
}

export type AdminErrorKind = 'lastAdmin' | 'self' | 'slugTaken' | 'slugConcept' | 'slugReserved';

/**
 * Admin page: the 409s the admin APIs return for a reason the admin can act
 * on (src/lib/mm/admin-core.ts, forum-core.ts createForum) get their own
 * localized message instead of the generic "changed in the meantime".
 */
export function adminErrorKind(status: number, apiMessage: unknown): AdminErrorKind | null {
  if (typeof apiMessage !== 'string') return null;
  // A forum group's address is a root slug (forum-core createForum): never a reserved word.
  if (status === 400) return /reserved word/i.test(apiMessage) && /forum address/i.test(apiMessage) ? 'slugReserved' : null;
  if (status !== 409) return null;
  if (/used by a concept/i.test(apiMessage)) return 'slugConcept';
  if (/at least one admin/i.test(apiMessage)) return 'lastAdmin';
  if (/your own membership/i.test(apiMessage)) return 'self';
  if (/slug already exists/i.test(apiMessage)) return 'slugTaken';
  return null;
}

export type PickerLibrary = { id: string; name: string; path: string; items: number };
export type PickerOption = { value: string; label: string; selected: boolean };

/**
 * Options for the admin's Seshat library <select>: a "no library" entry, one
 * entry per library labelled from `strings.option` ({path}, {count}), and —
 * when the forum is linked to an id that is not in the list — that id kept
 * as a selected entry so saving never silently unlinks it.
 */
export function libraryPickerOptions(
  libraries: PickerLibrary[],
  currentId: string | null | undefined,
  strings: { none: string; option: string; unknown: string },
): PickerOption[] {
  const current = typeof currentId === 'string' ? currentId.trim() : '';
  const fill = (template: string, vars: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  const out: PickerOption[] = [{ value: '', label: strings.none, selected: !current }];
  let found = false;
  for (const lib of Array.isArray(libraries) ? libraries : []) {
    if (!lib || typeof lib.id !== 'string' || !lib.id) continue;
    const selected = lib.id === current;
    if (selected) found = true;
    out.push({ value: lib.id, label: fill(strings.option, { path: lib.path || lib.name || lib.id, count: Number(lib.items) || 0 }), selected });
  }
  if (current && !found) out.push({ value: current, label: fill(strings.unknown, { id: current }), selected: true });
  return out;
}
