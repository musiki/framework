import { parseEvalBlock } from '../eval/parse-eval-block.mjs';
import { extractEvalBlocks } from '../eval/extract-eval-blocks.mjs';
import { safeGetCollection } from '../safe-content-collection';
import { fieldKeyFromId, normalizeDashboardText } from './shared';

export interface DashboardWelcomeField {
  evalId: string;
  field: string;
  title: string;
  prompt: string;
  evalType: string;
  minWidth?: number;
}

const asText = (value: unknown, fallback = '') => normalizeDashboardText(value) || fallback;

const normalizeFieldTitle = (parsed: Record<string, unknown>) => {
  const title = asText(parsed.title);
  if (title) return title;
  const prompt = asText(parsed.prompt);
  if (prompt) return prompt;
  return asText(parsed.id, 'Welcome');
};

const normalizeFieldPrompt = (parsed: Record<string, unknown>) =>
  asText(parsed.prompt) || normalizeFieldTitle(parsed);

const getFieldMinWidth = (evalType: string) =>
  evalType === 'form-text' ? 176 : 152;

export async function getCourseWelcomeFields(courseId: string): Promise<DashboardWelcomeField[]> {
  const normalizedCourseId = asText(courseId);
  if (!normalizedCourseId) return [];

  const entries = await safeGetCollection<any>('cursos');
  const welcomeEntry = entries.find((entry: any) => String(entry?.id || '') === `${normalizedCourseId}/_welcome`);
  const markdown = typeof welcomeEntry?.body === 'string' ? welcomeEntry.body : '';
  if (!markdown) return [];

  return extractEvalBlocks(markdown, {
    sourcePath: `cursos/${normalizedCourseId}/_welcome.md`,
    fallbackIdBase: `${normalizedCourseId}-welcome`,
  })
    .map((block, index) => {
      try {
        const parsed = parseEvalBlock(block, {
          fallbackId: `${normalizedCourseId}-welcome-${index + 1}`,
        }) as Record<string, unknown> | null;

        const evalId = asText(parsed?.id);
        if (!parsed || !evalId) return null;

        const evalType = asText(parsed.type, 'unknown').toLowerCase();
        return {
          evalId,
          field: fieldKeyFromId('welcome', evalId),
          title: normalizeFieldTitle(parsed),
          prompt: normalizeFieldPrompt(parsed),
          evalType,
          minWidth: getFieldMinWidth(evalType),
        } satisfies DashboardWelcomeField;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as DashboardWelcomeField[];
}

export function getWelcomeSubmissionAnswerText(submission: any): string {
  const payload =
    submission?.payload && typeof submission.payload === 'object' && !Array.isArray(submission.payload)
      ? submission.payload
      : {};
  const nestedAnswer =
    payload?.answer && typeof payload.answer === 'object' && !Array.isArray(payload.answer)
      ? payload.answer
      : null;

  const answerOptions = [
    ...(Array.isArray(payload?.answerOptions) ? payload.answerOptions : []),
    ...(Array.isArray(nestedAnswer?.answerOptions) ? nestedAnswer.answerOptions : []),
  ]
    .map((option) => normalizeDashboardText(option))
    .filter(Boolean);

  if (answerOptions.length > 0) {
    return answerOptions.join(', ');
  }

  const directTextCandidates = [
    nestedAnswer?.text,
    nestedAnswer?.answerText,
    nestedAnswer?.word,
    nestedAnswer?.value,
    payload?.answerText,
    payload?.answerLabel,
  ];

  for (const candidate of directTextCandidates) {
    const normalized = normalizeDashboardText(candidate);
    if (normalized) return normalized;
  }

  if (Array.isArray(payload?.answer)) {
    const normalized = payload.answer
      .map((value: unknown) => normalizeDashboardText(value))
      .filter(Boolean);
    if (normalized.length > 0) return normalized.join(', ');
  }

  const rawAnswer = normalizeDashboardText(payload?.answer);
  if (rawAnswer && rawAnswer !== '[object Object]') {
    return rawAnswer;
  }

  return '';
}
