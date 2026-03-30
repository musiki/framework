const LOOPBACK_HOST_RE = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i;

const ensureProtocol = (value: string) =>
  value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;

export const normalizeOriginCandidate = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';

  try {
    return new URL(ensureProtocol(text)).origin;
  } catch {
    return '';
  }
};

export const isLoopbackOrigin = (value: unknown): boolean => {
  const origin = normalizeOriginCandidate(value);
  if (!origin) return false;

  try {
    return LOOPBACK_HOST_RE.test(new URL(origin).hostname);
  } catch {
    return false;
  }
};

export const resolveConfiguredAuthOrigin = (): string =>
  normalizeOriginCandidate(
    process.env.AUTH_URL ||
      process.env.NEXTAUTH_URL ||
      process.env.SITE_URL ||
      import.meta.env?.AUTH_URL ||
      import.meta.env?.NEXTAUTH_URL ||
      import.meta.env?.SITE_URL,
  );

export const resolveAuthBaseOrigin = (baseUrl?: string): string => {
  const isDev =
    process.env.NODE_ENV === 'development' ||
    (typeof import.meta.env !== 'undefined' && Boolean(import.meta.env.DEV));

  const configuredOrigin = resolveConfiguredAuthOrigin();
  const detectedBaseOrigin = normalizeOriginCandidate(baseUrl);
  const configuredNonLoopbackOrigin =
    configuredOrigin && !isLoopbackOrigin(configuredOrigin) ? configuredOrigin : '';
  const detectedNonLoopbackOrigin =
    detectedBaseOrigin && !isLoopbackOrigin(detectedBaseOrigin) ? detectedBaseOrigin : '';

  if (detectedNonLoopbackOrigin) return detectedNonLoopbackOrigin;
  if (configuredNonLoopbackOrigin) return configuredNonLoopbackOrigin;
  if (detectedBaseOrigin) return detectedBaseOrigin;
  if (configuredOrigin) return configuredOrigin;
  if (isDev) return 'http://localhost:4321';

  return 'https://musiki.org.ar';
};

export const resolveRequestAuthOrigin = (request: Request): string => {
  const requestUrlOrigin = normalizeOriginCandidate(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const forwardedProto =
    request.headers.get('x-forwarded-proto') ||
    (requestUrlOrigin ? new URL(requestUrlOrigin).protocol.replace(/:$/, '') : 'https');
  const forwardedOrigin = forwardedHost
    ? normalizeOriginCandidate(`${forwardedProto}://${forwardedHost}`)
    : '';

  return resolveAuthBaseOrigin(forwardedOrigin || requestUrlOrigin);
};

export const resolveAuthRedirectUrl = ({
  baseUrl,
  fallbackPath = '/dashboard',
  url,
}: {
  baseUrl?: string;
  fallbackPath?: string;
  url: string;
}) => {
  const effectiveBase = resolveAuthBaseOrigin(baseUrl);
  const normalizedBaseUrl = normalizeOriginCandidate(baseUrl);

  try {
    if (url.startsWith('/')) {
      return `${effectiveBase}${url}`;
    }

    const parsed = new URL(url);
    if (parsed.origin === effectiveBase || (normalizedBaseUrl && parsed.origin === normalizedBaseUrl)) {
      return `${effectiveBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // fall through to fallback
  }

  return `${effectiveBase}${fallbackPath}`;
};
