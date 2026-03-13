import { createSign } from 'node:crypto';

const GITHUB_API_BASE = 'https://api.github.com';

type GitHubAppConfig = {
  appId: string;
  installationId: string;
  privateKey: string;
  committerName: string;
  committerEmail: string;
};

type CachedInstallationToken = {
  token: string;
  expiresAt: number;
  installationId: string;
};

export type GitHubRepoFile = {
  sha: string;
  path: string;
  content: string;
  htmlUrl: string;
};

export type GitHubUpsertResult = {
  commitSha: string;
  commitUrl: string;
  path: string;
  fileSha: string;
};

export type GitHubPRResult = {
  id: number;
  number: number;
  htmlUrl: string;
  state: string;
  title: string;
};

let cachedInstallationToken: CachedInstallationToken | null = null;

const normalizeText = (value: unknown) => String(value || '').trim();

const toBase64Url = (value: Buffer | string) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const normalizePrivateKey = (value: unknown) => {
  const raw = normalizeText(value);
  if (!raw) return '';

  const withNewlines = raw.replace(/\\n/g, '\n');
  if (withNewlines.includes('BEGIN') && withNewlines.includes('PRIVATE KEY')) {
    return withNewlines;
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/\\n/g, '\n');
    if (decoded.includes('BEGIN') && decoded.includes('PRIVATE KEY')) {
      return decoded;
    }
  } catch {
    // Ignore invalid base64 and fall through to empty return.
  }

  return '';
};

function readGitHubAppConfig(): GitHubAppConfig {
  const appId = normalizeText(import.meta.env.GITHUB_APP_ID);
  const installationId = normalizeText(import.meta.env.GITHUB_APP_INSTALLATION_ID);
  const privateKey = normalizePrivateKey(import.meta.env.GITHUB_APP_PRIVATE_KEY);
  const committerName = normalizeText(import.meta.env.GITHUB_APP_COMMITTER_NAME) || 'musiki editor';
  const committerEmail = normalizeText(import.meta.env.GITHUB_APP_COMMITTER_EMAIL) || 'noreply@musiki.org.ar';

  if (!appId || !installationId || !privateKey) {
    throw new Error('GITHUB_APP_NOT_CONFIGURED');
  }

  return {
    appId,
    installationId,
    privateKey,
    committerName,
    committerEmail,
  };
}

export function isGitHubAppConfigured(): boolean {
  try {
    readGitHubAppConfig();
    return true;
  } catch {
    return false;
  }
}

function createAppJwt(config: GitHubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: config.appId,
  }));
  const unsigned = `${header}.${payload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(config.privateKey);

  return `${unsigned}.${toBase64Url(signature)}`;
}

async function githubApiRequest(
  requestPath: string,
  options: {
    method?: string;
    token: string;
    body?: unknown;
  },
): Promise<any> {
  const response = await fetch(`${GITHUB_API_BASE}${requestPath}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'musiki-framework',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const apiMessage = normalizeText(payload?.message);
    throw new Error(apiMessage || `GitHub API error ${response.status}`);
  }

  return payload;
}

async function getInstallationToken(): Promise<string> {
  const config = readGitHubAppConfig();
  const now = Date.now();
  if (
    cachedInstallationToken &&
    cachedInstallationToken.installationId === config.installationId &&
    cachedInstallationToken.expiresAt - 60_000 > now
  ) {
    return cachedInstallationToken.token;
  }

  const appJwt = createAppJwt(config);
  const payload = await githubApiRequest(
    `/app/installations/${encodeURIComponent(config.installationId)}/access_tokens`,
    {
      method: 'POST',
      token: appJwt,
    },
  );

  const token = normalizeText(payload?.token);
  const expiresAt = Date.parse(String(payload?.expires_at || ''));
  if (!token || Number.isNaN(expiresAt)) {
    throw new Error('GitHub installation token response was incomplete');
  }

  cachedInstallationToken = {
    token,
    expiresAt,
    installationId: config.installationId,
  };
  return token;
}

