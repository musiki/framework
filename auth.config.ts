import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";
import { resolveAuthRedirectUrl } from "./src/lib/auth-origin";

const AUTH_ORIGIN = (process.env.AUTH_URL || 'https://musiki.org.ar').replace(/\/$/, '');

export default defineConfig({
  trustHost: true,
  redirectProxyUrl: `${AUTH_ORIGIN}/api/auth`,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || import.meta.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: "7b271f441de821df715b1c48fcbe4236e5e2149c1ae74ea468ea5eae23aa73ef",
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
      return resolveAuthRedirectUrl({ url, baseUrl });
    },
  },
});
