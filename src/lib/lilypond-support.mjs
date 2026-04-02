import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ENGLISH_LANGUAGE_DIRECTIVE_RE = /(\\language\s+")english(")/i;
const DUTCH_STYLE_NOTE_NAME_RE =
  /(^|[\s<({[])(?:ces|des|ees|fes|ges|aes|bes|hes|cis|dis|eis|fis|gis|ais|his)(?=[,!'?~\d\s>)}\]\\]|$)/im;

function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;
  let inString = false;
  let inLineComment = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const previousChar = index === 0 ? '' : source[index - 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (char === '%' && !inString) {
      inLineComment = true;
      continue;
    }

    if (char === '"' && previousChar !== '\\') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findScoreRanges(source) {
  const ranges = [];
  let index = 0;

  while (index < source.length) {
    const scoreIndex = source.indexOf('\\score', index);
    if (scoreIndex === -1) break;

    let braceIndex = scoreIndex + '\\score'.length;
    while (braceIndex < source.length && /\s/.test(source[braceIndex])) {
      braceIndex += 1;
    }

    if (source[braceIndex] !== '{') {
      index = scoreIndex + '\\score'.length;
      continue;
    }

    const end = findMatchingBrace(source, braceIndex);
    if (end === -1) break;

    ranges.push({ bodyStart: braceIndex + 1, end });
    index = end + 1;
  }

  return ranges;
}

export function ensurePlayableLilypondSource(source) {
  const cleanSource = String(source || '');
  const scoreRanges = findScoreRanges(cleanSource);
  if (scoreRanges.length === 0) return cleanSource;

  let output = cleanSource;

  for (let index = scoreRanges.length - 1; index >= 0; index -= 1) {
    const range = scoreRanges[index];
    const scoreBody = output.slice(range.bodyStart, range.end);
    const additions = [];

    if (!scoreBody.includes('\\layout')) additions.push('\\layout { }');
    if (!scoreBody.includes('\\midi')) additions.push('\\midi { }');
    if (additions.length === 0) continue;

    output = `${output.slice(0, range.end)}\n${additions.join('\n')}\n${output.slice(range.end)}`;
  }

  return output;
}

function buildEnglishCompatibilitySource(source) {
  const normalizedSource = ensurePlayableLilypondSource(source);
  if (!ENGLISH_LANGUAGE_DIRECTIVE_RE.test(normalizedSource)) return '';
  if (!DUTCH_STYLE_NOTE_NAME_RE.test(normalizedSource)) return '';
  return normalizedSource.replace(ENGLISH_LANGUAGE_DIRECTIVE_RE, '$1nederlands$2');
}

export function buildLocalLilypondSourceAttempts(source) {
  const primarySource = ensurePlayableLilypondSource(source);
  const attempts = [primarySource];
  const compatibilitySource = buildEnglishCompatibilitySource(primarySource);
  if (compatibilitySource && compatibilitySource !== primarySource) {
    attempts.push(compatibilitySource);
  }
  return attempts;
}

function normalizeSvgStyle(styleText, baseInkColor) {
  const normalized = String(styleText || '')
    .replace(/color\s*:\s*inherit/gi, `color:${baseInkColor}`)
    .replace(/color\s*:\s*currentColor/gi, `color:${baseInkColor}`)
    .replace(/fill\s*:\s*currentColor/gi, `fill:${baseInkColor}`)
    .replace(/stroke\s*:\s*currentColor/gi, `stroke:${baseInkColor}`)
    .replace(/currentColor/gi, baseInkColor)
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(';');

  return normalized;
}

export function sanitizeLilypondSvgMarkup(svgText, baseInkColor = '#222939') {
  let output = String(svgText || '');
  if (!output) return output;

  output = output
    .replace(/\bfill="currentColor"/gi, `fill="${baseInkColor}"`)
    .replace(/\bstroke="currentColor"/gi, `stroke="${baseInkColor}"`)
    .replace(/\bcolor="currentColor"/gi, `color="${baseInkColor}"`);

  output = output.replace(/style="([^"]*)"/gi, (_match, styleText) => {
    const normalizedStyle = normalizeSvgStyle(styleText, baseInkColor);
    return normalizedStyle ? `style="${normalizedStyle}"` : '';
  });

  output = output.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
    if (/\bcolor="/i.test(attrs) || /\bstyle="/i.test(attrs)) {
      return match;
    }
    return `<svg${attrs} color="${baseInkColor}">`;
  });

  return output;
}

function collectInstalledLilypondCandidates() {
  const candidates = [];
  const pushIfPresent = (candidatePath) => {
    if (!candidatePath) return;
    const normalized = String(candidatePath).trim();
    if (normalized && fs.existsSync(normalized)) candidates.push(normalized);
  };

  pushIfPresent(process.env.LILYPOND_BIN);
  pushIfPresent(process.env.LILYPOND_BINARY);

  const appBase = '/Applications/Lilypond';
  if (fs.existsSync(appBase)) {
    const entries = fs.readdirSync(appBase, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    for (const entry of entries) {
      pushIfPresent(path.join(appBase, entry, 'bin', 'lilypond'));
    }
  }

  const frescobaldiBase = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'frescobaldi',
    'frescobaldi',
    'lilypond-binaries',
  );
  if (fs.existsSync(frescobaldiBase)) {
    const entries = fs.readdirSync(frescobaldiBase, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    for (const entry of entries) {
      pushIfPresent(path.join(frescobaldiBase, entry, 'bin', 'lilypond'));
    }
  }

  return candidates;
}

function canExecuteLilypond(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let cachedLilypondBinary = null;

export function getLilypondBinary() {
  if (cachedLilypondBinary !== null) return cachedLilypondBinary;

  if (canExecuteLilypond('lilypond')) {
    cachedLilypondBinary = 'lilypond';
    return cachedLilypondBinary;
  }

  const candidates = collectInstalledLilypondCandidates();
  for (const candidate of candidates) {
    if (canExecuteLilypond(candidate)) {
      cachedLilypondBinary = candidate;
      return cachedLilypondBinary;
    }
  }

  cachedLilypondBinary = '';
  return cachedLilypondBinary;
}

export function hasLilypondBinary() {
  return Boolean(getLilypondBinary());
}
