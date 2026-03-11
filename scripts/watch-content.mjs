#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

const findArgValue = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const manifestPath = path.resolve(findArgValue('--manifest', 'config/sources.manifest.json'));
const debounceMs = Math.max(250, Number(findArgValue('--debounce', process.env.CONTENT_WATCH_DEBOUNCE_MS || '1200')) || 1200);
const runInitial = !args.includes('--no-initial');
const selectedSourceIds = new Set(
  String(findArgValue('--sources', ''))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const readManifest = () => {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const allSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const enabledSources = allSources.filter((source) => source && source.enabled !== false);

  if (enabledSources.length === 0) {
    throw new Error(`No enabled sources found in ${manifestPath}`);
  }

  return enabledSources.filter((source) => {
    if (!source?.id) return false;
    if (selectedSourceIds.size === 0) return true;
    return selectedSourceIds.has(String(source.id));
  });
};

const shouldIgnorePath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized) return false;

  const ignoredFragments = [
    '/.git/',
    '/node_modules/',
    '/.obsidian/workspace',
    '/.obsidian/cache',
    '/.trash/',
    '/dist/',
  ];

  if (ignoredFragments.some((fragment) => normalized.includes(fragment))) return true;
  if (normalized.endsWith('.DS_Store')) return true;
  if (normalized.endsWith('~')) return true;
  if (normalized.endsWith('.swp') || normalized.endsWith('.swo')) return true;
  if (normalized.endsWith('.tmp')) return true;
  return false;
};

const formatTime = (date = new Date()) =>
  date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const formatList = (items, limit = 5) => {
  const values = Array.from(items);
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')}, +${values.length - limit} more`;
};

const runCommand = (cmd, cmdArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited with code ${code}`));
    });
  });

const sources = readManifest();
const localSources = sources
  .map((source) => ({
    id: String(source.id),
    localPath: source.localPath ? path.resolve(source.localPath) : '',
  }))
  .filter((source) => source.localPath && fs.existsSync(source.localPath));

if (localSources.length === 0) {
  console.error('No enabled sources with existing localPath were found. Nothing to watch.');
  process.exit(1);
}

const watchers = [];
const pendingPaths = new Set();
let debounceTimer = null;
let runInFlight = false;
let rerunRequested = false;

const scheduleRun = (label) => {
  if (label) pendingPaths.add(label);
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void performSync();
  }, debounceMs);
};

const performSync = async () => {
  if (runInFlight) {
    rerunRequested = true;
    return;
  }

  runInFlight = true;
  const snapshot = new Set(pendingPaths);
  pendingPaths.clear();

  const reason = snapshot.size > 0 ? formatList(snapshot) : 'manual/initial';
  console.log(`[content:watch ${formatTime()}] sync start (${reason})`);

  try {
    await runCommand(npmCmd, ['run', 'content:pull']);
    await runCommand(npmCmd, ['run', 'content:assemble']);
    console.log(`[content:watch ${formatTime()}] sync ok`);
  } catch (error) {
    console.error(`[content:watch ${formatTime()}] sync failed: ${error.message}`);
  } finally {
    runInFlight = false;
    if (rerunRequested || pendingPaths.size > 0) {
      rerunRequested = false;
      scheduleRun('');
    }
  }
};

const attachWatcher = (sourceId, rootPath) => {
  const watcher = fs.watch(
    rootPath,
    { recursive: true },
    (eventType, filename) => {
      const nextPath = filename ? path.join(rootPath, filename) : rootPath;
      if (shouldIgnorePath(nextPath)) return;

      const relative = filename
        ? `${sourceId}:${String(filename).replace(/\\/g, '/')}`
        : `${sourceId}:<unknown>`;

      console.log(`[content:watch ${formatTime()}] ${eventType} ${relative}`);
      scheduleRun(relative);
    },
  );

  watchers.push(watcher);
};

localSources.forEach((source) => {
  console.log(`[content:watch] watching ${source.id} -> ${source.localPath}`);
  attachWatcher(source.id, source.localPath);
});

if (runInitial) {
  scheduleRun('initial');
}

const shutdown = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  watchers.forEach((watcher) => watcher.close());
  console.log(`\n[content:watch ${formatTime()}] stopped`);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[content:watch] debounce ${debounceMs}ms`);
console.log('[content:watch] press Ctrl+C to stop');
