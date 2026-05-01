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
    // Try finding by canonical slug or path match in content collection
    const { getCollection } = await import('astro:content');
    const { getContentCanonicalSlug, normalizeContentSlug } = await import('../../lib/content-slug');
    const content = await getCollection('content');
    const normalizedTarget = normalizeContentSlug(cleanSlug.split('/').pop());
    
    note = content.find(item => {
        // Direct ID match (case insensitive or path match)
        if (item.id.toLowerCase() === cleanSlug.toLowerCase()) return true;
        if (item.id.toLowerCase() === (cleanSlug + '.md').toLowerCase()) return true;
        
        // Canonical slug match
        const canonical = getContentCanonicalSlug(item);
        if (canonical === cleanSlug) return true;
        
        // Normalized filename match (handles spaces -> dashes)
        const filenameNormalized = normalizeContentSlug(item.id.split('/').pop()?.replace(/\.md$/, ''));
        if (filenameNormalized === normalizedTarget && item.id.startsWith(cleanSlug.split('/')[0])) return true;

        return false;
    });
  }

  if (!note) {
    // Try cursos collection as well
    const { getCollection } = await import('astro:content');
    const { getContentCanonicalSlug, normalizeContentSlug } = await import('../../lib/content-slug');
    const cursos = await getCollection('cursos');
    const normalizedTarget = normalizeContentSlug(cleanSlug.split('/').pop());

    note = cursos.find(item => {
        const canonical = getContentCanonicalSlug(item);
        if (canonical === cleanSlug) return true;
        
        // Try matching by normalized tail of the slug
        const canonicalTail = canonical.split('/').pop();
        if (canonicalTail === normalizedTarget) return true;

        return false;
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
