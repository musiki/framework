import type { APIRoute } from 'astro';

const GITHUB_OWNER = 'musiki';
const GITHUB_REPO = 'framework';
const GITHUB_WORKFLOW = 'sync-content-sources.yml';
const CACHE_TTL_MS = 15_000;
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

const toState = (status: string, conclusion: string | null) => {
  if (status && status !== 'completed') return 'running';
  if (conclusion === 'success') return 'ok';
  if (conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out') {
    return 'error';
  }
  if (conclusion === 'skipped' || conclusion === 'neutral') return 'idle';
  return 'unknown';
};

const toTitle = (state: string, runNumber: unknown, timestamp: string) => {
  const suffix = [runNumber ? `run ${runNumber}` : '', timestamp].filter(Boolean).join(' · ');
  const details = suffix ? ` · ${suffix}` : '';

  if (state === 'running') return `Sincronizacion de contenidos en curso${details}`;
  if (state === 'ok') return `Ultima sincronizacion correcta${details}`;
  if (state === 'error') return `Ultima sincronizacion con error${details}`;
  if (state === 'idle') return `Sincronizacion sin cambios${details}`;
  return `Estado de sincronizacion no disponible${details}`;
};

const toFallbackBody = (message: string) => ({
  state: 'unknown',
  title: message,
  workflowUrl: WORKFLOW_URL,
  runUrl: WORKFLOW_URL,
  fetchedAt: new Date().toISOString(),
});

export const GET: APIRoute = async () => {
  const now = Date.now();
  if (cachedPayload && cachedPayload.expiresAt > now) {
    return new Response(JSON.stringify(cachedPayload.body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=45',
      },
    });
  }

  try {
    const token = (
      import.meta.env.GITHUB_STATUS_TOKEN
      || import.meta.env.GITHUB_TOKEN
      || ''
    ).trim();

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'musiki-framework-build-status',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW)}/runs?per_page=8`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const payload = await response.json();
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    const latestRun =
      runs.find((run) => run && (run.event === 'repository_dispatch' || run.event === 'workflow_dispatch'))
      || runs[0]
      || null;

    if (!latestRun) {
      throw new Error('No workflow runs found.');
    }

    const timestamp = formatTimestamp(latestRun.updated_at || latestRun.created_at);
    const state = toState(String(latestRun.status || ''), latestRun.conclusion || null);
    const body = {
      state,
      title: toTitle(state, latestRun.run_number, timestamp),
      workflowUrl: WORKFLOW_URL,
      runUrl: String(latestRun.html_url || WORKFLOW_URL),
      event: String(latestRun.event || ''),
      status: String(latestRun.status || ''),
      conclusion: latestRun.conclusion || null,
      runNumber: latestRun.run_number ?? null,
      createdAt: latestRun.created_at || null,
      updatedAt: latestRun.updated_at || null,
      fetchedAt: new Date().toISOString(),
    };

    cachedPayload = {
      expiresAt: now + CACHE_TTL_MS,
      body,
    };

    return new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=45',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Estado de sincronizacion no disponible: ${error.message}`
        : 'Estado de sincronizacion no disponible.';

    const body = cachedPayload?.body || toFallbackBody(message);

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=45',
      },
    });
  }
};
