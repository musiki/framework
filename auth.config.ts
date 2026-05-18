import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";
import { resolveAuthRedirectUrl } from "./src/lib/auth-origin";

// Astro/Vite will inject these, but we fallback to process.env for Node contexts
const getEnv = (key: string) => {
  // Runtime environment variables (Node) should take precedence to avoid build-time inlining issues
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) return import.meta.env[key];
  return undefined;
};

// AUTH_URL is set correctly by ecosystem.config.cjs (https://musiki.org.ar) in prod,
// and by the .env file (http://localhost:4321) in dev. SITE_URL is NOT reliable in prod
// because the .env file has the dev value and ecosystem.config.cjs doesn't override it.
const AUTH_URL_RAW = getEnv('AUTH_URL') || getEnv('SITE_URL') || 'https://musiki.org.ar';
// Strip any /api/auth path suffix that may have been appended previously
const AUTH_ORIGIN = AUTH_URL_RAW.replace(/\/api\/auth\/?$/, '').replace(/\/$/, '');
const isDev = getEnv('NODE_ENV') !== "production";

if (typeof process !== 'undefined') {
  process.env.AUTH_TRUST_HOST = "true";
}

console.log(`[AUTH-CONFIG] Mode: ${isDev ? 'DEV' : 'PROD'}, Origin: ${AUTH_ORIGIN}`);

export default defineConfig({
  debug: isDev,
  trustHost: true,
  basePath: "/api/auth",
  cookies: {
    sessionToken: {
      name: isDev ? `musiki.session-token` : `__Secure-musiki.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
      },
    },
    csrfToken: {
      name: isDev ? `musiki.csrf-token` : `__Host-musiki.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
      },
    },
  },
  providers: [
    Google({
      clientId: getEnv('GOOGLE_CLIENT_ID'),
      clientSecret: getEnv('GOOGLE_CLIENT_SECRET'),
      allowDangerousEmailAccountLinking: true,
    }),
    {
      id: "authentik",
      name: "Authentik",
      type: "oidc",
      issuer: getEnv('OIDC_ISSUER_URL') || "https://auth.musiki.org.ar/application/o/musiki26/",
      clientId: getEnv('OIDC_CLIENT_ID'),
      clientSecret: getEnv('OIDC_CLIENT_SECRET'),
      allowDangerousEmailAccountLinking: true,
      authorization: { params: { scope: "openid profile email" } },
      checks: ["pkce", "state"],
      client: {
        token_endpoint_auth_method: "client_secret_post",
      },
      // Add a bit more logging for discovery
      onProfile(profile) {
        console.log(`[AUTH-AUTHENTIK] Profile received for: ${profile.email}`);
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
  secret: getEnv('AUTH_SECRET') || "fallback-musiki26-secret-must-change",
  callbacks: {
    async jwt({ token, user, profile }) {
      if (user || profile) {
        console.log(`[AUTH-JWT] Provider: ${token.sub ? 'Existing' : 'New'}, Email: ${user?.email || profile?.email || token.email}`);
      }
      const userImage = typeof user?.image === "string" ? user.image.trim() : "";
      const profileImage = typeof (profile as any)?.picture === "string" ? String((profile as any).picture).trim() : "";
      if (userImage) token.picture = userImage;
      else if (!token.picture && profileImage) token.picture = profileImage;
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        const tokenImage = typeof token?.picture === "string" ? token.picture.trim() : "";
        if (!session.user.image && tokenImage) session.user.image = tokenImage;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      return resolveAuthRedirectUrl({ url, baseUrl });
    },
  },
});
