import { Auth } from "@auth/core";
import type { AuthAction } from "@auth/core/types";
import type { APIContext } from "astro";
import { parseString } from "set-cookie-parser";
import authConfig from "auth:config";
import { normalizeOriginCandidate, resolveRequestAuthOrigin } from "../../../lib/auth-origin";

const actions: AuthAction[] = [
  "providers",
  "session",
  "csrf",
  "signin",
  "signout",
  "callback",
  "verify-request",
  "error",
];

const normalizeAuthRequest = (request: Request): Request => {
  const requestOrigin = resolveRequestAuthOrigin(request);
  if (!requestOrigin) return request;

  const requestUrl = new URL(request.url);
  const effectiveUrl = new URL(request.url);
  const effectiveOrigin = normalizeOriginCandidate(requestOrigin);
  if (effectiveOrigin) {
    const parsedEffectiveOrigin = new URL(effectiveOrigin);
    effectiveUrl.protocol = parsedEffectiveOrigin.protocol;
    effectiveUrl.hostname = parsedEffectiveOrigin.hostname;
    effectiveUrl.port = parsedEffectiveOrigin.port;
  }

  const headers = new Headers(request.headers);
  const forwardedProto = effectiveUrl.protocol.replace(/:$/, "");

  // Auth.js reads raw request headers to build provider URLs.
  // In this runtime, API routes can receive request.url as localhost even when forwarded headers are correct.
  headers.set("host", effectiveUrl.host);
  headers.set("x-forwarded-host", effectiveUrl.host);
  headers.set("x-forwarded-proto", forwardedProto);

  return new Request(effectiveUrl, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
  });
};

const handleAuth = async (context: APIContext) => {
  const { cookies, request } = context;
  const url = new URL(request.url);
  const prefix = authConfig.prefix || "/api/auth";
  const action = url.pathname.slice(prefix.length + 1).split("/")[0] as AuthAction;

  console.log(`[auth] ${request.method} ${url.pathname} (action: ${action})`);

  if (!actions.includes(action) || !url.pathname.startsWith(`${prefix}/`)) {
    return new Response("Not found", { status: 404 });
  }

  const normalizedRequest = normalizeAuthRequest(request);
  const response = await Auth(normalizedRequest, authConfig);

  if (["callback", "signin", "signout"].includes(action)) {
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      if (action === "callback") {
        console.log(`[auth] setting ${setCookies.length} cookies for ${action}`);
      }
      setCookies.forEach((cookie) => {
        const { name, value, ...options } = parseString(cookie);
        // We still set them in context.cookies in case Astro needs them for the current request lifecycle,
        // but we DO NOT delete them from the response headers anymore.
        cookies.set(name, value, options as Parameters<typeof cookies.set>[2]);
      });
    }
  }

  return response;
};

export const GET = handleAuth;
export const POST = handleAuth;
