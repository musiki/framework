#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseEvalBlock } from '../lib/eval/parse-eval-block.mjs';

const cwd = process.cwd();
const contentRoot = path.resolve(cwd, 'src/content/cursos');
const envPath = path.resolve(cwd, '.env');

const normalizeText = (value) => String(value || '').trim();
const normalizeSlugPath = (value) => normalizeText(value).replace(/^\/+|\/+$/g, '');
const isMarkdownFile = (value) => /\.(md|mdx)$/i.test(String(value || ''));

const extractEvalBlocks = (markdown) => {
  const blocks = [];
  const pattern = /```eval\s*([\s\S]*?)```/g;
  let match = null;

  while ((match = pattern.exec(markdown)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }

  return blocks;
};

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

const resolveSupabaseClient = () => {
  loadDotEnv();

  const url = normalizeText(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL);
  const key = normalizeText(
    process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_KEY
      || process.env.SUPABASE_ANON_KEY,
  );

  if (!url || !key) return null;
  return createClient(url, key);
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

    extractEvalBlocks(raw).forEach((block, index) => {
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

const main = async () => {
  if (!fs.existsSync(contentRoot)) {
    console.log('[eval-db-sync] src/content/cursos not found. Skipping.');
    return;
  }

  const supabase = resolveSupabaseClient();
  if (!supabase) {
    console.log('[eval-db-sync] Missing Supabase env. Skipping.');
    return;
  }

  const liveAssignments = buildLiveAssignments();
  const liveIds = new Set(liveAssignments.keys());

  const { data: existingAssignments, error: assignmentsError } = await supabase
    .from('Assignment')
    .select('id,slug,courseId');

  if (assignmentsError) {
    throw assignmentsError;
  }

  const existingById = new Map((existingAssignments || []).map((row) => [String(row?.id || ''), row]));

  let inserted = 0;
  let updated = 0;

  for (const liveAssignment of liveAssignments.values()) {
    const existing = existingById.get(liveAssignment.id) || null;

    if (!existing) {
      const { error } = await supabase.from('Assignment').insert([liveAssignment]);
      if (error) throw error;
      inserted += 1;
      continue;
    }

    const nextSlug = normalizeSlugPath(liveAssignment.slug);
    const nextCourseId = normalizeText(liveAssignment.courseId);
    const currentSlug = normalizeSlugPath(existing?.slug);
    const currentCourseId = normalizeText(existing?.courseId);

    if (currentSlug === nextSlug && currentCourseId === nextCourseId) continue;

    const { error } = await supabase
      .from('Assignment')
      .update({
        slug: liveAssignment.slug,
        courseId: liveAssignment.courseId,
      })
      .eq('id', liveAssignment.id);

    if (error) throw error;
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

    const { data: staleSubmissions, error: staleSubmissionsError } = await supabase
      .from('Submission')
      .select('id,assignmentId')
      .in('assignmentId', ids);

    if (staleSubmissionsError) throw staleSubmissionsError;

    const submissionIds = (staleSubmissions || []).map((row) => normalizeText(row?.id)).filter(Boolean);
    deletedSubmissions += submissionIds.length;

    for (const submissionIdChunk of chunkList(submissionIds, 100)) {
      if (submissionIdChunk.length === 0) continue;
      const { error: deleteSubmissionError } = await supabase
        .from('Submission')
        .delete()
        .in('id', submissionIdChunk);
      if (deleteSubmissionError) throw deleteSubmissionError;
    }

    const { error: deleteAssignmentError } = await supabase
      .from('Assignment')
      .delete()
      .in('id', ids);

    if (deleteAssignmentError) throw deleteAssignmentError;
    deletedAssignments += ids.length;
  }

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
  console.error('[eval-db-sync] failed:', error?.message || error);
  process.exitCode = 1;
});
