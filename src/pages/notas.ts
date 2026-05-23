// src/pages/notas.ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(null, { status: 302, headers: { Location: '/dashboard' } });

export const prerender = false;
