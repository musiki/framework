// Localized strings the mm pages hand to their client scripts
// (<div data-mm-i18n={clientStrings(lang, {...})}>, read by
// src/scripts/mm/api.ts pageStrings()). Serialized into an attribute, so
// Astro escapes it; never injected as HTML.

import { t } from '../i18n';
import type { MmLang } from './ui-lang';

export function clientStrings(lang: MmLang, extra: Record<string, string> = {}): string {
  return JSON.stringify({
    'error.rateLimited': t(lang, 'mm.common.errors.rateLimited'),
    'error.signIn': t(lang, 'mm.common.errors.signIn'),
    'error.forbidden': t(lang, 'mm.common.errors.forbidden'),
    'error.notFound': t(lang, 'mm.common.errors.notFound'),
    'error.conflict': t(lang, 'mm.common.errors.conflict'),
    'error.invalid': t(lang, 'mm.common.errors.invalid'),
    'error.generic': t(lang, 'mm.common.errors.generic'),
    'error.network': t(lang, 'mm.common.errors.network'),
    ...extra,
  });
}
