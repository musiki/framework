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
const cleanMissing = args.includes('--clean');

const run = (cmd, cmdArgs, options = {}) => {
  execFileSync(cmd, cmdArgs, {
    stdio: 'inherit',
    ...options,
  });
};

const toRepoUrl = (repo) => {
  if (!repo) throw new Error('Missing "repo" in source configuration.');
  if (/^(https?|ssh):\/\//i.test(repo) || repo.startsWith('git@')) return repo;
  return `https://github.com/${repo}.git`;
};

const withTokenIfNeeded = (repoUrl, token) => {
  if (!token) return repoUrl;
  if (!repoUrl.startsWith('https://github.com/')) return repoUrl;
  return repoUrl.replace('https://', `https://x-access-token:${token}@`);
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

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

const pullFromLocalPath = (source, targetDir) => {
  const localPath = path.resolve(source.localPath);
  if (!fs.existsSync(localPath)) {
    return false;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(localPath, targetDir, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== '.git',
  });
  return true;
};

const pullFromRepo = (source, targetDir, token) => {
  const branch = source.branch || 'main';
  const repoUrl = toRepoUrl(source.repo);
  const authRepoUrl = withTokenIfNeeded(repoUrl, token);

  if (!fs.existsSync(targetDir)) {
    run('git', ['clone', '--depth', '1', '--branch', branch, authRepoUrl, targetDir]);
    return;
  }

  run('git', ['-C', targetDir, 'remote', 'set-url', 'origin', authRepoUrl]);
  run('git', ['-C', targetDir, 'fetch', '--depth', '1', 'origin', branch]);
  run('git', ['-C', targetDir, 'checkout', '-B', branch, 'FETCH_HEAD']);
  run('git', ['-C', targetDir, 'clean', '-fd']);
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

  ensureDir(sourcesDir);

  const knownIds = new Set();
  for (const source of sources) {
    if (!source.id) {
      throw new Error(`Every source needs an "id". Invalid source: ${JSON.stringify(source)}`);
    }
    knownIds.add(source.id);
    const targetDir = path.join(sourcesDir, source.id);

    if (source.localPath) {
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
    } else {
      pullFromRepo(source, targetDir, token);
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
