import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";

export default defineConfig({
  trustHost: true,
  // Forzamos manualmente el proxy URL para asegurar que use HTTPS en el callback de Google
  redirectProxyUrl: "https://dev.musiki.org.ar/api/auth",
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
      // Forzamos a que cualquier redirección use dev.musiki.org.ar con https
      const devBase = "https://dev.musiki.org.ar";
      if (url.startsWith("/")) return `${devBase}${url}`;
      if (url.includes("localhost") || url.includes("127.0.0.1") || url.startsWith("http://dev.musiki.org.ar")) {
        try {
          const u = new URL(url);
          return `${devBase}${u.pathname}${u.search}`;
        } catch (e) {
          return `${devBase}/dashboard`;
        }
      }
      return url;
    },
  },
});
