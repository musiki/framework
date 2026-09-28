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
