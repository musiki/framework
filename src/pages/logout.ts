import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request, redirect }) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return redirect(`${baseUrl}/api/auth/signout?callbackUrl=/`);
};
