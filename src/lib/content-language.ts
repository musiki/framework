// Content-language blocks: a note may carry <!--lang:fr--> ... <!--/lang-->
// sections. Notes without any block are untouched (no switcher, no wrapping).

export const CONTENT_TRANSLATION_LANGS = ['fr', 'en'] as const;
export type ContentTranslationLang = (typeof CONTENT_TRANSLATION_LANGS)[number];

export const CONTENT_TRANSLATION_LABELS: Record<ContentTranslationLang, string> = {
  fr: 'FR',
  en: 'EN',
};

type TranslationCarrier = Record<string, unknown> & {
  lang?: string | null;
  language?: string | null;
  locale?: string | null;
};

export function normalizeContentLang(value: unknown): ContentTranslationLang | '' {
  const lang = String(value || '').trim().toLowerCase();
  return (CONTENT_TRANSLATION_LANGS as readonly string[]).includes(lang)
    ? (lang as ContentTranslationLang)
    : '';
}

export function getContentLanguageBlocks(body = ''): ContentTranslationLang[] {
  const found = new Set<ContentTranslationLang>();
  const matches = String(body || '').matchAll(/<!--\s*l?lang:([a-z]{2})\s*(?:-*[-→]?>|→)/gi);
  for (const match of matches) {
    const lang = normalizeContentLang(match[1]);
    if (lang) found.add(lang);
  }
  return CONTENT_TRANSLATION_LANGS.filter((lang) => found.has(lang));
}

// Language of the unmarked body: explicit frontmatter first; a note with only
// an EN block is FR-first (and vice versa); otherwise the tenant locale when it
// is a content language, else English.
export function getDefaultContentLanguage(args: {
  body?: string;
  data?: TranslationCarrier;
  fallback?: string;
}): ContentTranslationLang {
  const explicit =
    normalizeContentLang(args.data?.lang) ||
    normalizeContentLang(args.data?.language) ||
    normalizeContentLang(args.data?.locale);
  if (explicit) return explicit;

  const blockLangs = getContentLanguageBlocks(args.body || '');
  if (blockLangs.includes('en') && !blockLangs.includes('fr')) return 'fr';
  if (blockLangs.includes('fr') && !blockLangs.includes('en')) return 'en';

  return normalizeContentLang(args.fallback) || 'en';
}

export function getAvailableContentTranslationLanguages(args: {
  body?: string;
  data?: TranslationCarrier;
  fallback?: string;
}): ContentTranslationLang[] {
  const blockLangs = getContentLanguageBlocks(args.body || '');
  if (!blockLangs.length) return [];
  const available = new Set<ContentTranslationLang>([getDefaultContentLanguage(args), ...blockLangs]);
  return CONTENT_TRANSLATION_LANGS.filter((lang) => available.has(lang));
}

export function hasContentTranslations(args: { body?: string }): boolean {
  return getContentLanguageBlocks(args.body || '').length > 0;
}
