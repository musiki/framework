#!/usr/bin/env node
// One-time import (Task 3 of the soog-dashboard plan): imports the Obsidian
// case-instrument notes into the so studio as notes under a `Cases` folder
// (subfolders `Instruments` and `Instruments (fictional)`), so the source
// of truth for the MOAIE dashboard becomes studio notes instead of the
// vault. See docs/superpowers/specs/2026-09-28-soog-dashboard-design.md §1
// and docs/superpowers/plans/2026-09-28-soog-dashboard.md (Task 3).
//
// Usage:
//   node scripts/import-case-instruments.mjs --vault <dir> --author-email <email> [--dry-run]
//   node scripts/import-case-instruments.mjs --vault <dir> --offline --dry-run
//
// Runs under plain `node` — no --experimental-strip-types flag, ts-node or
// tsx needed (Node 24 strips types from imported .ts files natively; see
// the matching comment in scripts/migrate-site-pages.mjs).
//
// `--vault <dir>` is the vault's `cases` directory (read-only), containing
// `case instruments/` (-> studio folder `Instruments`) and
// `case instruments fictional/` (-> studio folder `Instruments (fictional)`).
// Every `.md` file whose frontmatter parses is imported, regardless of its
// `type` (the studio is the source of truth; the public endpoint still
// filters to `type: instrument` on read — see Task 2 — so the author fixes
// a note's type online afterwards). Non-`.md` files (e.g. a `.base` file)
// are ignored entirely. Only files whose frontmatter fails to parse at all
// are skipped (reported with the parser's message).
//
// `--offline` skips the database entirely (no .env read, no pg Pool) and
// only requires `--dry-run` — it prints the file-level plan (what the vault
// alone says should happen) without knowing what the studio already has,
// so its "already imported" group is always empty. Without `--offline`, a
// `--dry-run` still connects (read-only) to resolve the so tenant's
// dissertation space and its current `Cases` tree, so the printed plan
// reflects reality, same as migrate-site-pages.mjs.
//
// Idempotency is by (folder, title) — never by id, since a later re-run has
// no ids from an earlier run to compare against. `Cases` itself, and its
// two subfolders, are reused by name if they already exist.
//
// This script deliberately does NOT trigger a so-web rebuild: the
// soog-dashboard plugin reads the endpoint live in the browser (see the
// design's "Live data, no rebuild" decision), so there is nothing for a
// rebuild to publish here.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import { createSpaceFolder, createSpaceNote } from '../src/lib/writing/notes/space-notes-core.ts';
import { planInstrumentImport } from '../src/lib/instruments/import-plan.ts';
import { cleanTemplater } from '../src/lib/instruments/projection.ts';

const TENANT_ID = 'so';
const SPACE_SLUG = 'dissertation';
const CASES_ROOT = 'Cases';

/** Vault subdirectory name -> studio Cases subfolder name. */
const VAULT_FOLDERS = [
  { dir: 'case instruments', folder: 'Instruments' },
  { dir: 'case instruments fictional', folder: 'Instruments (fictional)' },
];

