const KNOWN_ENDPOINTS = ['/api/correct', '/api/models', '/health'];

export function buildCorrectionApiUrl(baseUrl: unknown, endpoint: string): string {
  const base = String(baseUrl ?? '').trim();
  const target = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!base) return '';

  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/, '');
  const configuredEndpoint = KNOWN_ENDPOINTS.find((candidate) => pathname.endsWith(candidate));
  const basePath = configuredEndpoint
    ? pathname.slice(0, -configuredEndpoint.length)
    : pathname;

  url.pathname = `${basePath}${target}`.replace(/\/{2,}/g, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
}
