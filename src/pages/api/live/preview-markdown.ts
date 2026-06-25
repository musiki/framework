import type { APIRoute } from 'astro';
import { renderForumMarkdown } from '../../../lib/forum-markdown';

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();
    const markdown = String(payload?.markdown || '');
    const interactiveBlocks = payload?.interactiveBlocks === true;
    
    if (!markdown.trim()) {
      return new Response(JSON.stringify({ html: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const html = await renderForumMarkdown(markdown, {
      remoteLilypond: true,
      strudelBlocks: interactiveBlocks,
    });

    return new Response(JSON.stringify({ html }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[api/live/preview-markdown] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
