import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    
    // Read the original payload to forward it
    const bodyText = await request.text();
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (e) {
      payload = { raw: bodyText };
    }
    
    const busUrl = 'http://127.0.0.1:4322/webhook/content-update';
    
    console.log('[Astro Bridge] Forwarding webhook to Content Bus...');

    const response = await fetch(busUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
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
