import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request, redirect }) => {
  const configuredUrl = process.env.AUTH_URL || import.meta.env.AUTH_URL;
  if (configuredUrl) {
    return redirect(`${configuredUrl.replace(/\/$/, '')}/api/auth/signout?callbackUrl=/`);
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  if (host.includes('musiki.org.ar')) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    return redirect(`${proto}://${host}/api/auth/signout?callbackUrl=/`);
  }

  return redirect('/api/auth/signout?callbackUrl=/');
};
