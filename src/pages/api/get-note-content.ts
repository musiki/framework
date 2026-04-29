import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (!slug) {
    return new Response('Missing slug', { status: 400 });
  }

  // Slug from search index might be like "public/conceptos/name"
  // Collection 'content' is based in src/content
  const cleanSlug = slug.startsWith('/') ? slug.slice(1) : slug;
  
  let note = await getEntry('content', cleanSlug as any);

  if (!note) {
    // Try finding by canonical slug in content collection
    const { getCollection } = await import('astro:content');
    const { getContentCanonicalSlug } = await import('../../lib/content-slug');
    const content = await getCollection('content');
    note = content.find(item => getContentCanonicalSlug(item) === cleanSlug);
  }

  if (!note) {
    // Try cursos collection as well
    const { getCollection } = await import('astro:content');
    const { getContentCanonicalSlug } = await import('../../lib/content-slug');
    const cursos = await getCollection('cursos');
    note = cursos.find(item => {
        const canonical = getContentCanonicalSlug(item);
        return canonical === cleanSlug;
    });
  }

  if (!note) {
    return new Response('Note not found', { status: 404 });
  }

  const reveal = Boolean(
    note.data.reveal === true || 
    note.data.reveal === 'true' || 
    note.data.theme || 
    note.data.slideTheme || 
    note.data.revealTheme
  );

  return new Response(JSON.stringify({
    body: note.body,
    reveal,
    title: note.data.title || cleanSlug
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
