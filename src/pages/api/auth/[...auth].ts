import { Auth } from "@auth/core";
import type { AuthAction } from "@auth/core/types";
import type { APIContext } from "astro";
import { parseString } from "set-cookie-parser";
import authConfig from "auth:config";
import { resolveRequestAuthOrigin } from "../../../lib/auth-origin";

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

const handleAuth = async (context: APIContext) => {
  const { cookies, request } = context;
  
  // FIX: Force the request URL to use the correct origin for Auth.js internal logic
  const authOrigin = resolveRequestAuthOrigin(request);
  const externalOrigin = new URL(authOrigin);
  
  // Safety check: if resolveRequestAuthOrigin still returned localhost/4321, 
  // we must force the canonical domain here to stop the redirect loop.
  // IMPORTANT: Only do this in production. In development, we must allow localhost.
  const isDev = import.meta.env.DEV;
  if (!isDev && (externalOrigin.port === '4321' || externalOrigin.hostname === 'localhost' || externalOrigin.hostname === '127.0.0.1')) {
    externalOrigin.protocol = 'https:';
    externalOrigin.host = 'musiki.org.ar';
    externalOrigin.port = '';
  }

  const targetUrl = new URL(request.url);
  
  targetUrl.protocol = externalOrigin.protocol;
  targetUrl.host = externalOrigin.host;
  targetUrl.port = externalOrigin.port;

  // Clone headers and ensure 'host' matches external origin
  const headers = new Headers(request.headers);
  headers.set("host", externalOrigin.host);
  headers.set("x-forwarded-host", externalOrigin.host);
  headers.set("x-forwarded-proto", externalOrigin.protocol.slice(0, -1));

  // Reconstruct request with external URL
  const rewrittenRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: headers,
    body: request.method === 'POST' ? await request.clone().blob() : null,
    duplex: 'half',
  } as any);

  const prefix = authConfig.prefix || "/api/auth";
  const action = targetUrl.pathname.slice(prefix.length + 1).split("/")[0] as AuthAction;

  if (!actions.includes(action) || !targetUrl.pathname.startsWith(`${prefix}/`)) {
    return new Response("Not found", { status: 404 });
  }

  console.log(`[AUTH-DEBUG] Action: ${action}, External: ${externalOrigin.toString()}, Target: ${targetUrl.toString()}`);
  
  let response: Response;
  try {
    response = await Auth(rewrittenRequest, authConfig);
  } catch (err: any) {
    console.error(`[AUTH-DEBUG] Auth core threw:`, err);
    return new Response(err?.message || "Internal Auth Error", { status: 500 });
  }

  console.log(`[AUTH-DEBUG] Response Status: ${response.status}`);

  if (["callback", "signin", "signout"].includes(action)) {
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      setCookies.forEach((cookie) => {
        const { name, value, ...options } = parseString(cookie);
        // Sync with Astro cookies to ensure they persist across the adapter boundary
        cookies.set(name, value, options as Parameters<typeof cookies.set>[2]);
      });
    }
  }

  return response;
};

export const GET = handleAuth;
export const POST = handleAuth;
