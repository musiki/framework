import type { APIRoute } from 'astro';
import { renderForumMarkdown } from '../../../lib/forum-markdown';

function extractAndNormalizeFootnotes(markdown: string): string {
  const lines = markdown.split('\n');
  const definitions: string[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([\s>]*?)(\[\^[^\]]+\]:\s*.*)$/);
    if (match) {
      definitions.push(match[2]);
      const prefix = match[1];
      if (prefix.includes('>')) {
        cleanLines.push(prefix.trimEnd());
      } else {
        cleanLines.push('');
      }
    } else {
      cleanLines.push(line);
    }
  }

  if (definitions.length > 0) {
    return cleanLines.join('\n') + '\n\n' + definitions.join('\n');
  }
  return markdown;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();
    let markdown = String(payload?.markdown || '');
    const interactiveBlocks = payload?.interactiveBlocks === true;
    
    markdown = extractAndNormalizeFootnotes(markdown);
    
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
