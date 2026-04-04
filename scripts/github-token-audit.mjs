#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

const findArgValue = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const envFilePath = path.resolve(findArgValue('--env-file', '.env'));

const normalizeText = (value) => String(value ?? '').trim();

const readDotEnv = (filePath) => {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }

  return env;
};

const dotEnv = readDotEnv(envFilePath);

const resolveToken = (name) => {
  const fromProcess = normalizeText(process.env[name]);
  if (fromProcess) {
    return {
      value: fromProcess,
      source: `process.env:${name}`,
    };
  }

  const fromDotEnv = normalizeText(dotEnv[name]);
  if (fromDotEnv) {
    return {
      value: fromDotEnv,
      source: `${path.basename(envFilePath)}:${name}`,
    };
  }

  return {
    value: '',
    source: 'missing',
  };
};

const ghAuthStatus = spawnSync('gh', ['auth', 'status'], {
  encoding: 'utf8',
});

const describeGhAuth = () => {
  if (ghAuthStatus.error) {
    return `gh unavailable: ${ghAuthStatus.error.message}`;
  }

  const output = `${ghAuthStatus.stdout || ''}\n${ghAuthStatus.stderr || ''}`;
  if (ghAuthStatus.status === 0) return 'gh auth ok';
  if (/token .* no longer valid/i.test(output) || /authentication failed/i.test(output)) {
    return 'gh auth invalid';
  }
  return `gh auth status exit=${ghAuthStatus.status}`;
};

const githubGet = (token, requestPath) =>
  new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: requestPath,
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'musiki-github-token-audit',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let payload = null;
          try {
            payload = body ? JSON.parse(body) : null;
          } catch {
            payload = null;
          }
          resolve({
            status: res.statusCode || 0,
            acceptedPermissions: normalizeText(res.headers['x-accepted-github-permissions']),
            message: normalizeText(payload?.message),
            repo: normalizeText(payload?.full_name),
            totalCount: Number(payload?.total_count || 0),
          });
        });
      },
    );

    req.on('error', (error) => {
      resolve({
        status: 0,
        acceptedPermissions: '',
        message: error.message,
        repo: '',
        totalCount: 0,
      });
    });

    req.end();
  });

const tokenChecks = [
  {
    name: 'CONTENT_SOURCE_READ_TOKEN',
    intent: 'leer repos de contenido durante content:pull y editor GitHub',
    checks: [
      { label: 'framework repo', path: '/repos/musiki/framework' },
      { label: 'i1 repo', path: '/repos/musiki/i1' },
      { label: 'i2 repo', path: '/repos/musiki/i2' },
      { label: 's123 repo', path: '/repos/musiki/s123' },
      { label: 'cym repo', path: '/repos/musiki/cym' },
      {
        label: 'framework workflow runs',
        path: '/repos/musiki/framework/actions/workflows/sync-content-sources.yml/runs?per_page=1',
      },
    ],
  },
  {
    name: 'PLATFORM_DISPATCH_TOKEN',
    intent: 'disparar repository_dispatch sobre musiki/framework',
    checks: [
      { label: 'framework repo', path: '/repos/musiki/framework' },
      {
        label: 'framework workflow runs',
        path: '/repos/musiki/framework/actions/workflows/sync-content-sources.yml/runs?per_page=1',
      },
    ],
    note:
      'No necesita acceso a repos de materias para funcionar; solo necesita llegar a musiki/framework.',
  },
  {
    name: 'GITHUB_STATUS_TOKEN',
    intent: 'fallback opcional de /api/internal/build-status hacia GitHub Actions',
    checks: [
      {
        label: 'framework workflow runs',
        path: '/repos/musiki/framework/actions/workflows/sync-content-sources.yml/runs?per_page=1',
      },
    ],
  },
  {
    name: 'GITHUB_TOKEN',
    intent: 'token genérico del shell/CLI; no conviene confiar en él para deploy',
    checks: [
      { label: 'framework repo', path: '/repos/musiki/framework' },
    ],
  },
];

console.log(`GitHub token audit`);
console.log(`- cwd: ${process.cwd()}`);
console.log(`- env file: ${envFilePath}`);
console.log(`- gh: ${describeGhAuth()}`);

for (const tokenCheck of tokenChecks) {
  const token = resolveToken(tokenCheck.name);
  console.log(`\n[${tokenCheck.name}]`);
  console.log(`- intent: ${tokenCheck.intent}`);
  console.log(`- source: ${token.source}`);

  if (!token.value) {
    console.log(`- status: missing`);
    continue;
  }

  console.log(`- token: present len=${token.value.length}`);

  for (const check of tokenCheck.checks) {
    const result = await githubGet(token.value, check.path);
    const repo = result.repo ? ` repo=${result.repo}` : '';
    const totalCount = result.totalCount ? ` total=${result.totalCount}` : '';
    const accepted = result.acceptedPermissions
      ? ` accepted=${result.acceptedPermissions}`
      : '';
    const message = result.message ? ` msg=${result.message}` : '';
    console.log(`- ${check.label}: status=${result.status}${repo}${totalCount}${accepted}${message}`);
  }

  if (tokenCheck.note) {
    console.log(`- note: ${tokenCheck.note}`);
  }
}
