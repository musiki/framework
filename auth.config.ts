import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";

const configuredUrl = process.env.AUTH_URL || import.meta.env.AUTH_URL;
// Check if we are in local development mode
const isDev = process.env.NODE_ENV === "development" || import.meta.env.DEV;

// 1. VPS/Prod with PM2 explicitly setting AUTH_URL: Uses configuredUrl
// 2. Local dev (npm run dev): Uses undefined (falls back to localhost dynamically)
// 3. VPS/Prod without AUTH_URL: Uses musiki.org.ar to fix Nginx/PM2 missing Host header issues.
const redirectProxyUrl = configuredUrl 
  ? `${configuredUrl}/api/auth` 
  : (isDev ? undefined : "https://musiki.org.ar/api/auth");

const SITE_URL = configuredUrl || (isDev ? "http://localhost:4321" : "https://musiki.org.ar");

export default defineConfig({
  trustHost: true,
  redirectProxyUrl,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || import.meta.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.AUTH_SECRET || import.meta.env.AUTH_SECRET,
  callbacks: {
    async jwt({ token, user, profile }) {
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
      // Usar SITE_URL para asegurar que los redireccionamientos vuelvan al dominio correcto
      const effectiveBase = SITE_URL.replace(/\/$/, "");
      if (url.startsWith("/")) return `${effectiveBase}${url}`;
      return url.startsWith(effectiveBase) ? url : `${effectiveBase}/dashboard`;
    },
  },
});
