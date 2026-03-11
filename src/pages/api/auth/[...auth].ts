import { Auth } from "@auth/core";
import type { APIContext } from "astro";
import { parseString } from "set-cookie-parser";
import authConfig from "../../../../auth.config";

export const prerender = false;

const LOCALHOST_HOST_RE = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i;

function normalizeUrl(value?: string): URL | undefined {
  if (!value) return undefined;
  const withProtocol =
    value.startsWith("http://") || value.startsWith("https://")
      ? value
      : `https://${value}`;

  try {
    return new URL(withProtocol);
  } catch {
    return undefined;
  }
}

function getFallbackOrigin(): string | undefined {
  const vercelUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;

  const candidates = [
    process.env.SITE_URL,
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    vercelUrl,
  ];

  for (const candidate of candidates) {
    const parsed = normalizeUrl(candidate);
    if (!parsed) continue;
    if (LOCALHOST_HOST_RE.test(parsed.hostname)) continue;
    return parsed.origin;
  }
}

function rewriteAuthRequestUrl(request: Request): URL {
  const incoming = new URL(request.url);
  if (!LOCALHOST_HOST_RE.test(incoming.hostname)) return incoming;

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = (forwardedProto?.split(",")[0].trim() || "https").replace(
      /:$/,
      ""
    );
    return new URL(`${proto}://${host}${incoming.pathname}${incoming.search}`);
  }

  const fallbackOrigin = getFallbackOrigin();
  if (fallbackOrigin) {
    return new URL(`${fallbackOrigin}${incoming.pathname}${incoming.search}`);
  }

  return incoming;
}

function syncAuthOriginEnv(requestUrl: URL) {
  if (LOCALHOST_HOST_RE.test(requestUrl.hostname)) return;

  const runtimeAuthUrl = normalizeUrl(process.env.AUTH_URL);
  if (!runtimeAuthUrl || LOCALHOST_HOST_RE.test(runtimeAuthUrl.hostname)) {
    process.env.AUTH_URL = requestUrl.origin;
  }

  const runtimeNextAuthUrl = normalizeUrl(process.env.NEXTAUTH_URL);
  if (!runtimeNextAuthUrl || LOCALHOST_HOST_RE.test(runtimeNextAuthUrl.hostname)) {
    process.env.NEXTAUTH_URL = requestUrl.origin;
  }
}

function getAuthAction(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(`${prefix}/`)) return undefined;
  return pathname.slice(prefix.length + 1).split("/")[0];
}

function syncSetCookieHeaders(response: Response, context: APIContext) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return;

  for (const rawCookie of setCookies) {
    const { name, value, ...options } = parseString(rawCookie);
    context.cookies.set(
      name,
      value,
      options as Parameters<APIContext["cookies"]["set"]>[2]
    );
  }

  response.headers.delete("Set-Cookie");
}

async function handleAuth(context: APIContext) {
  const requestUrl = rewriteAuthRequestUrl(context.request);
  syncAuthOriginEnv(requestUrl);
  const request =
    requestUrl.toString() === context.request.url
      ? context.request
      : new Request(requestUrl, context.request);

  const prefix = authConfig.prefix ?? "/api/auth";
  const action = getAuthAction(requestUrl.pathname, prefix);
  if (!action) return new Response("Not Found", { status: 404 });

  const { prefix: _prefix, ...options } = authConfig;
  const response = await Auth(request, options);

  if (action === "signin" || action === "signout" || action === "callback") {
    syncSetCookieHeaders(response, context);
  }

  return response;
}

export async function GET(context: APIContext) {
  return handleAuth(context);
}

export async function POST(context: APIContext) {
  return handleAuth(context);
}