function splitRepoFullName(repoFullName: string) {
  const normalized = normalizeText(repoFullName);
  const [owner, repo] = normalized.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository identifier "${repoFullName}"`);
  }
  return { owner, repo };
}

export async function getRepoFile(options: {
  repoFullName: string;
  path: string;
  ref?: string;
}): Promise<GitHubRepoFile | null> {
  const { owner, repo } = splitRepoFullName(options.repoFullName);
  const normalizedPath = normalizeText(options.path).split('/').map(encodeURIComponent).join('/');
  const ref = normalizeText(options.ref);
  const requestPath = `/repos/${owner}/${repo}/contents/${normalizedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const token = await getInstallationToken();

  try {
    const payload = await githubApiRequest(requestPath, { token });
    const rawContent = String(payload?.content || '').replace(/\n/g, '');
    const content = rawContent ? Buffer.from(rawContent, 'base64').toString('utf8') : '';
    return {
      sha: normalizeText(payload?.sha),
      path: normalizeText(payload?.path),
      content,
      htmlUrl: normalizeText(payload?.html_url),
    };
  } catch (error: any) {
    if (String(error?.message || '').includes('Not Found')) return null;
    throw error;
  }
}

export async function upsertRepoFile(options: {
  repoFullName: string;
  branch: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
  authorName: string;
  authorEmail: string;
}): Promise<GitHubUpsertResult> {
  const config = readGitHubAppConfig();
  const { owner, repo } = splitRepoFullName(options.repoFullName);
  const normalizedPath = normalizeText(options.path).split('/').map(encodeURIComponent).join('/');
  const token = await getInstallationToken();

  const payload = await githubApiRequest(
    `/repos/${owner}/${repo}/contents/${normalizedPath}`,
    {
      method: 'PUT',
      token,
      body: {
        message: normalizeText(options.message),
        content: Buffer.from(options.content, 'utf8').toString('base64'),
        branch: normalizeText(options.branch) || 'main',
        sha: normalizeText(options.sha) || undefined,
        author: {
          name: normalizeText(options.authorName) || normalizeText(options.authorEmail) || 'musiki teacher',
          email: normalizeText(options.authorEmail) || config.committerEmail,
        },
        committer: {
          name: config.committerName,
          email: config.committerEmail,
        },
      },
    },
  );

  return {
    commitSha: normalizeText(payload?.commit?.sha),
    commitUrl: normalizeText(payload?.commit?.html_url),
    path: normalizeText(payload?.content?.path || options.path),
    fileSha: normalizeText(payload?.content?.sha),
  };
}

export async function createBranch(options: {
  repoFullName: string;
  branchName: string;
  baseBranch?: string;
}): Promise<string> {
  const { owner, repo } = splitRepoFullName(options.repoFullName);
  const baseBranch = normalizeText(options.baseBranch) || 'main';
  const token = await getInstallationToken();

  const baseRefPayload = await githubApiRequest(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    { token },
  );
  const baseSha = normalizeText(baseRefPayload?.object?.sha);
  if (!baseSha) {
    throw new Error(`Could not find SHA for base branch "${baseBranch}"`);
  }

  const payload = await githubApiRequest(
    `/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      token,
      body: {
        ref: `refs/heads/${normalizeText(options.branchName)}`,
        sha: baseSha,
      },
    },
  );

  return normalizeText(payload?.object?.sha);
}

export async function createPullRequest(options: {
  repoFullName: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<GitHubPRResult> {
  const { owner, repo } = splitRepoFullName(options.repoFullName);
  const token = await getInstallationToken();

  const payload = await githubApiRequest(
    `/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      token,
      body: {
        title: normalizeText(options.title),
        body: normalizeText(options.body),
        head: normalizeText(options.head),
        base: normalizeText(options.base),
      },
    },
  );

  return {
    id: Number(payload?.id),
    number: Number(payload?.number),
    htmlUrl: normalizeText(payload?.html_url),
    state: normalizeText(payload?.state),
    title: normalizeText(payload?.title),
  };
}
