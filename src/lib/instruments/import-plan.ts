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
  reason: 'not-instrument' | 'exists';
};

export type ImportStep = CreateStep | SkipStep;

const key = (folder: string, title: string) => `${folder}\u0000${title}`;

function readType(markdown: string): unknown {
  try {
    return matter(markdown).data?.type;
  } catch {
    // fall through
  }
  try {
    return matter(cleanTemplater(markdown)).data?.type;
  } catch {
    return undefined;
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
    const type = readType(file.markdown);

    if (type !== 'instrument') {
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
