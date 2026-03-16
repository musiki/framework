import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";

const configuredUrl = process.env.AUTH_URL || import.meta.env.AUTH_URL;

export default defineConfig({
  trustHost: true,
  redirectProxyUrl: configuredUrl ? `${configuredUrl.replace(/\/$/, '')}/api/auth` : undefined,
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
      // In Production with Nginx, baseUrl often incorrectly points to localhost (missing port & protocol).
      // If we have an AUTH_URL, always use it.
      const isDev = process.env.NODE_ENV === "development" || typeof import.meta.env !== "undefined" && import.meta.env.DEV;
      const effectiveBase = process.env.AUTH_URL 
        ? process.env.AUTH_URL.replace(/\/$/, "") 
        : (isDev ? baseUrl : "https://musiki.org.ar");
      
      try {
        const parsed = new URL(url, effectiveBase);
        // Force replace localhost without port to our true origin in prod
        if (parsed.hostname === 'localhost' && !isDev) {
           return `${effectiveBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        if (parsed.origin === effectiveBase || parsed.origin === baseUrl) {
          return `${effectiveBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return url;
      } catch {
        if (url.startsWith("/")) return `${effectiveBase}${url}`;
        return `${effectiveBase}/dashboard`;
      }
    },
  },
});