// This script deliberately does NOT import src/lib/db/pool.ts: that module
// reads `import.meta.env.DATABASE_URL` as a fallback at import time, which
// throws under plain node (no Vite/Astro `import.meta.env`) whenever
// DATABASE_URL isn't already set in the environment — including for
// argument-only invocations like `--help` or `--offline --dry-run`, since
// ES module imports run before this script's own code. `query` below is a
// minimal, QueryFn-compatible ({ data, error }) equivalent built directly
// on `pg`, created lazily (see `getQuery`) so nothing touches the database
// until a real command actually needs to — and never at all in `--offline`
// mode.
let pool;
let queryFn;
function getQuery() {
  if (queryFn) return queryFn;
  loadDotEnvIfNeeded();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (checked process.env and ./.env)');
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  queryFn = async (text, params = []) => {
    try {
      const res = await pool.query(text, params);
      return { data: res.rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };
  return queryFn;
}

// ---------------------------------------------------------------------------
// env / args
// ---------------------------------------------------------------------------

/**
 * This script runs outside Astro's own env loading, so it needs
 * DATABASE_URL itself. If the environment already has it (CI, an operator's
 * shell, `DATABASE_URL=... node scripts/import-case-instruments.mjs ...`)
 * this is a no-op; otherwise it does a minimal manual `.env` parse,
 * matching the pattern already used by scripts/migrate-site-pages.mjs (no
 * `dotenv` package dependency needed). Never called in `--offline` mode.
 */
function loadDotEnvIfNeeded() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = { dryRun: false, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--offline') args.offline = true;
    else if (arg === '--vault') args.vault = argv[++i];
    else if (arg === '--author-email') args.authorEmail = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unrecognized argument: ${arg}`);
    }
  }
  if (args.help) return args;
  if (!args.vault) throw new Error('--vault <dir> is required');
  if (args.offline && !args.dryRun) {
    throw new Error('--offline only makes sense with --dry-run (it never touches the database, so nothing could actually be written)');
  }
  if (!args.offline && !args.authorEmail) {
    throw new Error('--author-email <email> is required (unless --offline)');
  }
  return args;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/import-case-instruments.mjs --vault <dir> --author-email <email> [--dry-run]',
      '       node scripts/import-case-instruments.mjs --vault <dir> --offline --dry-run',
      '',
      '  --vault <dir>          path to the vault\'s "cases" directory (read-only),',
      '                         containing "case instruments/" and',
      '                         "case instruments fictional/"',
      '  --author-email <email> email of the so space author (must have role "author");',
      '                         required unless --offline',
      '  --dry-run              read-only: prints the plan, makes no changes',
      '  --offline              skip the database entirely (no .env read, no DB',
      '                         connection) and print only the file-level plan;',
      '                         requires --dry-run',
      '',
      'Imports every ".md" file under those two vault subdirectories as a studio',
      'note under Cases/Instruments or Cases/Instruments (fictional), regardless',
      'of its frontmatter `type` (the public endpoint filters to `type: instrument`',
      'on read; fix a note\'s type online after import). Only files whose',
      'frontmatter fails to parse are skipped. Frontmatter is kept verbatim except',
      'for Templater tags (e.g. "<% tp.date.now(...) %>"), which are replaced with',
      'today\'s date. Idempotent by (folder, title) — a re-run only creates what is',
      'still missing.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// vault reading
// ---------------------------------------------------------------------------

/** Reads every `.md` file directly under `vaultDir/<VAULT_FOLDERS[].dir>`
 * into `ImportFile`s. Skips non-.md and dotfiles; does not recurse (the
 * vault's case-instrument folders are flat). Missing subdirectories are
 * treated as empty rather than an error, since the fictional set in
 * particular may not exist in every vault layout. */
function readVaultFiles(vaultDir) {
  const files = [];
  for (const { dir, folder } of VAULT_FOLDERS) {
    const dirPath = path.join(vaultDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    const names = fs.readdirSync(dirPath).filter((name) => name.endsWith('.md') && !name.startsWith('.'));
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const markdown = fs.readFileSync(path.join(dirPath, name), 'utf8');
      files.push({ folder, name, markdown });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// resolve space / author (online only)
// ---------------------------------------------------------------------------

function asError(error) {
  return error instanceof Error ? error : new Error(String(error?.message ?? error));
}

async function resolveSpaceId(query) {
  const { data, error } = await query(`SELECT id FROM "Space" WHERE "tenantId" = $1 AND slug = $2 LIMIT 1`, [TENANT_ID, SPACE_SLUG]);
  if (error) throw asError(error);
  const spaceId = data?.[0]?.id;
  if (!spaceId) throw new Error(`no ${TENANT_ID}/${SPACE_SLUG} space found`);
  return spaceId;
}

/** Resolves --author-email to a userId, requiring that user to already be
 * this space's `author` (the only role `createSpaceFolder`/`createSpaceNote`
 * accept for mutations) — so a typo'd or wrong email fails fast with a
 * clear message instead of a confusing 403 deep inside the core module. */
async function resolveAuthorId(query, spaceId, email) {
  const normalized = email.toLowerCase().trim();

  const { data: ueRows, error: ueErr } = await query(`SELECT "userId" FROM "UserEmail" WHERE "email" = $1`, [normalized]);
  if (ueErr) throw asError(ueErr);
  let userId = ueRows?.[0]?.userId;

  if (!userId) {
    const { data: uRows, error: uErr } = await query(`SELECT id FROM "User" WHERE lower(email) = $1 LIMIT 1`, [normalized]);
    if (uErr) throw asError(uErr);
    userId = uRows?.[0]?.id;
  }
  if (!userId) throw new Error(`no user found for --author-email ${email}`);

  const { data: memberRows, error: memberErr } = await query(
    `SELECT role FROM "SpaceMember" WHERE "spaceId" = $1 AND "userId" = $2::uuid LIMIT 1`,
    [spaceId, userId],
  );
  if (memberErr) throw asError(memberErr);
  const role = memberRows?.[0]?.role;
  if (role !== 'author') {
    throw new Error(`--author-email ${email} is not the author of the ${TENANT_ID}/${SPACE_SLUG} space (role: ${role ?? 'not a member'})`);
  }
  return userId;
}

// ---------------------------------------------------------------------------
// current Cases tree -> planInstrumentImport's `existing` shape
// ---------------------------------------------------------------------------

/**
 * Reads the space's folder/note listing and reduces it to what
 * `planInstrumentImport` needs: the current Cases root folder id (if any),
 * the two subfolders' ids (created on demand by `ensureCasesFolders` before
 * this is called for a real run; absent in dry-run when they don't exist
 * yet), and the existing (folder, title) pairs directly under each
 * subfolder — never by id, since a later re-run has no ids from an earlier
 * run to compare against.
 */
async function loadCasesTree(query, spaceId) {
  const { data: folderRows, error: fErr } = await query(`SELECT id, "parentId", name FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`, [
    spaceId,
  ]);
  if (fErr) throw asError(fErr);
  const folders = folderRows ?? [];

  const casesFolder = folders.find((f) => f.parentId === null && f.name === CASES_ROOT);
  const subfolderIdByName = new Map();
  if (casesFolder) {
    for (const { folder } of VAULT_FOLDERS) {
      const sub = folders.find((f) => f.parentId === casesFolder.id && f.name === folder);
      if (sub) subfolderIdByName.set(folder, sub.id);
    }
  }

  const existing = [];
  if (subfolderIdByName.size > 0) {
    const subfolderIds = [...subfolderIdByName.values()];
    const idToFolderName = new Map([...subfolderIdByName.entries()].map(([name, id]) => [id, name]));
    const { data: noteRows, error: nErr } = await query(`SELECT "folderId", title FROM "LiveClassNote" WHERE "spaceId" = $1`, [spaceId]);
    if (nErr) throw asError(nErr);
    for (const n of noteRows ?? []) {
      const folderName = idToFolderName.get(n.folderId);
      if (folderName) existing.push({ folder: folderName, title: n.title });
    }
  }

  return { casesFolderId: casesFolder?.id ?? null, subfolderIdByName, existing };
}

/** Idempotently ensures `Cases` (explicit visibility `public`) and its two
 * subfolders (inherited visibility — no `visibility` passed) exist,
 * creating whichever are still missing. Reuses folders already present by
 * name, same idempotency rule as everywhere else in this script. */
async function ensureCasesFolders(query, { spaceId, authorId, casesFolderId, subfolderIdByName }) {
  let rootId = casesFolderId;
  if (!rootId) {
    const root = await createSpaceFolder(query, { spaceId, userId: authorId, parentId: null, name: CASES_ROOT, visibility: 'public' });
    rootId = root.id;
    console.log(`  CREATE folder (root) / ${CASES_ROOT}  [visibility: public]`);
  }

  const idByFolder = new Map(subfolderIdByName);
  for (const { folder } of VAULT_FOLDERS) {
    if (idByFolder.has(folder)) continue;
    const sub = await createSpaceFolder(query, { spaceId, userId: authorId, parentId: rootId, name: folder });
    idByFolder.set(folder, sub.id);
    console.log(`  CREATE folder ${CASES_ROOT} / ${folder}  [visibility: inherited]`);
  }

  return idByFolder;
}

// ---------------------------------------------------------------------------
// plan output
// ---------------------------------------------------------------------------

// The studio is the source of truth (see import-plan.ts): every parseable
// note is created regardless of `type` — the public endpoint (Task 2)
// still filters to `type: instrument` on read, so the author fixes a
// note's type online afterwards. Only 'exists' (idempotent re-run) and
// 'parse-error' are still skipped. Each 'create' step carries a per-type
// bucket (`instrument` / `box` / `none` / `other`) so the operator sees at
// plan time what the endpoint will actually show once imported.
const GROUPS = [
  { key: 'create', label: 'to create', match: (s) => s.action === 'create' },
  { key: 'exists', label: 'already imported (exists)', match: (s) => s.action === 'skip' && s.reason === 'exists' },
  { key: 'parse-error', label: 'skipped: frontmatter parse error', match: (s) => s.action === 'skip' && s.reason === 'parse-error' },
];

const TYPE_BUCKETS = ['instrument', 'box', 'none', 'other'];

function printPlan(steps, { dryRun }) {
  const prefix = dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}${steps.length} vault file(s) considered:`);
  for (const group of GROUPS) {
    const inGroup = steps.filter(group.match);
    console.log(`\n${group.label} (${inGroup.length}):`);
    for (const step of inGroup) {
      const extra = step.action === 'skip' && step.reason === 'parse-error' && step.message ? `  — ${step.message}` : '';
      const typeTag = step.action === 'create' ? `  [type: ${step.type}]` : '';
      console.log(`  ${step.folder} / ${step.title}${typeTag}${extra}`);
    }
  }

  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, steps.filter(g.match).length]));
  const creates = steps.filter((s) => s.action === 'create');
  const typeCounts = Object.fromEntries(TYPE_BUCKETS.map((t) => [t, creates.filter((s) => s.type === t).length]));

  console.log(
    `\n${counts.create} to create (by frontmatter type: ${TYPE_BUCKETS.map((t) => `${t}=${typeCounts[t]}`).join(', ')}), ` +
      `${counts.exists} already imported, ${counts['parse-error']} parse errors.`,
  );
}

