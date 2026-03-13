const GITHUB_API_BASE = 'https://api.github.com';

type GitHubConfig = {
  token: string;
  committerName: string;
  committerEmail: string;
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

const normalizeText = (value: unknown) => String(value || '').trim();

function readGitHubConfig(): GitHubConfig {
  // Preferimos process.env para asegurar compatibilidad en build y runtime
  const token = normalizeText(
    process.env.CONTENT_SOURCE_READ_TOKEN || 
    process.env.GITHUB_TOKEN || 
    import.meta.env.CONTENT_SOURCE_READ_TOKEN || 
    import.meta.env.GITHUB_TOKEN
  );
  const committerName = normalizeText(process.env.GITHUB_APP_COMMITTER_NAME || import.meta.env.GITHUB_APP_COMMITTER_NAME) || 'musiki editor';
  const committerEmail = normalizeText(process.env.GITHUB_APP_COMMITTER_EMAIL || import.meta.env.GITHUB_APP_COMMITTER_EMAIL) || 'noreply@musiki.org.ar';

  if (!token) {
    throw new Error('GITHUB_TOKEN_NOT_CONFIGURED');
  }

  return {
    token,
    committerName,
    committerEmail,
  };
}

export function isGitHubAppConfigured(): boolean {
  try {
    readGitHubConfig();
    return true;
  } catch {
    return false;
  }
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
      Authorization: `token ${options.token}`,
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
  const config = readGitHubConfig();

  try {
    const payload = await githubApiRequest(requestPath, { token: config.token });
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
  const config = readGitHubConfig();
  const { owner, repo } = splitRepoFullName(options.repoFullName);
  const normalizedPath = normalizeText(options.path).split('/').map(encodeURIComponent).join('/');

  const payload = await githubApiRequest(
    `/repos/${owner}/${repo}/contents/${normalizedPath}`,
    {
      method: 'PUT',
      token: config.token,
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
  const config = readGitHubConfig();

  const baseRefPayload = await githubApiRequest(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    { token: config.token },
  );
  const baseSha = normalizeText(baseRefPayload?.object?.sha);
  if (!baseSha) {
    throw new Error(`Could not find SHA for base branch "${baseBranch}"`);
  }

  const payload = await githubApiRequest(
    `/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      token: config.token,
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
  const config = readGitHubConfig();

  const payload = await githubApiRequest(
    `/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      token: config.token,
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
