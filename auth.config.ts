import Google from "@auth/core/providers/google";
import { defineConfig } from "auth-astro";

const LOCALHOST_URL_RE =
  /^https?:\/\/(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i;

function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const withProtocol =
    value.startsWith("http://") || value.startsWith("https://")
      ? value
      : `https://${value}`;
  return withProtocol.replace(/\/$/, "");
}

function firstNonLocalUrl(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (!normalized) continue;
    if (LOCALHOST_URL_RE.test(normalized)) continue;
    return normalized;
  }
}

function sanitizeInternalPath(value?: string | null): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "";
  if (trimmed.startsWith("/api/auth")) return "";
  return trimmed;
}

const runtimeAuthUrl = normalizeUrl(
  process.env.AUTH_URL || process.env.NEXTAUTH_URL
);
const vercelRuntimeUrl = firstNonLocalUrl(
  process.env.SITE_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  process.env.VERCEL_URL
);

if (
  process.env.NODE_ENV === "production" &&
  vercelRuntimeUrl &&
  (!runtimeAuthUrl || LOCALHOST_URL_RE.test(runtimeAuthUrl))
) {
  process.env.AUTH_URL = vercelRuntimeUrl;
  process.env.NEXTAUTH_URL = vercelRuntimeUrl;
}

export default defineConfig({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || import.meta.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.AUTH_SECRET || import.meta.env.AUTH_SECRET,
  callbacks: {
    async jwt({ token, user, profile }) {
      const userImage =
        typeof user?.image === "string" ? user.image.trim() : "";
      const profileImage =
        typeof (profile as any)?.picture === "string"
          ? String((profile as any).picture).trim()
          : "";

      if (userImage) token.picture = userImage;
      else if (!token.picture && profileImage) token.picture = profileImage;

      if (!token.name && user?.name) token.name = user.name;
      if (!token.email && user?.email) token.email = user.email;

      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        const tokenImage =
          typeof token?.picture === "string" ? token.picture.trim() : "";
        const tokenName = typeof token?.name === "string" ? token.name : "";
        const tokenEmail = typeof token?.email === "string" ? token.email : "";

        if (!session.user.image && tokenImage) session.user.image = tokenImage;
        if (!session.user.name && tokenName) session.user.name = tokenName;
        if (!session.user.email && tokenEmail) session.user.email = tokenEmail;
      }

      return session;
    },
    async redirect({ url, baseUrl }) {
      const normalizedBase = baseUrl.replace(/\/$/, "");
      let target: URL | null = null;

      try {
        target = url.startsWith("/")
          ? new URL(url, normalizedBase)
          : new URL(url);
      } catch {
        target = null;
      }

      if (!target || target.origin !== normalizedBase) {
        return `${normalizedBase}/dashboard`;
      }

      if (target.pathname === "/login") {
        const redirectPath = sanitizeInternalPath(
          target.searchParams.get("redirect")
        );
        if (redirectPath) return `${normalizedBase}${redirectPath}`;
        return `${normalizedBase}/dashboard`;
      }

      return target.toString();
    },
  },
});
