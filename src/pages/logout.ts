import type { APIRoute } from "astro";
import { resolveRequestAuthOrigin } from "../lib/auth-origin";

export const GET: APIRoute = async ({ request, redirect }) => {
  const origin = resolveRequestAuthOrigin(request);
  return redirect(`${origin}/api/auth/signout?callbackUrl=/`);
};
