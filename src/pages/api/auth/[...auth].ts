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
  const url = new URL(request.url);
  const prefix = authConfig.prefix || "/api/auth";
  const action = url.pathname.slice(prefix.length + 1).split("/")[0] as AuthAction;

  if (!actions.includes(action) || !url.pathname.startsWith(`${prefix}/`)) {
    return new Response("Not found", { status: 404 });
  }

  // Use the request directly. Auth.js should handle forwarded headers 
  // correctly if trustHost is true and trustProxy is set in Astro.
  const response = await Auth(request, authConfig);

  if (["callback", "signin", "signout"].includes(action)) {
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      setCookies.forEach((cookie) => {
        const { name, value, ...options } = parseString(cookie);
        // Sync with Astro cookies
        cookies.set(name, value, options as Parameters<typeof cookies.set>[2]);
      });
      // DO NOT delete from response, let them pass through to the browser
    }
  }

  return response;
};

export const GET = handleAuth;
export const POST = handleAuth;
