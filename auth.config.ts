import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";
import { resolveAuthRedirectUrl } from "./src/lib/auth-origin";

// Astro/Vite will inject these, but we fallback to process.env for Node contexts
const getEnv = (key: string) => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) return import.meta.env[key];
  return process.env[key];
};

const AUTH_URL = getEnv('AUTH_URL') || getEnv('SITE_URL') || 'https://musiki.org.ar';
const AUTH_ORIGIN = AUTH_URL.replace(/\/$/, '');
const isDev = getEnv('NODE_ENV') !== "production";

console.log(`[AUTH-CONFIG] Mode: ${isDev ? 'DEV' : 'PROD'}, Origin: ${AUTH_ORIGIN}`);

export default defineConfig({
  debug: isDev,
  trustHost: true,
  // Only use redirectProxyUrl in production to handle domain normalization
  redirectProxyUrl: isDev ? undefined : `${AUTH_ORIGIN}/api/auth`,
  cookies: {
    sessionToken: {
      name: `musiki26.session-token`,
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
