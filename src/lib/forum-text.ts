// Pure string helpers shared by the musiki forum routes (re-exported from
// forum-server.ts) and the pure forum query module (forum-queries.ts).
// No astro/db imports so node --test can load it.

function clampLength(value: string, maxLength: number): string {
  if (maxLength <= 0) return value;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

export function cleanString(value: unknown, maxLength = 0): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return maxLength > 0 ? clampLength(s, maxLength) : s;
}

export function cleanBody(value: unknown, maxLength = 0): string {
  const s = typeof value === 'string' ? value : '';
  return maxLength > 0 ? clampLength(s, maxLength) : s;
}
