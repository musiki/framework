import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

type CitationSearchItem = {
  id: string;
  citeKey: string;
  type: string;
  title: string;
  authors: string[];
  year: number | null;
};

type CitationSearchResponse = { items?: CitationSearchItem[] };

const cache = new Map<string, { expires: number; items: CitationSearchItem[] }>();

const searchCitations = async (query: string, signal: AbortSignal): Promise<CitationSearchItem[]> => {
  const key = query.trim().toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.items;

  const params = new URLSearchParams({ q: query, limit: '20' });
  const response = await fetch(`/api/seshat/citations?${params}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return [];
  const payload = await response.json() as CitationSearchResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];
  cache.set(key, { expires: Date.now() + 15_000, items });
  return items;
};

const citationText = (view: EditorView, from: number, to: number, citeKey: string): string => {
  const before = view.state.doc.sliceString(Math.max(0, from - 500), from);
  const after = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + 500));
  const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
  const lineAfter = after.split('\n', 1)[0] || '';
  const insideCitation = lineBefore.lastIndexOf('[') > lineBefore.lastIndexOf(']');
  if (!insideCitation) return `[@${citeKey}]`;
  return `@${citeKey}${lineAfter.includes(']') ? '' : ']'}`;
};

const citationCompletion = (item: CitationSearchItem): Completion => ({
  label: `@${item.citeKey}`,
  displayLabel: item.title || `@${item.citeKey}`,
  detail: [item.authors?.[0], item.year].filter(Boolean).join(' · '),
  type: 'text',
  boost: 10,
  info: () => {
    const node = document.createElement('div');
    node.className = 'seshat-citation-info';
    const key = document.createElement('strong');
    key.textContent = `@${item.citeKey}`;
    const meta = document.createElement('span');
    meta.textContent = [item.authors?.join('; '), item.year, item.type].filter(Boolean).join(' · ');
    node.append(key, meta);
    return node;
  },
  apply(view, _completion, from, to) {
    const insert = citationText(view, from, to, item.citeKey);
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
  },
});

const seshatCitationSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
  const match = context.matchBefore(/@[\p{L}\p{N}:_-]*/u);
  if (!match) return null;
  const preceding = context.state.doc.sliceString(Math.max(0, match.from - 1), match.from);
  if (/[\p{L}\p{N}._%+-]/u.test(preceding)) return null;

  const controller = new AbortController();
  context.addEventListener('abort', () => controller.abort(), { onDocChange: true });
  const items = await searchCitations(match.text.slice(1), controller.signal).catch(() => []);
  return {
    from: match.from,
    options: items.map(citationCompletion),
    validFor: /^@[\p{L}\p{N}:_-]*$/u,
    filter: false,
  };
};

export const seshatCitationAutocomplete = () => autocompletion({
  override: [seshatCitationSource],
  activateOnTyping: true,
  maxRenderedOptions: 20,
  optionClass: () => 'seshat-citation-option',
});
