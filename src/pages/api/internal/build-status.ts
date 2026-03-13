import type { APIRoute } from 'astro';

const GITHUB_OWNER = 'musiki';
const GITHUB_REPO = 'framework';
const GITHUB_WORKFLOW = 'sync-content-sources.yml';
const CACHE_TTL_MS = 5_000; // Shorter TTL for local bus
const WORKFLOW_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}`;

type CachedPayload = {
  expiresAt: number;
  body: Record<string, unknown>;
};

let cachedPayload: CachedPayload | null = null;

const formatTimestamp = (value: unknown) => {
  if (!value) return '';

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
};

const toTitle = (state: string, details: string, timestamp: string) => {
  const suffix = [details, timestamp].filter(Boolean).join(' · ');
  const displayDetails = suffix ? ` · ${suffix}` : '';

  if (state === 'running') return `Sincronización en curso${displayDetails}`;
  if (state === 'ok') return `Última sincronización correcta${displayDetails}`;
  if (state === 'error') return `Última sincronización con error${displayDetails}`;
  if (state === 'idle') return `Content Bus listo${displayDetails}`;
  return `Estado no disponible${displayDetails}`;
};

export const GET: APIRoute = async () => {
  const now = Date.now();
  if (cachedPayload && cachedPayload.expiresAt > now) {
    return new Response(JSON.stringify(cachedPayload.body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=10',
      },
    });
  }

  try {
    // 1. Try to fetch from LOCAL Content Bus
    const busResponse = await fetch('http://127.0.0.1:4322/status').catch(() => null);
    
    if (busResponse && busResponse.ok) {
      const busStatus = await busResponse.json();
      const timestamp = formatTimestamp(busStatus.updatedAt || busStatus.createdAt);
      const sourceInfo = busStatus.sourceRepo ? `repo: ${busStatus.sourceRepo.split('/')[1] || busStatus.sourceRepo}` : '';
      
      const body = {
        ...busStatus,
        title: toTitle(busStatus.state, sourceInfo, timestamp),
        fetchedAt: new Date().toISOString(),
      };

      cachedPayload = { expiresAt: now + CACHE_TTL_MS, body };
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 2. Fallback to GitHub (original logic)
    const token = (import.meta.env.GITHUB_STATUS_TOKEN || import.meta.env.GITHUB_TOKEN || '').trim();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'musiki-framework-build-status',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW)}/runs?per_page=1`,
      { headers },
    );

    if (!response.ok) throw new Error(`GitHub API error`);

    const payload = await response.json();
    const latestRun = payload?.workflow_runs?.[0];

    if (!latestRun) throw new Error('No runs');

    const state = latestRun.status === 'completed' 
      ? (latestRun.conclusion === 'success' ? 'ok' : 'error') 
      : 'running';
    
    const timestamp = formatTimestamp(latestRun.updated_at);
    const body = {
      state,
      title: toTitle(state, `GH run ${latestRun.run_number}`, timestamp),
      runUrl: latestRun.html_url,
      mode: 'github-fallback',
      fetchedAt: new Date().toISOString(),
    };

    cachedPayload = { expiresAt: now + CACHE_TTL_MS, body };
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (error) {
    const body = {
      state: 'unknown',
      title: 'Estado de sincronización no disponible',
      fetchedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }
};
