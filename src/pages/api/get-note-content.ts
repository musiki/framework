import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';

async function readEntryBody(note: any): Promise<string> {
  const body = typeof note?.body === 'string' ? note.body : '';
  if (body.trim()) return body;

  const filePath = typeof note?.filePath === 'string' ? note.filePath : '';
  if (!filePath) return body;

  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(filePath, 'utf8');
  } catch {
    return body;
  }
}

const legacyCourseSlugAliases: Record<string, Record<string, string>> = {
  s123: {
    'introduccion-a-seminario-i': 'clase-inaugural-seminarios',
    'materiales-de-seminario': 'materiales',
  },
};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (!slug) {
    return new Response('Missing slug', { status: 400 });
  }

  // Slug from search index might be like "public/conceptos/name"
  // Collection 'content' is based in src/content
  const cleanSlug = slug.startsWith('/') ? slug.slice(1) : slug;
  const cleanSlugParts = cleanSlug.split('/').filter(Boolean);
  const requestedCourseId = cleanSlugParts.length > 1 ? cleanSlugParts[0] : '';
  const requestedTail = cleanSlugParts[cleanSlugParts.length - 1] || cleanSlug;
  const aliasTail = requestedCourseId
    ? legacyCourseSlugAliases[requestedCourseId]?.[requestedTail]
    : '';
  const targetSlugs = [requestedTail, aliasTail].filter(Boolean);
  
  let note = await getEntry('content', cleanSlug as any);

  if (!note) {
    // Try finding by canonical slug or path match in content collection
    const { getCollection } = await import('astro:content');
    const {
      getContentCanonicalSlug,
      getContentFilenameSlug,
      getContentFrontmatterSlug,
      getContentTitleSlug,
      normalizeContentSlug,
    } = await import('../../lib/content-slug');
    const content = await getCollection('content');
    const normalizedTargets = targetSlugs.map((target) => normalizeContentSlug(target)).filter(Boolean);
    
    note = content.find(item => {
        // Direct ID match (case insensitive or path match)
        if (item.id.toLowerCase() === cleanSlug.toLowerCase()) return true;
        if (item.id.toLowerCase() === (cleanSlug + '.md').toLowerCase()) return true;
        
        // Canonical slug match
        const canonical = getContentCanonicalSlug(item);
        if (canonical === cleanSlug) return true;
        if (normalizedTargets.includes(canonical)) return true;

        const candidates = [
          getContentFrontmatterSlug(item),
          getContentFilenameSlug(item),
          getContentTitleSlug(item),
        ].filter(Boolean);
        if (candidates.some((candidate) => normalizedTargets.includes(candidate))) return true;
        
        // Normalized filename match (handles spaces -> dashes)
        const filenameNormalized = normalizeContentSlug(item.id.split('/').pop()?.replace(/\.md$/, ''));
        if (normalizedTargets.includes(filenameNormalized) && item.id.startsWith(cleanSlugParts[0] || '')) return true;

        return false;
    });
  }

  if (!note) {
    // Try cursos collection as well
    const { getCollection } = await import('astro:content');
    const {
      getContentCanonicalSlug,
      getContentFilenameSlug,
      getContentFrontmatterSlug,
      getContentTitleSlug,
      normalizeContentSlug,
    } = await import('../../lib/content-slug');
    const cursos = await getCollection('cursos');
    const normalizedTargets = targetSlugs.map((target) => normalizeContentSlug(target)).filter(Boolean);

    note = cursos.find(item => {
        if (requestedCourseId && !String(item.id || '').startsWith(`${requestedCourseId}/`)) {
          return false;
        }
        if (item.id.toLowerCase() === cleanSlug.toLowerCase()) return true;
        if (item.id.toLowerCase() === (cleanSlug + '.md').toLowerCase()) return true;

        const canonical = getContentCanonicalSlug(item);
        if (canonical === cleanSlug || normalizedTargets.includes(canonical)) return true;
        
        const candidates = [
          getContentFrontmatterSlug(item),
          getContentFilenameSlug(item),
          getContentTitleSlug(item),
          normalizeContentSlug(String(item.id || '').split('/').pop()),
        ].filter(Boolean);
        if (candidates.some((candidate) => normalizedTargets.includes(candidate))) return true;

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
    body: await readEntryBody(note),
    reveal,
    title: note.data.title || cleanSlug
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
