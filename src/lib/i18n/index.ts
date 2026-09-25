import type { Locale } from '../tenant/tenants.ts';
import { en, type Dict } from './en.ts';
import { es } from './es.ts';

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Dict>;
export type { Dict };

// fr is added when hem joins (sub-project 4); until then it falls back to en.
const DICTS: Partial<Record<Locale, Dict>> = { en, es };

function lookup(dict: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    dict,
  );
  return typeof value === 'string' ? value : undefined;
}

export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = lookup(DICTS[locale], key) ?? lookup(en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
