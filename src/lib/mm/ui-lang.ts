// UI language of the mm tenant: English (source) or Norsk bokmål. Nynorsk
// and the generic Norwegian tags fall back to Bokmål. The choice is kept in
// the `mm-lang` cookie (the only non-auth cookie mm sets). Pure: no astro
// imports; `applyMmLang` takes the Astro global structurally.

export type MmLang = 'en' | 'nb';
export const MM_LANGS: readonly MmLang[] = ['en', 'nb'];
export const MM_LANG_COOKIE = 'mm-lang';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Maps a language tag to an mm UI language, or null when it is not one. */
export function normalizeMmLang(value: string | null | undefined): MmLang | null {
  const tag = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (tag === 'en') return 'en';
  if (tag === 'nb' || tag === 'nn' || tag === 'no') return 'nb';
  return null;
}

/** First supported language in an Accept-Language header, by q order. */
export function langFromAcceptLanguage(header: string | null | undefined): MmLang | null {
  const ranked = String(header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const lang = normalizeMmLang(entry.tag);
    if (lang) return lang;
  }
  return null;
}

/**
 * Explicit choice (`?lang=`) wins and is persisted; then the cookie; then the
 * browser's Accept-Language; English by default.
 */
export function resolveMmLang(input: {
  query?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): { lang: MmLang; persist: boolean } {
  const chosen = normalizeMmLang(input.query);
  if (chosen) return { lang: chosen, persist: true };
  const stored = normalizeMmLang(input.cookie);
  if (stored) return { lang: stored, persist: false };
  return { lang: langFromAcceptLanguage(input.acceptLanguage) ?? 'en', persist: false };
}

type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
};

type AstroLike = {
  url: URL;
  request: Request;
  cookies: CookieJar;
  response: { headers: Headers };
};

/** Resolves the language for a page request; call from page frontmatter (cookies must be set before streaming). */
export function applyMmLang(astro: AstroLike): MmLang {
  const { lang, persist } = resolveMmLang({
    query: astro.url.searchParams.get('lang'),
    cookie: astro.cookies.get(MM_LANG_COOKIE)?.value,
    acceptLanguage: astro.request.headers.get('accept-language'),
  });
  if (persist) {
    const proto = astro.request.headers.get('x-forwarded-proto') ?? astro.url.protocol.replace(':', '');
    astro.cookies.set(MM_LANG_COOKIE, lang, {
      path: '/',
      maxAge: ONE_YEAR_S,
      sameSite: 'lax',
      httpOnly: true,
      secure: proto === 'https',
    });
  }
  astro.response.headers.append('Vary', 'Cookie, Accept-Language');
  return lang;
}

/**
 * href that switches the current public page to `lang`. Always same-origin:
 * duplicate slashes are collapsed so a path like `//host` (served by the 404
 * page) can never become a protocol-relative link.
 */
export function langSwitchHref(publicPath: string | null | undefined, lang: MmLang): string {
  const raw = String(publicPath ?? '');
  const path = raw.startsWith('/') ? raw.replace(/[\\/]{2,}/g, '/').replace(/\\/g, '/') : '/';
  return `${path}?lang=${lang}`;
}
