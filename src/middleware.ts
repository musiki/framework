import { defineMiddleware } from "astro:middleware";
import { getSession } from "auth-astro/server";
import { ensureEvalCatalogSynced } from "./lib/eval-sync";

const shouldSyncEvalCatalogForPath = (pathname: string): boolean => {
  if (!pathname) return false;
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_")) return false;
  if (pathname.startsWith("/assets/")) return false;
  if (pathname === "/favicon.ico") return false;
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  return (
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/cursos") ||
    pathname.startsWith("/live") ||
    pathname.startsWith("/foro")
  );
};

export const onRequest = defineMiddleware(async (context, next) => {
  const url = context.url;
  const pathname = url.pathname;

  // Skip header access and session check for known static or prerendered paths (search.json, assets, etc)
  const isStaticLike = 
    pathname === "/search.json" || 
    pathname === "/public-search.json" ||
    pathname.startsWith("/_") || 
    pathname.startsWith("/assets/") || 
    /\.[a-z0-9]+$/i.test(pathname);

  if (isStaticLike) {
    return next();
  }
  
  // Get hostname from forwarded headers or request URL
  const forwardedHost = context.request.headers.get("x-forwarded-host") || context.request.headers.get("host") || url.hostname;
  const hostname = forwardedHost.split(":")[0];

  // Enforce root domain if hitting www.
  // Using 308 Permanent Redirect to preserve POST method bodies (crucial for Auth)
  if (hostname === "www.musiki.org.ar") {
    const newUrl = new URL(url.href);
    newUrl.hostname = "musiki.org.ar";
    newUrl.protocol = "https:";
    return context.redirect(newUrl.href, 308);
  }

  let session = null;
  if (!isStaticLike) {
    try {
      session = await getSession(context.request);
    } catch (e) {
      // Ignore errors during build-time prerendering
    }
  }
  context.locals.session = session;

  if (shouldSyncEvalCatalogForPath(context.url.pathname)) {
    void ensureEvalCatalogSynced({
      reason: `middleware:${context.url.pathname}`,
    }).catch((error) => {
      console.error("Eval catalog sync failed in middleware:", error);
    });
  }

  // Protect dashboard routes
  if (context.url.pathname.startsWith("/dashboard")) {
    if (!session) {
      return context.redirect("/login?redirect=/dashboard");
    }
  }

  return next();
});
