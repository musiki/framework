import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  console.log(`[Astro Bridge] Webhook request received: ${request.method} ${request.url}`);
  try {
    const authHeader = request.headers.get('authorization') || '';
    const maskedAuth = authHeader.length > 15 ? `${authHeader.slice(0, 15)}...` : 'too-short';
    console.log(`[Astro Bridge] Auth header: ${maskedAuth}`);
    
    // Read the original payload to forward it
    const bodyText = await request.text();
    console.log(`[Astro Bridge] Payload length: ${bodyText.length}`);
    let payload;
    try {
      payload = JSON.parse(bodyText);
      console.log(`[Astro Bridge] Source repo: ${payload?.source_repo || 'unknown'}`);
    } catch (e) {
      payload = { raw: bodyText };
      console.warn(`[Astro Bridge] Payload is not JSON`);
    }
    
    const busUrl = 'http://127.0.0.1:4322/webhook/content-update';
    
    console.log(`[Astro Bridge] Forwarding webhook to Content Bus at ${busUrl}...`);
    console.log(`[Astro Bridge] Payload: ${JSON.stringify(payload)}`);

    const response = await fetch(busUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log(`[Astro Bridge] Content Bus responded with status ${response.status}`);
    const data = await response.json();
    console.log(`[Astro Bridge] Content Bus response data: ${JSON.stringify(data)}`);

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
