#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const args = process.argv.slice(2);

const findArgValue = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const manifestPath = path.resolve(findArgValue('--manifest', 'config/sources.manifest.json'));
const sourcesDir = path.resolve(findArgValue('--sources-dir', '.content-sources'));
const targetDir = path.resolve(findArgValue('--target', 'src/content'));
const stagingDir = path.resolve(findArgValue('--staging', '.tmp/assembled-content'));
const reportPath = path.resolve(findArgValue('--report', '.tmp/assemble-report.json'));
const apply = args.includes('--apply');
const allowEmpty = args.includes('--allow-empty');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const normalizeRel = (value) => value.split(path.sep).join('/');

const walkFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  const files = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        files.push(abs);
      }
    }
  }
  return files.sort();
};

const fileDigest = (filePath) => {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
};

const readManifest = () => {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources.filter((source) => source && source.enabled !== false)
    : [];
  if (sources.length === 0) {
    throw new Error(
      `No enabled sources found in ${manifestPath}. Set at least one source with "enabled": true.`,
    );
  }
  return parsed;
};

const sanitizePublicPath = (rawPublicPath, sourceFilePath) => {
  const raw = String(rawPublicPath || '').trim().replace(/\\/g, '/');
  if (!raw) return '';

  let cleaned = path.posix.normalize(raw).replace(/^\/+/, '');
  if (!cleaned || cleaned === '.' || cleaned.startsWith('..')) return '';

  const ext = path.posix.extname(cleaned).toLowerCase();
  if (ext !== '.md' && ext !== '.mdx') {
    cleaned = path.posix.join(cleaned, path.basename(sourceFilePath));
  }

  cleaned = path.posix.normalize(cleaned).replace(/^\/+/, '');
  if (!cleaned || cleaned.startsWith('..')) return '';

  return cleaned;
};

const assembly = {
  coursesDir: 'cursos',
  publicDir: 'public',
  promoteFromCourses: true,
  requiredVisibilityForPublic: 'public',
  requiredPublicStatus: 'approved',
  excludeTypesFromPublic: ['assignment', 'eval', 'lesson-presentation', 'app-dataviewjs'],
};

const mergeAssemblyConfig = (manifestAssembly) => {
  if (!manifestAssembly || typeof manifestAssembly !== 'object') return;
  for (const [key, value] of Object.entries(manifestAssembly)) {
    if (value === undefined) continue;
    assembly[key] = value;
  }
};

const isMarkdown = (filePath) => /\.mdx?$/i.test(filePath);

const prepDir = (dirPath) => {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
};

