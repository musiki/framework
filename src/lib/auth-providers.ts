type Env = Record<string, string | undefined>;

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
