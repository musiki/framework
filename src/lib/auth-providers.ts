type Env = Record<string, string | undefined>;

// Whether a tenant Logto provider (logto-<tenant>) is registered in
// auth.config.ts, i.e. LOGTO_ISSUER_URL and LOGTO_<TENANT>_CLIENT_ID are set.
// Other providers (musiki's) are not judged here and count as configured.
export function isTenantAuthProviderConfigured(providerId: string | undefined, env: Env | ((key: string) => string | undefined)): boolean {
  const get = typeof env === "function" ? env : (key: string) => env[key];
  const match = /^logto-([a-z0-9]+)$/.exec(String(providerId ?? ''));
  if (!match) return true;
  return Boolean(get("LOGTO_ISSUER_URL") && get(`LOGTO_${match[1].toUpperCase()}_CLIENT_ID`));
}

// hem tenant Logto client. Included only when its client id is configured.
// ui_locales is hem-only (French), so the other providers stay untouched.
export function buildLogtoHemProvider(env: Env) {
  const issuer = env.LOGTO_ISSUER_URL;
  const clientId = env.LOGTO_HEM_CLIENT_ID;
  if (!issuer || !clientId) return [];
  return [{
    id: "logto-hem",
    name: "HEM",
    type: "oidc" as const,
    issuer,
    clientId,
    clientSecret: env.LOGTO_HEM_CLIENT_SECRET,
    authorization: { params: { scope: "openid profile email", ui_locales: "fr" } },
    checks: ["pkce", "state"] as ("pkce" | "state")[],
    onProfile(profile: Record<string, unknown>) {
      return {
        id: profile.sub,
        name: (profile.name as string) ?? (profile.username as string),
        email: profile.email,
        image: profile.picture,
      };
    },
  }];
}
