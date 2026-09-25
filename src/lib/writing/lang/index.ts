import { es } from './es.ts';
import { en } from './en.ts';

export type ContentLang = 'es' | 'en';
export type LangPack = { lang: ContentLang; stopwords: ReadonlySet<string>; connectors: readonly string[] };

export function normalizeContentLang(value: unknown): ContentLang {
  return value === 'en' ? 'en' : 'es';
}

export function getLangPack(lang: ContentLang): LangPack {
  return lang === 'en' ? en : es;
}

// Spanish writing routinely quotes English, so the es tracer set keeps both
// (this is exactly the list musiki used before). English text uses English only.
const ES_TRACE_STOPWORDS: ReadonlySet<string> = new Set([...es.stopwords, ...en.stopwords]);

export function traceStopwords(lang: ContentLang): ReadonlySet<string> {
  return lang === 'en' ? en.stopwords : ES_TRACE_STOPWORDS;
}
