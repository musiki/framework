// Fire-and-forget trigger for the so-web rebuild watcher: touches (or
// creates) a sentinel file the VPS-side watcher polls for. Never throws —
// a rebuild-trigger failure must never fail, or even visibly slow, the
// save that caused it; errors are only logged.

import fs from 'node:fs/promises';

function triggerPath(): string {
  return process.env.SO_REBUILD_TRIGGER || '/opt/so/.rebuild-requested';
}

export async function requestSiteRebuild(): Promise<void> {
  const path = triggerPath();
  try {
    const now = new Date();
    await fs.utimes(path, now, now);
  } catch (err) {
    // File doesn't exist yet: create it. Any other error (permissions,
    // missing directory, ...) is logged and swallowed below.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      try {
        await fs.writeFile(path, '');
        return;
      } catch (writeErr) {
        console.error('[site/rebuild] failed to create rebuild trigger file:', writeErr);
        return;
      }
    }
    console.error('[site/rebuild] failed to touch rebuild trigger file:', err);
  }
}

export type PublishState = 'idle' | 'pending' | 'building' | 'published' | 'failed';

export type PublishStatus = {
  state: PublishState;
  requestedAt: string | null;
  startedAt: string | null;
  publishedAt: string | null;
  commit: string | null;
  release: string | null;
};

const STATES: readonly PublishState[] = ['idle', 'pending', 'building', 'published', 'failed'];

function statusPath(): string {
  return process.env.SO_REBUILD_STATUS || '/opt/so/.rebuild-status.json';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Pure: normalise parsed status JSON; anything unusable becomes idle. */
export function normalizePublishStatus(raw: unknown): PublishStatus {
  const idle: PublishStatus = { state: 'idle', requestedAt: null, startedAt: null, publishedAt: null, commit: null, release: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return idle;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== 'string' || !STATES.includes(r.state as PublishState)) return idle;
  return {
    state: r.state as PublishState,
    requestedAt: str(r.requestedAt),
    startedAt: str(r.startedAt),
    publishedAt: str(r.publishedAt),
    commit: str(r.commit),
    release: str(r.release),
  };
}

/** Reads the watcher's status file. Never throws: missing/unreadable/invalid -> idle. */
export async function readPublishStatus(path: string = statusPath()): Promise<PublishStatus> {
  try {
    return normalizePublishStatus(JSON.parse(await fs.readFile(path, 'utf8')));
  } catch {
    return normalizePublishStatus(null);
  }
}
