// Pure helpers shared by the mm client scripts (src/scripts/mm/*): `@citekey`
// detection/insertion in the composer and API error → message mapping.
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

/** Replaces `@partial` (from `start` to `caret`) with `@citekey ` and returns the new text and caret. */
export function insertCitekey(text: string, start: number, caret: number, citekey: string): { text: string; caret: number } {
  const insert = `@${citekey}`;
  const after = text.slice(caret);
  const spacer = after.startsWith(' ') || after.startsWith('\n') ? '' : ' ';
  const next = text.slice(0, start) + insert + spacer + after;
  return { text: next, caret: start + insert.length + spacer.length };
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
