#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { extractEvalBlocks } from '../lib/eval/extract-eval-blocks.mjs';
import { parseEvalBlock } from '../lib/eval/parse-eval-block.mjs';

const { Pool } = pg;

const cwd = process.cwd();
const contentRoot = path.resolve(cwd, 'src/content/cursos');
const envPath = path.resolve(cwd, '.env');

const normalizeText = (value) => String(value || '').trim();
const normalizeSlugPath = (value) => normalizeText(value).replace(/^\/+|\/+$/g, '');
const isMarkdownFile = (value) => /\.(md|mdx)$/i.test(String(value || ''));

const sanitizeFallbackId = (value) =>
  normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeContentSegment = (value, { keepIndex = false } = {}) => {
  const cleaned = normalizeText(String(value || '').replace(/\.(md|mdx)$/i, ''));
  if (!cleaned) return '';
  if (keepIndex && cleaned === '_index') return cleaned;
  return cleaned.replace(/\s+/g, '-').toLowerCase();
};

const toContentEntryId = (absoluteFilePath) => {
  const relativePath = path.relative(contentRoot, absoluteFilePath);
  if (!relativePath || relativePath.startsWith('..')) return '';

  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length === 0) return '';

  return parts
    .map((part, index) =>
      normalizeContentSegment(part, { keepIndex: index === parts.length - 1 }),
    )
    .filter(Boolean)
    .join('/');
};

const walkFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];

  const files = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  return files.sort();
};

const loadDotEnv = () => {
  if (!fs.existsSync(envPath)) return;
  const source = fs.readFileSync(envPath, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue;
  }
};

const resolvePool = () => {
  loadDotEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  
  return new Pool({
    connectionString,
    max: 5,
  });
};

const isSystemMetaAssignmentRef = (value) => {
  const normalized = normalizeSlugPath(value);
  if (!normalized) return false;
  return normalized.includes('/__meta__/') || normalized.startsWith('__meta__:');
};

const isSystemMetaAssignment = (assignment) =>
  isSystemMetaAssignmentRef(assignment?.id) || isSystemMetaAssignmentRef(assignment?.slug);

const buildLiveAssignments = () => {
  const files = walkFiles(contentRoot).filter(isMarkdownFile);
  const liveAssignments = new Map();

  files.forEach((filePath) => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entryId = toContentEntryId(filePath);
    const courseId = normalizeText(entryId.split('/')[0]);
    if (!entryId || !courseId) return;

    extractEvalBlocks(raw, {
      sourcePath: `cursos/${entryId}`,
      fallbackIdBase: sanitizeFallbackId(entryId) || 'cursos-entry',
    }).forEach((block, index) => {
      const parsed = parseEvalBlock(block, {
        fallbackId: `${sanitizeFallbackId(entryId) || 'cursos-entry'}-eval-${index + 1}`,
      });

      if (!parsed || typeof parsed !== 'object') return;

      const evalId = normalizeText(parsed.id);
      if (!evalId) return;

      liveAssignments.set(evalId, {
        id: evalId,
        courseId,
        slug: entryId,
      });
    });
  });

  return liveAssignments;
};

const chunkList = (items, size = 200) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const SUPABASE_CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

const isSupabaseConnectivityError = (error) => {
  const queue = [error];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const code = normalizeText(current?.code).toUpperCase();
    const message = normalizeText(current?.message || current);

    if (SUPABASE_CONNECTIVITY_ERROR_CODES.has(code)) return true;
    if (/fetch failed|network|timed out|timeout|socket hang up|connection reset/i.test(message)) return true;

    if (typeof current === 'object' && current !== null) {
      queue.push(current.cause);
    }
  }

  return false;
};

const formatErrorMessage = (error) => {
  const messages = [];
  const queue = [error];
  const visited = new Set();

  while (queue.length > 0 && messages.length < 3) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const message = normalizeText(current?.message || current);
    const code = normalizeText(current?.code);

    if (message) {
      messages.push(code ? `${message} (${code})` : message);
    }

    if (typeof current === 'object' && current !== null) {
      queue.push(current.cause);
    }
  }

  return messages.join(' -> ') || 'Unknown error';
};

const main = async () => {
  if (!fs.existsSync(contentRoot)) {
    console.log('[eval-db-sync] src/content/cursos not found. Skipping.');
    return;
  }

  const pool = resolvePool();
  if (!pool) {
    console.log('[eval-db-sync] Missing DATABASE_URL env. Skipping.');
    return;
  }

  const liveAssignments = buildLiveAssignments();
  const liveIds = new Set(liveAssignments.keys());

  const { rows: existingAssignments } = await pool.query('SELECT id, slug, "courseId" FROM "Assignment"');
  const existingById = new Map((existingAssignments || []).map((row) => [String(row?.id || ''), row]));

  let inserted = 0;
  let updated = 0;

  for (const liveAssignment of liveAssignments.values()) {
    const existing = existingById.get(liveAssignment.id) || null;

    if (!existing) {
      await pool.query(
        'INSERT INTO "Assignment" (id, "courseId", slug) VALUES ($1, $2, $3)',
        [liveAssignment.id, liveAssignment.courseId, liveAssignment.slug]
      );
      inserted += 1;
      continue;
    }

    const nextSlug = normalizeSlugPath(liveAssignment.slug);
    const nextCourseId = normalizeText(liveAssignment.courseId);
    const currentSlug = normalizeSlugPath(existing?.slug);
    const currentCourseId = normalizeText(existing?.courseId);

    if (currentSlug === nextSlug && currentCourseId === nextCourseId) continue;

    await pool.query(
      'UPDATE "Assignment" SET slug = $1, "courseId" = $2 WHERE id = $3',
      [liveAssignment.slug, liveAssignment.courseId, liveAssignment.id]
    );

    updated += 1;
  }

  const staleAssignments = (existingAssignments || []).filter((assignment) => {
    const assignmentId = normalizeText(assignment?.id);
    if (!assignmentId) return false;
    if (liveIds.has(assignmentId)) return false;
    if (isSystemMetaAssignment(assignment)) return false;
    return true;
  });

  const staleIds = staleAssignments.map((assignment) => normalizeText(assignment?.id)).filter(Boolean);

  let deletedAssignments = 0;
  let deletedSubmissions = 0;

  for (const ids of chunkList(staleIds, 100)) {
    if (ids.length === 0) continue;

    const { rows: staleSubmissions } = await pool.query(
      'SELECT id, "assignmentId" FROM "Submission" WHERE "assignmentId" = ANY($1)',
      [ids]
    );

    const submissionIds = (staleSubmissions || []).map((row) => normalizeText(row?.id)).filter(Boolean);
    deletedSubmissions += submissionIds.length;

    for (const submissionIdChunk of chunkList(submissionIds, 100)) {
      if (submissionIdChunk.length === 0) continue;
      await pool.query(
        'DELETE FROM "Submission" WHERE id = ANY($1)',
        [submissionIdChunk]
      );
    }

    await pool.query(
      'DELETE FROM "Assignment" WHERE id = ANY($1)',
      [ids]
    );
    deletedAssignments += ids.length;
  }

  await pool.end();

  console.log(
    JSON.stringify(
      {
        live: liveAssignments.size,
        inserted,
        updated,
        deletedAssignments,
        deletedSubmissions,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  if (isSupabaseConnectivityError(error)) {
    console.warn(`[eval-db-sync] DB unreachable. Skipping sync. ${formatErrorMessage(error)}`);
    return;
  }

  console.error('[eval-db-sync] failed:', error?.message || error);
  process.exitCode = 1;
});
