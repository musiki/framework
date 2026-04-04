#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

const findArgValue = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const manifestPath = path.resolve(findArgValue('--manifest', 'config/sources.manifest.json'));
const sourcesDir = path.resolve(findArgValue('--sources-dir', '.content-sources'));
const envFileInjectedKeys = new Set();
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

// Load .env manually since this script runs outside of Astro's env loading
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...value] = trimmed.split('=');
    if (key && value.length > 0) {
      const envKey = key.trim();
      if (Object.prototype.hasOwnProperty.call(process.env, envKey)) return;
      const val = value.join('=').trim().replace(/^["']|["']$/g, '');
      process.env[envKey] = val;
      envFileInjectedKeys.add(envKey);
    }
  });
}

const cleanMissing = args.includes('--clean');
const normalizeBranchName = (value) => String(value || '').trim().replace(/^refs\/heads\//, '');
const normalizeRepoSlug = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('git@github.com:')) {
    return text.slice('git@github.com:'.length).replace(/\.git$/i, '').toLowerCase();
  }
  return text
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '')
    .toLowerCase();
};
const targetRepo = normalizeRepoSlug(process.env.CONTENT_SOURCE_TARGET_REPO || '');
const targetBranch = normalizeBranchName(
  process.env.CONTENT_SOURCE_TARGET_BRANCH || process.env.CONTENT_SOURCE_TARGET_REF || '',
);
const targetSha = (() => {
  const value = String(process.env.CONTENT_SOURCE_TARGET_SHA || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(value) ? value.toLowerCase() : '';
})();
const sourceStrategy = (() => {
  const normalized = (process.env.CONTENT_SOURCE_STRATEGY || 'prefer-local')
    .trim()
    .toLowerCase();

  if (normalized === 'prefer-local' || normalized === 'remote-only') {
    return normalized;
  }

  throw new Error(
    `Invalid CONTENT_SOURCE_STRATEGY "${process.env.CONTENT_SOURCE_STRATEGY}". Use "prefer-local" or "remote-only".`,
  );
})();

const run = (cmd, cmdArgs, options = {}) => {
  try {
    execFileSync(cmd, cmdArgs, {
      stdio: 'inherit',
      ...options,
    });
  } catch (err) {
    // Redact potential tokens from error messages
    if (err.message) {
      const token = process.env.CONTENT_SOURCE_READ_TOKEN || process.env.GITHUB_TOKEN;
      if (token) {
        err.message = err.message.replace(new RegExp(token, 'g'), '****');
      }
    }
    throw err;
  }
};

const toRepoUrl = (repo) => {
  if (!repo) throw new Error('Missing "repo" in source configuration.');
  if (/^(https?|ssh):\/\//i.test(repo) || repo.startsWith('git@')) return repo;
  return `https://github.com/${repo}.git`;
};

const withTokenIfNeeded = (repoUrl, token) => {
  if (!token) return repoUrl;
  if (!repoUrl.startsWith('https://github.com/')) return repoUrl;
  // Use the format https://<token>@github.com which works for both classic and fine-grained PATs
  return repoUrl.replace('https://', `https://${token}@`);
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const sleep = (ms) => {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readHeadSha = (targetDir) =>
  execFileSync('git', ['-C', targetDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const describeTokenSource = () => {
  if (process.env.CONTENT_SOURCE_READ_TOKEN) {
    return envFileInjectedKeys.has('CONTENT_SOURCE_READ_TOKEN')
      ? '.env:CONTENT_SOURCE_READ_TOKEN'
      : 'env:CONTENT_SOURCE_READ_TOKEN';
  }

  if (process.env.GITHUB_TOKEN) {
    return envFileInjectedKeys.has('GITHUB_TOKEN')
      ? '.env:GITHUB_TOKEN'
      : 'env:GITHUB_TOKEN';
  }

  return 'missing';
};

const loadManifest = () => {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const parsed = readJson(manifestPath);
  const allSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const enabled = allSources.filter((source) => source && source.enabled !== false);
  if (enabled.length === 0) {
    throw new Error(
      `No enabled sources found in ${manifestPath}. Set at least one source with "enabled": true.`,
    );
  }
  return { manifest: parsed, sources: enabled };
};

const isIgnored = (name) =>
  name === '.git' ||
  name === '.obsidian' ||
  name === '.trash' ||
  name === '.github' ||
  name === '.DS_Store' ||
  name === '.env' ||
  name === '.gitignore';

const pullFromLocalPath = (source, targetDir) => {
  const localPath = path.resolve(source.localPath);
  if (!fs.existsSync(localPath)) {
    return false;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(localPath, targetDir, {
    recursive: true,
    filter: (sourcePath) => !isIgnored(path.basename(sourcePath)),
  });
  return true;
};

const pullFromRepo = (source, targetDir, token) => {
  const defaultBranch = source.branch || 'main';
  const sourceRepo = normalizeRepoSlug(source.repo);
  const desiredBranch =
    targetRepo && (targetRepo === sourceRepo || targetRepo === String(source.id || '').trim().toLowerCase())
      ? targetBranch || defaultBranch
      : defaultBranch;
  const desiredSha =
    targetRepo && (targetRepo === sourceRepo || targetRepo === String(source.id || '').trim().toLowerCase())
      ? targetSha
      : '';
  const repoUrl = toRepoUrl(source.repo);
  const authRepoUrl = withTokenIfNeeded(repoUrl, token);
  const maskedUrl = authRepoUrl.replace(token, '****');
  const checkoutDesiredCommit = () => {
    if (!desiredSha) {
      console.log(`[content:pull] ${source.id} HEAD ${readHeadSha(targetDir)}`);
      return;
    }

    const currentHead = readHeadSha(targetDir).toLowerCase();
    if (currentHead === desiredSha) {
      console.log(`[content:pull] ${source.id} already at requested sha ${currentHead}`);
      return;
    }

    console.log(`[content:pull] Pinning ${source.id} to requested sha ${desiredSha}...`);
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        run('git', ['-C', targetDir, 'fetch', '--depth', '1', 'origin', desiredSha]);
        run('git', ['-C', targetDir, 'checkout', '-B', desiredBranch, 'FETCH_HEAD']);
        run('git', ['-C', targetDir, 'clean', '-fd']);
        const resolvedHead = readHeadSha(targetDir).toLowerCase();
        if (resolvedHead !== desiredSha) {
          throw new Error(
            `Requested sha ${desiredSha} for ${source.id}, but resolved ${resolvedHead} instead.`,
          );
        }
        console.log(`[content:pull] ${source.id} pinned to ${resolvedHead}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= 5) break;
        console.warn(
          `[content:pull] ${source.id} could not fetch requested sha yet (attempt ${attempt}/5). Retrying...`,
        );
        sleep(1500 * attempt);
      }
    }

    throw lastError;
  };

  const doClone = () => {
    console.log(`[content:pull] Cloning ${source.id} from ${maskedUrl}...`);
    run('git', ['clone', '--depth', '1', '--branch', desiredBranch, authRepoUrl, targetDir]);
    checkoutDesiredCommit();
  };

  if (!fs.existsSync(targetDir) || !fs.existsSync(path.join(targetDir, '.git'))) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    doClone();
    return;
  }

  try {
    console.log(`[content:pull] Updating ${source.id} via fetch...`);
    run('git', ['-C', targetDir, 'remote', 'set-url', 'origin', authRepoUrl]);
    run('git', ['-C', targetDir, 'reset', '--hard', 'HEAD']);
    run('git', ['-C', targetDir, 'clean', '-fd']);
    run('git', ['-C', targetDir, 'fetch', '--depth', '1', 'origin', desiredBranch]);
    run('git', ['-C', targetDir, 'checkout', '-B', desiredBranch, 'FETCH_HEAD']);
    run('git', ['-C', targetDir, 'clean', '-fd']);
    checkoutDesiredCommit();
  } catch (err) {
    console.warn(`[content:pull] Update failed for ${source.id}, retrying with fresh clone...`);
    fs.rmSync(targetDir, { recursive: true, force: true });
    doClone();
  }
};

const cleanRemovedSources = (knownIds) => {
  if (!fs.existsSync(sourcesDir)) return;
  const entries = fs.readdirSync(sourcesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (knownIds.has(entry.name)) continue;
    fs.rmSync(path.join(sourcesDir, entry.name), { recursive: true, force: true });
  }
};

const main = () => {
  const { sources } = loadManifest();
  const token = process.env.CONTENT_SOURCE_READ_TOKEN || process.env.GITHUB_TOKEN || '';
  
  if (token) {
    console.log(`[content:pull] token source=${describeTokenSource()} length=${token.length}`);
  } else {
    console.warn('[content:pull] No token found in env or .env.');
  }

  if (targetRepo) {
    console.log(
      `[content:pull] target repo=${targetRepo} branch=${targetBranch || '(default)'} sha=${targetSha || '(none)'}`,
    );
  }

  ensureDir(sourcesDir);
  console.log(`[content:pull] strategy=${sourceStrategy}`);

  const knownIds = new Set();
  for (const source of sources) {
    if (!source.id) {
      throw new Error(`Every source needs an "id". Invalid source: ${JSON.stringify(source)}`);
    }
    knownIds.add(source.id);
    const targetDir = path.join(sourcesDir, source.id);

    if (source.localPath && sourceStrategy === 'prefer-local') {
      const pulledFromLocalPath = pullFromLocalPath(source, targetDir);
      if (!pulledFromLocalPath && !source.repo) {
        throw new Error(
          `Source "${source.id}" localPath does not exist and no "repo" fallback is configured: ${path.resolve(source.localPath)}`,
        );
      }

      if (!pulledFromLocalPath) {
        console.warn(
          `Source "${source.id}" localPath not found. Falling back to repo "${source.repo}".`,
        );
        pullFromRepo(source, targetDir, token);
      }
    } else if (source.repo) {
      if (source.localPath && sourceStrategy === 'remote-only') {
        console.log(
          `Source "${source.id}" ignoring localPath "${source.localPath}" because CONTENT_SOURCE_STRATEGY=remote-only.`,
        );
      }
      pullFromRepo(source, targetDir, token);
    } else if (source.localPath) {
      throw new Error(
        `Source "${source.id}" is configured with localPath only, but CONTENT_SOURCE_STRATEGY=remote-only requires a repo.`,
      );
    } else {
      throw new Error(`Source "${source.id}" needs either "repo" or "localPath".`);
    }

    const contentRoot = source.contentRoot || '.';
    const vaultRoot = path.join(targetDir, contentRoot);
    if (!fs.existsSync(vaultRoot)) {
      throw new Error(
        `Source "${source.id}" is missing vault root "${contentRoot}" at ${vaultRoot}`,
      );
    }
    console.log(`Synced source "${source.id}" -> ${targetDir}`);
  }

  if (cleanMissing) {
    cleanRemovedSources(knownIds);
  }
};

main();
