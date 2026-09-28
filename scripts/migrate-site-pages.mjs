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
  const args = { dryRun: false, allowExisting: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--allow-existing') args.allowExisting = true;
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
      'Usage: node scripts/migrate-site-pages.mjs --manifest <path> --author-email <email> [--dry-run] [--allow-existing]',
      '',
      '  --manifest <path>      path to scripts/site-migration.json (so-web repo)',
      '  --author-email <email> email of the so space author (must have role "author")',
      '  --dry-run              read-only: prints the plan, makes no changes',
      '  --allow-existing       proceed even if the Site root already has folders/',
      '                         notes not named in the manifest (default: refuse)',
      '',
      'The end-of-run rebuild trigger (requestSiteRebuild) only does anything on a',
      'host where SO_REBUILD_TRIGGER (or the default /opt/so/.rebuild-requested)',
      'is watched by the so-web rebuild watcher — i.e. the VPS. Elsewhere it just',
      'touches/creates that local file harmlessly.',
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

/**
 * Refuses to proceed (unless --allow-existing) when the Site root already
 * has folders or root-level notes this manifest doesn't know about — a
 * signal that the Site tree has content from somewhere else (manual studio
 * edits, a different migration, a partially-run manifest with a since-
 * edited title) that a name/slug-keyed idempotency check could otherwise
 * silently coexist with in a confusing way. Only checks the Site root
 * (this migration's own folders + planMigration's idempotency check inside
 * each section already handles children safely).
 */
function assertSiteRootMatchesManifest(manifest, existing) {
  const manifestRootFolderTitles = new Set(manifest.items.filter((item) => item.kind === 'folder' && item.parent === null).map((item) => item.title));

  const unexpectedFolders = existing.folders.filter((f) => f.parentName === null && !manifestRootFolderTitles.has(f.name)).map((f) => f.name);
  const unexpectedNotes = existing.notes.filter((n) => n.folderName === '(site-root)').map((n) => n.slug);

  if (unexpectedFolders.length === 0 && unexpectedNotes.length === 0) return;

  const lines = ['Site root already contains folders/notes this manifest does not know about:'];
  if (unexpectedFolders.length > 0) lines.push(`  folders: ${unexpectedFolders.join(', ')}`);
  if (unexpectedNotes.length > 0) lines.push(`  root notes (slug): ${unexpectedNotes.join(', ')}`);
  lines.push('Refusing to proceed (idempotency here is by name/slug, not id, so unrelated', 'content could otherwise be silently left in place or collide). Pass --allow-existing', 'to proceed anyway once you have confirmed this is expected.');
  throw new Error(lines.join('\n'));
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
      // No explicit visibility: omitting it (-> null) lets the folder
      // inherit from its parent (ultimately Site), same as every other
      // Site folder — so setting Site private (or any ancestor) actually
      // unpublishes these pages, instead of a hardcoded 'public' here
      // silently overriding that.
      const folder = await createSpaceFolder(query, {
        spaceId,
        userId: authorId,
        parentId: parentId ?? null,
        name: step.title,
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

  if (!args.allowExisting) {
    assertSiteRootMatchesManifest(manifest, existing);
  }

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

  // requestSiteRebuild() itself never throws (errors are caught and
  // logged inside it) — awaiting it just makes sure the trigger file is
  // actually touched/created before this one-time script exits, rather
  // than racing process.exit() against an in-flight fs write.
  await requestSiteRebuild();

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