// ---------------------------------------------------------------------------
// apply plan (online only)
// ---------------------------------------------------------------------------

async function applyPlan(query, steps, { spaceId, authorId, subfolderIdByName, today }) {
  for (const step of steps) {
    if (step.action !== 'create') continue;
    const parentId = subfolderIdByName.get(step.folder);
    if (!parentId) throw new Error(`create "${step.title}": folder "${step.folder}" was not found or created yet`);
    const body = cleanTemplater(step.markdown, today);
    await createSpaceNote(query, { spaceId, userId: authorId, folderId: parentId, title: step.title, body });
    console.log(`  CREATE note ${step.folder} / ${step.title}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const vaultDir = path.resolve(args.vault);
  const files = readVaultFiles(vaultDir);
  const today = new Date().toISOString().slice(0, 10);

  if (args.offline) {
    const steps = planInstrumentImport(files, []);
    printPlan(steps, { dryRun: true });
    console.log('\n[offline] no database contacted, no changes made.');
    return;
  }

  const query = getQuery();
  const spaceId = await resolveSpaceId(query);
  const authorId = await resolveAuthorId(query, spaceId, args.authorEmail);

  const { casesFolderId, subfolderIdByName, existing } = await loadCasesTree(query, spaceId);
  const steps = planInstrumentImport(files, existing);

  if (args.dryRun) {
    printPlan(steps, { dryRun: true });
    console.log('\n[dry-run] no changes made.');
    return;
  }

  const idByFolder = await ensureCasesFolders(query, { spaceId, authorId, casesFolderId, subfolderIdByName });
  printPlan(steps, { dryRun: false });
  await applyPlan(query, steps, { spaceId, authorId, subfolderIdByName: idByFolder, today });

  console.log('\ndone.');
}

main()
  .then(async () => {
    if (pool) await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    if (pool) await pool.end();
    process.exit(1);
  });
