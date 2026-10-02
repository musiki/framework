// Order of a board's thread list (/<group>, /<group>/<channel>): by date
// (pinned first, then latest activity — the order listThreads returns) or by
// type (concepts, relations, posts; date order kept inside each group).
// A GET parameter (?threads=type), so it works without JS. Pure module.

export const THREAD_ORDERS = ['date', 'type'] as const;
export type ThreadOrder = (typeof THREAD_ORDERS)[number];

export const THREAD_KIND_ORDER = ['concept', 'relation', 'post'] as const;
export type ThreadListKind = (typeof THREAD_KIND_ORDER)[number];

export function parseThreadOrder(params: URLSearchParams): ThreadOrder {
  return params.get('threads') === 'type' ? 'type' : 'date';
}

/** Href for an order, keeping the other query parameters (e.g. ?lang). */
export function threadOrderLink(params: URLSearchParams, order: ThreadOrder): string {
  const next = new URLSearchParams(params);
  if (order === 'date') next.delete('threads');
  else next.set('threads', order);
  const s = next.toString();
  return `${s ? `?${s}` : '?'}#mm-threads`;
}

/** Groups in concept → relation → post order, empty groups left out, input order kept within. */
export function groupThreadsByKind<T extends { kind: ThreadListKind }>(threads: readonly T[]): Array<{ kind: ThreadListKind; threads: T[] }> {
  return THREAD_KIND_ORDER
    .map((kind) => ({ kind, threads: threads.filter((th) => th.kind === kind) }))
    .filter((g) => g.threads.length > 0);
}
