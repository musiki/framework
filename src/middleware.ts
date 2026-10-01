import { defineMiddleware } from "astro:middleware";
import { getSession } from "auth-astro/server";
import { ensureEvalCatalogSynced } from "./lib/eval-sync";
import { decideTenantRequest, needsDashboardSession } from "./lib/tenant/request";
import { DEFAULT_TENANT_ID, TENANTS } from "./lib/tenant/tenants";

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

  // Prerendered pages are built once for the default tenant; reading request
  // headers there only triggers Astro's prerender warnings.
  const tenantDecision = context.isPrerendered && !import.meta.env.DEV
    ? { tenant: TENANTS[DEFAULT_TENANT_ID], action: "next" as const }
    : decideTenantRequest({
        host: context.request.headers.get("x-forwarded-host") || context.request.headers.get("host") || url.hostname,
        // Raw pathname (encoding and '//' kept): what the router matches.
        pathname: new URL(context.request.url).pathname,
        envTenant: import.meta.env.DEV ? process.env.TENANT : undefined,
      });
  context.locals.tenant = tenantDecision.tenant;
  if (tenantDecision.action === "redirect") {
    // Canonical spelling (mm: /<slug>/ → /<slug>); same-origin path, query kept.
    return context.redirect(`${tenantDecision.location}${url.search}`, 301);
  }
  if (tenantDecision.action === "not-found") {
    // mm renders its own plain 404 (no musiki/so chrome). next(path) serves
    // the internal page without re-running this middleware.
    if (tenantDecision.tenant.id === "mm") return next("/mm-app/not-found");
    if (tenantDecision.tenant.routes === "all") {
      // Only /mm-app/* reaches here on full-route tenants: musiki's 404 page, with a real 404 status.
      const notFound = await context.rewrite("/404");
      return new Response(notFound.body, { status: 404, headers: notFound.headers });
    }
    return context.rewrite("/studio/not-found");
  }
  // mm public pages are served from the internal /mm-app/* mount. Applied via
  // next(path) at the end so the rest of this middleware still runs and the
  // internal path never goes through the tenant check (which 404s it).
  const internalPath = "rewrite" in tenantDecision && tenantDecision.rewrite
    ? `${tenantDecision.rewrite}${url.search}`
    : null;
  const proceed = () => (internalPath ? next(internalPath) : next());

  // Skip header access and session check for known static or prerendered paths (search.json, assets, etc)
  const isStaticLike = 
    pathname === "/search.json" || 
    pathname === "/public-search.json" ||
    pathname.startsWith("/_") || 
    pathname.startsWith("/assets/") || 
    /\.[a-z0-9]+$/i.test(pathname);

  if (isStaticLike) {
    return proceed();
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
    newUrl.port = ""; // Ensure we strip the internal port if it was present
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

  // Eval catalog sync is musiki course machinery: only full-route tenants.
  if (tenantDecision.tenant.routes === "all" && shouldSyncEvalCatalogForPath(context.url.pathname)) {
    // Skip eval sync in development if the tunnel is unstable
    if (import.meta.env.DEV) {
      console.log(`[DEV] Skipping eval sync for ${context.url.pathname} to save tunnel bandwidth`);
    } else {
      void ensureEvalCatalogSynced({
        reason: `middleware:${context.url.pathname}`,
      }).catch((error) => {
        console.error("Eval catalog sync failed in middleware:", error);
      });
    }
  }

  // Protect dashboard routes
  // (full-route tenants only, exact path or below: see needsDashboardSession)
  if (needsDashboardSession(tenantDecision.tenant, context.url.pathname)) {
    if (!session) {
      return context.redirect("/login?redirect=/dashboard");
    }
  }

  return proceed();
});
