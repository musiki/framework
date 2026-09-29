// mm client: JSON calls to /api/mm/* (same-origin, cookies included; the
// server checks Origin + JSON content type for CSRF) and the localized
// strings a page hands to its scripts in [data-mm-i18n].

import { apiErrorMessage, type ApiErrorKind } from '../../lib/mm/client-core.ts';

export type Strings = Record<string, string>;

let cached: Strings | null = null;

/** Strings rendered by the page (server-side t()) for its scripts. */
export function pageStrings(): Strings {
  if (cached) return cached;
  const el = document.querySelector<HTMLElement>('[data-mm-i18n]');
  try {
    cached = el?.dataset.mmI18n ? (JSON.parse(el.dataset.mmI18n) as Strings) : {};
  } catch {
    cached = {};
  }
  return cached;
}

export class ApiFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
  }
}

const ERROR_KINDS: ApiErrorKind[] = ['rateLimited', 'signIn', 'forbidden', 'notFound', 'conflict', 'invalid', 'generic'];

function errorStrings(): Record<ApiErrorKind, string> {
  const s = pageStrings();
  const out = {} as Record<ApiErrorKind, string>;
  for (const k of ERROR_KINDS) out[k] = s[`error.${k}`] || s['error.generic'] || 'Something went wrong.';
  return out;
}

export async function mmApi<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiFailure(0, pageStrings()['error.network'] || 'The connection failed.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiFailure(res.status, apiErrorMessage(res.status, data?.error, errorStrings()));
  return data as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiFailure) return err.message;
  return pageStrings()['error.generic'] || 'Something went wrong.';
}

/** Shows `message` in the page's flash region (or the given one), focusing it for screen readers. */
export function flash(message: string, region?: HTMLElement | null): void {
  const el = region ?? document.querySelector<HTMLElement>('[data-mm-flash]');
  if (!el) {
    window.alert(message);
    return;
  }
  el.textContent = message;
  el.hidden = false;
  if (!region) el.scrollIntoView({ block: 'nearest' });
}

/** Reloads the page, landing on `#hash` when given. */
export function reloadAt(hash?: string): void {
  const url = new URL(window.location.href);
  url.hash = hash ?? '';
  if (url.href === window.location.href) window.location.reload();
  else {
    window.location.assign(url.href);
    window.location.reload();
  }
}
