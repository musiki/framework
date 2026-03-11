import type { APIRoute } from 'astro';

const timeoutMs = Number(import.meta.env.CORRECTION_API_TIMEOUT_MS || 65000);

export const GET: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const correctionApiUrl = import.meta.env.CORRECTION_API_URL;
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN;

  if (!correctionApiUrl || !correctionApiToken) {
    return json(
      {
        error: 'Correction API is not configured',
        missing: {
          CORRECTION_API_URL: !correctionApiUrl,
          CORRECTION_API_TOKEN: !correctionApiToken,
        },
      },
      500,
    );
  }

  try {
    const response = await fetch(`${correctionApiUrl}/api/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${correctionApiToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const responseText = await response.text();
    let parsed: unknown = responseText;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Keep raw text fallback.
    }

    if (!response.ok) {
      return json(
        {
          error: 'Models backend failed',
          upstreamStatus: response.status,
          upstreamBody: parsed,
        },
        502,
      );
    }

    return json(parsed, 200);
  } catch (error: any) {
    return json(
      {
        error: 'Failed to reach models backend',
        detail: error?.message || 'Unknown error',
      },
      502,
    );
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
