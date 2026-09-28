#!/usr/bin/env node
// One-time migration (Task 7 / Task 8 of the "site pages, menu & plugins"
// plan): creates so.zztt.org's current public pages as notes (and their
// containing folders) under the so studio's `Site` folder, from a manifest
// prepared in so-web (`scripts/site-migration.json` +
// `scripts/site-migration/*.md`, both relative to the manifest path).
//
// Usage:
//   node scripts/migrate-site-pages.mjs --manifest <path> --author-email <email> [--dry-run]
//
// Runs under plain `node` — no --experimental-strip-types flag, ts-node or
// tsx needed. Node 24 strips types from imported .ts files natively (this
// repo's own `node --test` suite already relies on the same thing: its
// .test.mjs files import sibling .ts modules directly — see
// src/lib/site/site-model.test.mjs). If this script is ever run under an
// older Node (< 22.6), add `--experimental-strip-types` to the shebang/
// invocation, or run it via `npx tsx scripts/migrate-site-pages.mjs ...`.
//
// --dry-run still connects to the database (read-only) to resolve the so
// tenant's dissertation space and read its current Site tree, so the
// printed plan reflects reality; it issues no INSERTs. Idempotency is by
// path (folder name under its parent; note slug under its folder) — never
// by id, since a later re-run has no ids from an earlier run to compare
// against.
//
// Task 7 only writes this script. It is deliberately NOT run here against
// staging or prod — that is Task 8, with the user's explicit approval.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import matter from 'gray-matter';

import { ensureOkaFolders, createSpaceFolder, createSpaceNote } from '../src/lib/writing/notes/space-notes-core.ts';
import { requestSiteRebuild } from '../src/lib/site/rebuild.ts';
import { parseFrontmatter, slugify } from '../src/lib/site/frontmatter.ts';
import { planMigration } from '../src/lib/site/migration-plan.ts';

const TENANT_ID = 'so';
const SPACE_SLUG = 'dissertation';

// This script deliberately does NOT import src/lib/db/pool.ts: that module
// reads `import.meta.env.DATABASE_URL` as a fallback at import time, which
// throws under plain node (no Vite/Astro `import.meta.env`) whenever
// DATABASE_URL isn't already set in the environment — including for
// argument-only invocations like `--help`, since ES module imports run
// before this script's own code. `query` below is a minimal,
// QueryFn-compatible ({ data, error }) equivalent built directly on `pg`,
// created lazily (see `getQuery`) so nothing touches the database until a
// real command actually needs to.
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
 * shell, `DATABASE_URL=... node scripts/migrate-site-pages.mjs ...`) this is
 * a no-op; otherwise it does a minimal manual `.env` parse, matching the
 * pattern already used by scripts/pull-sources.mjs in this repo (no
 * `dotenv` package dependency needed).
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
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--author-email') args.authorEmail = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unrecognized argument: ${arg}`);
    }
  }
  if (args.help) return args;
  if (!args.manifest) throw new Error('--manifest <path> is required');
  if (!args.authorEmail) throw new Error('--author-email <email> is required');
  return args;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/migrate-site-pages.mjs --manifest <path> --author-email <email> [--dry-run]',
      '',
      '  --manifest <path>      path to scripts/site-migration.json (so-web repo)',
      '  --author-email <email> email of the so space author (must have role "author")',
      '  --dry-run              read-only: prints the plan, makes no changes',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// resolve space / author
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
 * this space's `author` (the only role `ensureOkaFolders`/`createSpace*`
 * accept for mutations) — so a typo'd or wrong email fails fast with a
 * clear message instead of a confusing 403 deep inside the core module. */
