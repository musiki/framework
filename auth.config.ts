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
      const effectiveBase = configuredUrl ? configuredUrl.replace(/\/$/, "") : baseUrl;
      if (url.startsWith("/")) return `${effectiveBase}${url}`;
      return url.startsWith(effectiveBase) ? url : `${effectiveBase}/dashboard`;
    },
  },
});
