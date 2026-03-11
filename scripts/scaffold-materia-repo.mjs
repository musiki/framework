#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_ROOT = path.resolve(__dirname, '../templates/materia-repo');

const args = process.argv.slice(2);

const getArgValue = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return String(args[index + 1] || '').trim();
};

const hasFlag = (flag) => args.includes(flag);

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const titleize = (value) =>
  String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const ensureEmptyTarget = (targetDir) => {
  if (!fs.existsSync(targetDir)) return;
  const items = fs.readdirSync(targetDir).filter((item) => item !== '.git');
  if (items.length > 0) {
    throw new Error(`Target directory is not empty: ${targetDir}`);
  }
};

const replaceTokens = (value, replacements) => {
  let nextValue = value;
  for (const [token, replacement] of replacements) {
    nextValue = nextValue.split(token).join(replacement);
  }
  return nextValue;
};

const walkTemplate = (dirPath) => {
  const entries = [];
  const stack = [''];

  while (stack.length > 0) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(dirPath, relativeDir);
    const dirEntries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name === '.DS_Store') continue;
      const relativePath = path.join(relativeDir, entry.name);
      entries.push({ relativePath, isDirectory: entry.isDirectory() });
      if (entry.isDirectory()) stack.push(relativePath);
    }
  }

  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const writeFile = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
};

const createKeepFile = (filePath) => {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf8');
  }
};

const targetArg = getArgValue('--target');
if (!targetArg) {
  throw new Error(
    'Missing --target. Example: node scripts/scaffold-materia-repo.mjs --target ../i1',
  );
}

const targetDir = path.resolve(targetArg);
const targetBasename = path.basename(targetDir);
const inferredSlug = slugify(targetBasename.replace(/^musiki-/, '')) || 'materia';
const subjectSlug = getArgValue('--subject-slug', inferredSlug) || inferredSlug;
const subjectName = getArgValue('--subject-name', titleize(subjectSlug)) || titleize(subjectSlug);
const courseId = getArgValue('--course-id', subjectSlug) || subjectSlug;
const courseTitle = getArgValue('--course-title', subjectName) || subjectName;
const org = getArgValue('--org', 'musiki') || 'musiki';
const platformOwner = getArgValue('--platform-owner', 'musiki') || 'musiki';
const platformRepo = getArgValue('--platform-repo', 'framework') || 'framework';
const teachersTeam = getArgValue('--teachers-team', `@${org}/docentes-${subjectSlug}`) || `@${org}/docentes-${subjectSlug}`;
const editorialTeam = getArgValue('--editorial-team', `@${org}/editorial`) || `@${org}/editorial`;
const devsTeam = getArgValue('--devs-team', `@${org}/devs`) || `@${org}/devs`;
const dryRun = hasFlag('--dry-run');

const replacements = new Map([
  ['__SUBJECT_NAME__', subjectName],
  ['__SUBJECT_SLUG__', subjectSlug],
  ['__COURSE_TITLE__', courseTitle],
  ['__COURSE_ID__', courseId],
  ['__PLATFORM_OWNER__', platformOwner],
  ['__PLATFORM_REPO__', platformRepo],
  ['__TEACHERS_TEAM__', teachersTeam],
  ['__EDITORIAL_TEAM__', editorialTeam],
  ['__DEVS_TEAM__', devsTeam],
]);

if (!fs.existsSync(TEMPLATE_ROOT)) {
  throw new Error(`Template not found: ${TEMPLATE_ROOT}`);
}

if (!dryRun) {
  ensureDir(targetDir);
  ensureEmptyTarget(targetDir);
}

const templateEntries = walkTemplate(TEMPLATE_ROOT);
const writtenFiles = [];

for (const entry of templateEntries) {
  const sourcePath = path.join(TEMPLATE_ROOT, entry.relativePath);
  const destinationRelativePath = replaceTokens(entry.relativePath, replacements);
  const destinationPath = path.join(targetDir, destinationRelativePath);

  if (entry.isDirectory) {
    if (!dryRun) ensureDir(destinationPath);
    continue;
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const rendered = replaceTokens(raw, replacements);

  if (!dryRun) writeFile(destinationPath, rendered);
  writtenFiles.push(destinationRelativePath);
}

const extraDirs = [
  '.obsidian',
  'assets',
  'public',
  'public/topoi',
  'public/glosario',
  'public/casos',
  'draft',
  'draft/estudiantes',
  'draft/incubadora',
  'draft/materiales-subsidiarios',
];

if (!dryRun) {
  for (const relativeDir of extraDirs) {
    ensureDir(path.join(targetDir, relativeDir));
  }

  createKeepFile(path.join(targetDir, '.obsidian/.gitkeep'));
  createKeepFile(path.join(targetDir, 'assets/.gitkeep'));
  createKeepFile(path.join(targetDir, 'public/.gitkeep'));
  createKeepFile(path.join(targetDir, 'public/topoi/.gitkeep'));
  createKeepFile(path.join(targetDir, 'public/glosario/.gitkeep'));
  createKeepFile(path.join(targetDir, 'public/casos/.gitkeep'));
  createKeepFile(path.join(targetDir, 'draft/.gitkeep'));
  createKeepFile(path.join(targetDir, 'draft/estudiantes/.gitkeep'));
  createKeepFile(path.join(targetDir, 'draft/incubadora/.gitkeep'));
  createKeepFile(path.join(targetDir, 'draft/materiales-subsidiarios/.gitkeep'));
}

const summary = {
  targetDir,
  subjectName,
  subjectSlug,
  courseId,
  courseTitle,
  platformOwner,
  platformRepo,
  teachersTeam,
  editorialTeam,
  devsTeam,
  files: writtenFiles.length,
  dryRun,
};

console.log(JSON.stringify(summary, null, 2));
