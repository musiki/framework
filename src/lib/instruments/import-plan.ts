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

/** Coarse bucket of a file's frontmatter `type`, reported alongside every
 * `create` step so the operator sees, at plan time, what the dashboard
 * endpoint (which still filters to `type: instrument`, see Task 2) will
 * actually show — the studio, not this script, is the source of truth on
 * what gets imported: every parseable note is created regardless of type,
 * and the author fixes types online afterwards. */
export type NoteTypeBucket = 'instrument' | 'box' | 'none' | 'other';

export type CreateStep = {
  action: 'create';
  folder: CasesSubfolder;
  title: string;
  markdown: string;
  type: NoteTypeBucket;
};

export type SkipStep = {
  action: 'skip';
  folder: CasesSubfolder;
  title: string;
  reason: 'exists' | 'parse-error';
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

/** Classifies a frontmatter `type` value into the coarse bucket reported on
 * each `create` step. Anything falsy or an empty/whitespace-only string is
 * `'none'`; a non-`'instrument'`/`'box'` string (or a non-string value, e.g.
 * a YAML list) is `'other'`. */
function typeBucket(type: unknown): NoteTypeBucket {
  if (type === 'instrument') return 'instrument';
  if (type === 'box') return 'box';
  if (type === undefined || type === null) return 'none';
  if (typeof type === 'string' && type.trim() === '') return 'none';
  return 'other';
}

/**
 * Plans the import: every `.md` file that parses (even without a `type` or
 * with a `type` other than `instrument`) is imported — the studio is the
 * source of truth, and the public endpoint filters to `type: instrument`
 * on read (Task 2), so the author can fix a note's type online after the
 * fact. Only two things are skipped: files whose frontmatter can't be
 * parsed at all (`reason: 'parse-error'`, with the parser's message so the
 * operator can fix them by hand) and files already present at (folder,
 * title) in `existing` (idempotent re-run). Every `create` step carries a
 * `type` bucket (`instrument` / `box` / `none` / `other`) so the operator
 * can see at plan time what the dashboard will actually show. Note title
 * is always the file name with `.md` stripped — never a frontmatter
 * `title` field, since a raw file listing (this function's input) doesn't
 * parse frontmatter for anything but the type bucket.
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

    if (existingKeys.has(key(file.folder, title))) {
      steps.push({ action: 'skip', folder: file.folder, title, reason: 'exists' });
      continue;
    }

    steps.push({ action: 'create', folder: file.folder, title, markdown: file.markdown, type: typeBucket(parsed.type) });
  }

  return steps;
}
