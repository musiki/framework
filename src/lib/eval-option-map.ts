import { getCollection } from 'astro:content';
import { parseEvalBlock } from './eval/parse-eval-block.mjs';

type EvalOptionMap = Map<string, string[]>;

function toOptionText(option: unknown): string {
  if (typeof option === 'string') {
    return option.replace(/^\[(x|X|\s)\]\s*/, '').trim();
  }

  if (!option || typeof option !== 'object') return '';
  const record = option as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text.trim();
  if (typeof record.label === 'string') return record.label.trim();
  if (typeof record.value === 'string') return record.value.trim();
  return '';
}

function extractEvalBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```eval\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(markdown)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }

  return blocks;
}

export async function getEvalOptionMap(): Promise<EvalOptionMap> {
  const map: EvalOptionMap = new Map();
  const entries = await getCollection('cursos');

  for (const entry of entries) {
    const markdown = typeof entry.body === 'string' ? entry.body : '';
    if (!markdown) continue;

    const evalBlocks = extractEvalBlocks(markdown);
    if (evalBlocks.length === 0) continue;

    evalBlocks.forEach((block, index) => {
      try {
        const parsed = parseEvalBlock(block, { fallbackId: `${entry.id}-eval-${index + 1}` }) as any;
        if (!parsed || parsed.type !== 'mcq' || !Array.isArray(parsed.options)) return;

        const optionTexts = parsed.options.map(toOptionText).filter(Boolean);
        if (optionTexts.length === 0 || !parsed.id) return;

        map.set(String(parsed.id), optionTexts);
      } catch {
        // Ignore malformed eval blocks to avoid breaking admin/dashboard rendering.
      }
    });
  }

  return map;
}