const main = () => {
  const manifest = readManifest();
  mergeAssemblyConfig(manifest.assembly);
  const sources = Array.isArray(manifest.sources)
    ? manifest.sources.filter((source) => source && source.enabled !== false)
    : [];

  prepDir(stagingDir);

  const destinationMap = new Map();
  const collisions = [];
  const warnings = [];
  const copiedFiles = [];
  const promotedFiles = [];
  const skippedPromotions = [];

  const registerCopy = (sourceAbs, destinationAbs, meta) => {
    const relativeDestination = normalizeRel(path.relative(stagingDir, destinationAbs));
    const existing = destinationMap.get(relativeDestination);

    if (existing) {
      const newDigest = fileDigest(sourceAbs);
      const existingDigest = fileDigest(existing.sourceAbs);
      if (newDigest !== existingDigest) {
        collisions.push({
          destination: relativeDestination,
          current: meta.sourceLabel,
          previous: existing.meta.sourceLabel,
        });
        return false;
      }
      return false;
    }

    ensureDir(path.dirname(destinationAbs));
    fs.copyFileSync(sourceAbs, destinationAbs);
    destinationMap.set(relativeDestination, { sourceAbs, meta });
    copiedFiles.push({
      destination: relativeDestination,
      source: meta.sourceLabel,
      mode: meta.mode,
    });
    return true;
  };

  const copyTree = (sourceId, sourceRoot, destinationRoot, mode) => {
    if (!fs.existsSync(sourceRoot)) return;
    const files = walkFiles(sourceRoot);
    for (const filePath of files) {
      const rel = path.relative(sourceRoot, filePath);
      const destination = path.join(destinationRoot, rel);
      registerCopy(filePath, destination, {
        sourceLabel: `${sourceId}:${normalizeRel(path.relative(path.dirname(sourceRoot), filePath))}`,
        mode,
      });
    }
  };

  for (const source of sources) {
    if (!source.id) {
      throw new Error(`Each source must include "id". Invalid source: ${JSON.stringify(source)}`);
    }

    const sourceCheckoutDir = path.join(sourcesDir, source.id);
    if (!fs.existsSync(sourceCheckoutDir)) {
      throw new Error(
        `Source "${source.id}" is missing checkout directory ${sourceCheckoutDir}. Run pull-sources first.`,
      );
    }

    const contentRoot = source.contentRoot || '.';
    const sourceContentRoot = path.join(sourceCheckoutDir, contentRoot);
    if (!fs.existsSync(sourceContentRoot)) {
      throw new Error(`Source "${source.id}" missing vault root "${contentRoot}"`);
    }

    const sourceCoursesRoot = path.join(sourceContentRoot, assembly.coursesDir);
    const sourcePublicRoot = path.join(sourceContentRoot, assembly.publicDir);

    copyTree(source.id, sourceCoursesRoot, path.join(stagingDir, assembly.coursesDir), 'courses');
    copyTree(source.id, sourcePublicRoot, path.join(stagingDir, assembly.publicDir), 'public');

    if (!assembly.promoteFromCourses || !fs.existsSync(sourceCoursesRoot)) continue;

    const courseFiles = walkFiles(sourceCoursesRoot).filter(isMarkdown);
    for (const filePath of courseFiles) {
      const raw = fs.readFileSync(filePath, 'utf8');
      let data = {};
      try {
        data = matter(raw).data || {};
      } catch (error) {
        warnings.push(
          `Could not parse frontmatter in ${normalizeRel(
            path.relative(sourceCheckoutDir, filePath),
          )}: ${error.message}`,
        );
        continue;
      }

      const visibility = String(data.visibility || '').trim().toLowerCase();
      const publicStatus = String(data.public_status || '').trim().toLowerCase();
      const type = String(data.type || '').trim().toLowerCase();
      const excludedTypes = Array.isArray(assembly.excludeTypesFromPublic)
        ? assembly.excludeTypesFromPublic.map((item) => String(item).toLowerCase())
        : [];

      if (visibility !== String(assembly.requiredVisibilityForPublic).toLowerCase()) continue;
      if (publicStatus !== String(assembly.requiredPublicStatus).toLowerCase()) continue;

      const sourceRelative = normalizeRel(path.relative(sourceCoursesRoot, filePath));

      if (excludedTypes.includes(type)) {
        skippedPromotions.push({
          file: `${source.id}:${sourceRelative}`,
          reason: `type "${type}" is excluded from public output`,
        });
        continue;
      }

      const publicPath = sanitizePublicPath(data.public_path, filePath);
      if (!publicPath) {
        skippedPromotions.push({
          file: `${source.id}:${sourceRelative}`,
          reason: 'missing or invalid public_path',
        });
        continue;
      }

      const destinationAbs = path.join(stagingDir, assembly.publicDir, publicPath);
      const copied = registerCopy(filePath, destinationAbs, {
        sourceLabel: `${source.id}:${sourceRelative}`,
        mode: 'promoted',
      });

      if (copied) {
        promotedFiles.push({
          source: `${source.id}:${sourceRelative}`,
          destination: normalizeRel(path.join(assembly.publicDir, publicPath)),
        });
      }
    }
  }

  if (collisions.length > 0) {
    const details = collisions
      .map(
        (collision) =>
          `- ${collision.destination} (previous: ${collision.previous}, current: ${collision.current})`,
      )
      .join('\n');
    throw new Error(`Content path collisions detected:\n${details}`);
  }

  const stagedFileCount = walkFiles(stagingDir).length;
  if (!allowEmpty && stagedFileCount === 0) {
    throw new Error('Assemble produced zero files. Aborting to avoid wiping target content.');
  }

  if (apply) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    ensureDir(path.dirname(targetDir));
    fs.cpSync(stagingDir, targetDir, { recursive: true });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    sourcesDir,
    targetDir,
    applied: apply,
    summary: {
      sources: sources.map((source) => source.id),
      copiedFiles: copiedFiles.length,
      promotedFiles: promotedFiles.length,
      skippedPromotions: skippedPromotions.length,
      warnings: warnings.length,
    },
    promotedFiles,
    skippedPromotions,
    warnings,
  };

  ensureDir(path.dirname(reportPath));
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Assemble complete. Files staged: ${stagedFileCount}`);
  console.log(`Promoted from courses to public: ${promotedFiles.length}`);
  if (skippedPromotions.length > 0) {
    console.log(`Skipped promotions: ${skippedPromotions.length}`);
  }
  console.log(`Report: ${reportPath}`);
  if (!apply) {
    console.log(`Dry run only. Use --apply to replace ${targetDir}`);
  }
};

main();
