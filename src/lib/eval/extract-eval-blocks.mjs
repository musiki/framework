import { parseEvalBlock } from './parse-eval-block.mjs';

const FENCED_CODE_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g;

const normalizeText = (value = '') => String(value || '').trim();

export const isWelcomeSourcePath = (sourcePath = '') => {
  const normalized = normalizeText(sourcePath).replace(/\\/g, '/').toLowerCase();
  if (!normalized) return false;
  return /(^|\/)_welcome(\.md|\.mdx)?$/.test(normalized);
};

export const tryParseEvalBlock = (blockValue, options = {}) => {
  try {
    return parseEvalBlock(blockValue, options);
  } catch {
    return null;
  }
};

export const shouldTreatCodeFenceAsEval = ({
  lang = '',
  blockValue = '',
  sourcePath = '',
  fallbackId = 'eval-block',
} = {}) => {
  const normalizedLang = normalizeText(lang).toLowerCase().split(/\s+/)[0] || '';
  if (normalizedLang === 'eval') return true;
  if (normalizedLang) return false;
  if (!isWelcomeSourcePath(sourcePath)) return false;

  const parsed = tryParseEvalBlock(blockValue, { fallbackId, sourcePath });
  return Boolean(parsed?.id && parsed?.type);
};

export const extractEvalBlocks = (markdown = '', options = {}) => {
  const sourcePath = normalizeText(options.sourcePath || '');
  const fallbackIdBase = normalizeText(options.fallbackIdBase || 'eval-block');
  const blocks = [];
  let fenceIndex = 0;
  let match = null;

  while ((match = FENCED_CODE_PATTERN.exec(String(markdown || ''))) !== null) {
    fenceIndex += 1;
    const rawInfo = normalizeText(match[1] || '');
    const lang = rawInfo.split(/\s+/)[0] || '';
    const blockValue = String(match[2] || '');
    if (!blockValue.trim()) continue;

    if (!shouldTreatCodeFenceAsEval({
      lang,
      blockValue,
      sourcePath,
      fallbackId: `${fallbackIdBase}-${fenceIndex}`,
    })) {
      continue;
    }

    blocks.push(blockValue);
  }

  return blocks;
};
