import { safeGetCollection } from '../lib/safe-content-collection';
import { getContentCanonicalSlug } from '../lib/content-slug';

export const prerender = true;

export async function GET() {
  const content = await safeGetCollection('content');

  const items = content
    .filter((item) => item.id.startsWith('public/'))
    .map((item) => {
      const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
      const title = item.data.title || filename || 'Untitled';
      const slug = getContentCanonicalSlug(item);
      // Derive a human-readable category from the subfolder (e.g. "public/instrumentos/..." → "Instrumentos")
      const parts = item.id.split('/');
      const subfolder = parts.length >= 3 ? parts[1] : null;
      const category = subfolder
        ? subfolder.charAt(0).toUpperCase() + subfolder.slice(1)
        : 'Contenido';

      return {
        title,
        slug: '/' + slug,
        content: item.body || '',
        type: category,
      };
    });

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
}
