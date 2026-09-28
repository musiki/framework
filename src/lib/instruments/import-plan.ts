// Pure planning for the one-time case-instruments import
// (scripts/import-case-instruments.mjs): turns a list of vault files under
// `Instruments` / `Instruments (fictional)` into an ordered list of
// create/skip steps against the so studio's `Cases` folder tree.
//
// No astro/db imports — usable from plain `node --test` runs and from the
// import script alike.

import matter from 'gray-matter';
import { cleanTemplater } from './projection.ts';

export type CasesSubfolder = 'Instruments' | 'Instruments (fictional)';

export type ImportFile = {
  folder: CasesSubfolder;
  /** File name including `.md`; the note title is this with `.md` stripped. */
  name: string;
  markdown: string;
};

export type ExistingNote = { folder: string; title: string };

export type CreateStep = {
  action: 'create';
  folder: CasesSubfolder;
  title: string;
  markdown: string;
};

export type SkipStep = {
  action: 'skip';
  folder: CasesSubfolder;
  title: string;
  reason: 'not-instrument' | 'exists' | 'parse-error';
  /** Set only for `reason: 'parse-error'` — the parser's own short message
   * (e.g. a duplicated-key or bad-alias complaint from js-yaml), so the
   * import script can report which files need a manual frontmatter fix. */
  message?: string;
};

export type ImportStep = CreateStep | SkipStep;

const key = (folder: string, title: string) => `${folder}\u0000${title}`;

function firstLine(message: string): string {
  return message.split('\n')[0].trim();
}

/** Reads frontmatter `type`, retrying once through `cleanTemplater` on a
 * parse throw (mirrors `projectInstrument`'s robust parsing). Distinguishes
 * "parsed fine, just not an instrument note" from "couldn't parse the
 * frontmatter at all" (even after Templater cleanup) — the latter is a
 * distinct, actionable skip reason, not silently folded into
 * `not-instrument`. */
function readType(markdown: string): { type: unknown } | { error: string } {
  // `{}` opts both calls out of gray-matter's content-keyed cache — see
  // the matching comment in projection.ts's parseFrontmatterRobust for why
  // that cache would otherwise turn the retry into a silent, wrong
  // "no type" result instead of a genuine parse-error.
  try {
    return { type: matter(markdown, {}).data?.type };
  } catch {
    // fall through to the Templater-cleaned retry
  }
  try {
    return { type: matter(cleanTemplater(markdown), {}).data?.type };
  } catch (e) {
    const error = e instanceof Error && e.message ? firstLine(e.message) : 'frontmatter parse error';
    return { error };
  }
}

/**
 * Plans the import: skips files whose frontmatter `type` isn't
 * `'instrument'`, then skips anything already present at (folder, title)
 * in `existing` (idempotent re-run), and creates the rest. Note title is
 * always the file name with `.md` stripped — never a frontmatter `title`
 * field, since a raw file listing (this function's input) doesn't parse
 * frontmatter for anything but the type filter.
 */
export function planInstrumentImport(files: ImportFile[], existing: ExistingNote[]): ImportStep[] {
  const existingKeys = new Set(existing.map((e) => key(e.folder, e.title)));
  const steps: ImportStep[] = [];

  for (const file of files) {
    const title = file.name.replace(/\.md$/, '');
    const parsed = readType(file.markdown);

    if ('error' in parsed) {
      steps.push({
        action: 'skip',
        folder: file.folder,
        title,
        reason: 'parse-error',
        message: parsed.error,
      });
      continue;
    }

    if (parsed.type !== 'instrument') {
      steps.push({ action: 'skip', folder: file.folder, title, reason: 'not-instrument' });
      continue;
    }

    if (existingKeys.has(key(file.folder, title))) {
      steps.push({ action: 'skip', folder: file.folder, title, reason: 'exists' });
      continue;
    }

    steps.push({ action: 'create', folder: file.folder, title, markdown: file.markdown });
  }

  return steps;
}
