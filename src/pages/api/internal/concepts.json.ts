import type { APIRoute } from 'astro';
import { buildConceptIndex } from '../../../lib/concept-indexer';

export const GET: APIRoute = async () => {
  try {
    const { index, lookup } = await buildConceptIndex();
    return new Response(JSON.stringify({ index, lookup }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