async function resolveAuthorId(query, spaceId, email) {
  const normalized = email.toLowerCase().trim();

  const { data: ueRows, error: ueErr } = await query(`SELECT "userId" FROM "UserEmail" WHERE "email" = $1`, [normalized]);
  if (ueErr) throw asError(ueErr);
  let userId = ueRows?.[0]?.userId;

  if (!userId) {
    const { data: uRows, error: uErr } = await query(`SELECT id FROM "User" WHERE email ILIKE $1 LIMIT 1`, [normalized]);
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
// current Site tree -> migration-plan.ts's ExistingTree shape
// ---------------------------------------------------------------------------

/**
 * Reads the space's full folder/note listing and reduces it to the shape
 * `planMigration` needs: folders/notes one and two levels under `Site`
 * (this migration never nests deeper — Site/<section>/<entry>), keyed by
 * name/slug, never by id (a fresh run has no prior ids to compare against).
 *
 * Also returns `folderIdByPath`, a title -> id map used while applying the
 * plan to resolve a `create-note`/`create-folder` step's parent, for both
 * pre-existing folders (populated here) and folders created earlier in the
 * same run (populated by `applyPlan` as it goes).
 */
async function loadSiteFolderTree(query, spaceId) {
  const { data: folderRows, error: fErr } = await query(`SELECT id, "parentId", name FROM "LiveClassNoteFolder" WHERE "spaceId" = $1`, [
    spaceId,
  ]);
  if (fErr) throw asError(fErr);
  const folders = folderRows ?? [];
  const siteFolder = folders.find((f) => f.parentId === null && f.name === 'Site');
  if (!siteFolder) {
    return { siteFolderId: null, folderIdByPath: new Map(), existing: { folders: [], notes: [] } };
  }

  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const nameOf = (id) => foldersById.get(id)?.name ?? null;

  const siteChildren = folders.filter((f) => f.parentId === siteFolder.id);
  const grandchildren = folders.filter((f) => siteChildren.some((c) => c.id === f.parentId));

  const existingFolders = [
    ...siteChildren.map((f) => ({ name: f.name, parentName: null })),
    ...grandchildren.map((f) => ({ name: f.name, parentName: nameOf(f.parentId) })),
  ];

  const folderIdByPath = new Map();
  for (const f of siteChildren) folderIdByPath.set(f.name, f.id);
  for (const f of grandchildren) if (!folderIdByPath.has(f.name)) folderIdByPath.set(f.name, f.id);

  const relevantFolderIds = new Set([siteFolder.id, ...siteChildren.map((f) => f.id), ...grandchildren.map((f) => f.id)]);

  const { data: noteRows, error: nErr } = await query(`SELECT id, "folderId", title, body FROM "LiveClassNote" WHERE "spaceId" = $1`, [
    spaceId,
  ]);
  if (nErr) throw asError(nErr);
  const notes = (noteRows ?? []).filter((n) => relevantFolderIds.has(n.folderId));

  const existingNotes = notes.map((n) => {
    const { data } = parseFrontmatter(n.body ?? '');
    const slug = data.slug && data.slug.trim() !== '' ? data.slug : slugify(n.title);
    const folderName = n.folderId === siteFolder.id ? '(site-root)' : nameOf(n.folderId);
    return { folderName, slug };
  });

  return { siteFolderId: siteFolder.id, folderIdByPath, existing: { folders: existingFolders, notes: existingNotes } };
}

// ---------------------------------------------------------------------------
// apply plan
// ---------------------------------------------------------------------------

function formatStep(step) {
  const verb = step.action.startsWith('create') ? 'CREATE' : 'SKIP  ';
  const kind = step.action.endsWith('folder') ? 'folder' : 'note  ';
  const where = step.parent === null ? '(site root)' : step.parent;
  const extra = step.action.endsWith('note') ? ` slug=${step.slug}` : '';
  const reason = step.reason ? `  — ${step.reason}` : '';
  return `  ${verb} ${kind} ${where} / ${step.title}${extra}${reason}`;
}

async function applyPlan(query, steps, { spaceId, authorId, siteFolderId, folderIdByPath, manifestDir }) {
  for (const step of steps) {
    if (step.action === 'skip-folder' || step.action === 'skip-note') {
      console.log(formatStep(step));
      continue;
    }

    if (step.action === 'create-folder') {
      const parentId = step.parent === null ? siteFolderId : folderIdByPath.get(step.parent);
      if (step.parent !== null && !parentId) {
        throw new Error(`create-folder "${step.title}": parent folder "${step.parent}" was not found or created yet`);
      }
      const folder = await createSpaceFolder(query, {
        spaceId,
        userId: authorId,
        parentId: parentId ?? null,
        name: step.title,
        visibility: 'public',
      });
      folderIdByPath.set(step.title, folder.id);
      console.log(formatStep(step));
      continue;
    }

    // create-note
    const parentId = folderIdByPath.get(step.parent);
    if (!parentId) throw new Error(`create-note "${step.title}": parent folder "${step.parent}" was not found or created yet`);
    const markdownPath = path.resolve(manifestDir, step.markdownFile);
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    const body = matter.stringify(markdown, step.frontmatter);
    await createSpaceNote(query, { spaceId, userId: authorId, folderId: parentId, title: step.title, body });
    console.log(formatStep(step));
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  loadDotEnvIfNeeded();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const manifestPath = path.resolve(args.manifest);
  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const query = getQuery();
  const spaceId = await resolveSpaceId(query);
  const authorId = await resolveAuthorId(query, spaceId, args.authorEmail);

  if (!args.dryRun) {
    // Idempotent itself (skips folders that already exist) — safe to call
    // every run, matching how every other space-notes mutation path
    // bootstraps GTX/Output/Site on demand.
    await ensureOkaFolders(query, { spaceId, authorId });
  }

  const { siteFolderId, folderIdByPath, existing } = await loadSiteFolderTree(query, spaceId);
  const steps = planMigration(manifest, existing);

  console.log(`${args.dryRun ? '[dry-run] ' : ''}so/${SPACE_SLUG}: plan for ${manifest.items.length} manifest item(s):`);
  for (const step of steps) console.log(formatStep(step));

  const toCreate = steps.filter((s) => s.action.startsWith('create')).length;
  console.log(`${toCreate} to create, ${steps.length - toCreate} already present.`);

  if (args.dryRun) {
    console.log('[dry-run] no changes made.');
    return;
  }

  if (!siteFolderId) throw new Error('Site folder missing after ensureOkaFolders — this should not happen');
  await applyPlan(query, steps, { spaceId, authorId, siteFolderId, folderIdByPath, manifestDir });

  // Fire-and-forget, same as every other Site mutation (see
  // space-notes.ts's triggerRebuild) — never throws, never blocks.
  void requestSiteRebuild();

  console.log('done.');
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
