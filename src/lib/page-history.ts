import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveCourseSource } from './content-admin';

export type PageHistoryEntry = {
  author: string;
  email: string;
  date: string;
  sha: string;
  shortSha: string;
  url: string | null;
  compareUrl: string | null;
};

export type PageHistoryInfo = {
  uploaderAuthor: string;
  uploaderDate: string;
  lastAuthor: string;
  lastDate: string;
  commitSha: string;
  commitUrl: string | null;
  historyEntries: PageHistoryEntry[];
  repoFullName: string;
  sourcePath: string;
};

const UNKNOWN_INFO: PageHistoryInfo = {
  uploaderAuthor: 'Unknown',
  uploaderDate: 'Unknown',
  lastAuthor: 'Unknown',
  lastDate: 'Unknown',
  commitSha: 'Unknown',
  commitUrl: null,
  historyEntries: [],
  repoFullName: '',
  sourcePath: '',
};

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeRepoPath = (value: unknown) => normalizeText(value).replace(/\\/g, '/').replace(/^\/+/, '');
const formatDate = (iso: string) => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
};

function isGitWorkingTree(dirPath: string): boolean {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  try {
    execFileSync('git', ['-C', dirPath, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

function resolveSourceRepoRoot(courseId: string): { root: string; repoFullName: string } | null {
  const source = resolveCourseSource(courseId);
  if (!source?.id) return null;

  const candidates = [
    normalizeText(source.localPath) ? path.resolve(process.cwd(), normalizeText(source.localPath)) : '',
    path.join(process.cwd(), '.content-sources', source.id),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isGitWorkingTree(candidate)) {
      return {
        root: candidate,
        repoFullName: normalizeText(source.repo),
      };
    }
  }

  return null;
}

export function getCoursePageHistory(courseId: string, sourcePath: string): PageHistoryInfo {
  const normalizedCourseId = normalizeText(courseId);
  const normalizedSourcePath = normalizeRepoPath(sourcePath);
  if (!normalizedCourseId || !normalizedSourcePath) return UNKNOWN_INFO;

  const repoInfo = resolveSourceRepoRoot(normalizedCourseId);
  if (!repoInfo?.root) {
    return {
      ...UNKNOWN_INFO,
      repoFullName: repoInfo?.repoFullName || '',
      sourcePath: normalizedSourcePath,
    };
  }

  try {
    const historyRaw = execFileSync(
      'git',
      ['-C', repoInfo.root, 'log', '--follow', '--format=%an|%ae|%cI|%H', '--', normalizedSourcePath],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      },
    ).trim();

    const commits = historyRaw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name = '', email = '', date = '', sha = ''] = line.split('|');
        return { name, email, date, sha };
      })
      .filter((entry) => normalizeText(entry.sha));

    if (commits.length === 0) {
      return {
        ...UNKNOWN_INFO,
        repoFullName: repoInfo.repoFullName,
        sourcePath: normalizedSourcePath,
      };
    }

    const newest = commits[0];
    const oldest = commits[commits.length - 1];
    const repoFullName = normalizeText(repoInfo.repoFullName);
    const commitUrl =
      repoFullName && newest.sha
        ? `https://github.com/${repoFullName}/commit/${newest.sha}`
        : null;

    const historyEntries = commits.map((commit, index) => {
      const older = commits[index + 1];
      return {
        author: commit.name || commit.email || 'Unknown',
        email: commit.email || '',
        date: formatDate(commit.date),
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        url: repoFullName ? `https://github.com/${repoFullName}/commit/${commit.sha}` : null,
        compareUrl:
          repoFullName && older?.sha
            ? `https://github.com/${repoFullName}/compare/${older.sha}...${commit.sha}`
            : null,
      };
    });

    return {
      uploaderAuthor: oldest.name || oldest.email || 'Unknown',
      uploaderDate: formatDate(oldest.date),
      lastAuthor: newest.name || newest.email || 'Unknown',
      lastDate: formatDate(newest.date),
      commitSha: newest.sha || 'Unknown',
      commitUrl,
      historyEntries,
      repoFullName,
      sourcePath: normalizedSourcePath,
    };
  } catch (error) {
    console.warn(`[page-history] Failed to get git history for ${normalizedSourcePath}:`, error);
    return {
      ...UNKNOWN_INFO,
      repoFullName: repoInfo.repoFullName,
      sourcePath: normalizedSourcePath,
    };
  }
}
