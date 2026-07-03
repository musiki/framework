import { getEntry } from 'astro:content';
import { getPublicContentStaticPaths, type PublicContentRouteProps } from '../lib/public-content-routes';

export const prerender = true;

function cleanMarkdown(md: string): string {
  if (!md) return '';
  return md
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^\)]+\)/g, '$1')
    .replace(/[\*_]{1,3}([^*_]+)[\*_]{1,3}/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET() {
  const allPublicPaths = await getPublicContentStaticPaths();
  
  const items = await Promise.all(allPublicPaths.map(async (routeMatch) => {
    if (routeMatch.props.kind !== 'content') return null;
    
    const route = routeMatch.props as PublicContentRouteProps;
    const item = await getEntry(route.collection, route.entryId);
    if (!item) return null;

    const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
    const title = item.data.title || filename || 'Untitled';
    const slug = routeMatch.params.slug;
    
    // Determine category
    const itemType = String(item.data.type || '').trim().toLowerCase();
    let category = 'Contenido';
    if (itemType === 'concept') category = 'Concepto';
    else if (itemType === 'glossary') category = 'Glosario';
    else if (itemType === 'public-note' || itemType === 'notes') category = 'Nota';
    else if (route.collection === 'content') {
      const parts = item.id.split('/');
      const subfolder = parts.length >= 3 ? parts[1] : null;
      if (subfolder) {
        category = subfolder.charAt(0).toUpperCase() + subfolder.slice(1);
      }
    }

    return {
      title,
      slug: '/' + slug,
      content: cleanMarkdown(item.body || ''),
      type: category,
      def: item.data.def || item.data.definition || '',
      sinopsis: item.data.sinopsis || item.data.synopsis || item.data.description || '',
    };
  }));

  const filteredItems = items.filter(Boolean);

  return new Response(JSON.stringify(filteredItems), {
    headers: { 'Content-Type': 'application/json' },
  });
}
