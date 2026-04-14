import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request }) => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key] = value; });
  return new Response(JSON.stringify({
    url: request.url,
    headers,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
