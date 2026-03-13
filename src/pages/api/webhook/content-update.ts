import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    
    // 1. Forward the request to the internal Content Bus (port 4322)
    // We use localhost to reach the bus running in PM2
    const busUrl = 'http://127.0.0.1:4322/webhook/content-update';
    
    console.log('[Astro Bridge] Forwarding webhook to Content Bus...');

    const response = await fetch(busUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json'
      },
      // We don't necessarily need to wait for the full body if we just want to trigger it
      body: JSON.stringify({ triggeredBy: 'astro-bridge', timestamp: new Date().toISOString() })
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Astro Bridge] Error forwarding to Content Bus:', error);
    return new Response(JSON.stringify({ error: 'Internal Bridge Error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
