type GenericRecord = Record<string, any>;

function asRecord(value: unknown): GenericRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as GenericRecord) : null;
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeOptionText(option: unknown): string {
  if (typeof option === 'string') {
    return option.replace(/^\[(x|X|\s)\]\s*/, '').trim();
  }

  const record = asRecord(option);
  if (!record) return '';

  return cleanText(record.text || record.label || record.value);
}

function extractAssignmentOptions(assignment: unknown): string[] {
  const record = asRecord(assignment);
  if (!record) return [];

  const candidates: unknown[] = [
    record.options,
    asRecord(record.payload)?.options,
    asRecord(record.meta)?.options,
    asRecord(record.data)?.options,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const normalized = candidate.map(normalizeOptionText).filter(Boolean);
    if (normalized.length > 0) return normalized;
  }

  return [];
}

function toAnswerArray(answer: unknown): string[] {
  if (Array.isArray(answer)) {
    return answer
      .map((item) => cleanText(String(item)))
      .filter(Boolean);
  }

  if (answer === undefined || answer === null) return [];

  const normalized = cleanText(String(answer));
  return normalized ? [normalized] : [];
}

function formatIndexedAnswers(indexes: string[], labels: string[]): string {
  if (indexes.length === 0 || labels.length === 0) return '';

  const merged = indexes
    .map((indexValue, idx) => {
      const label = cleanText(labels[idx] ?? (labels.length === 1 ? labels[0] : ''));
      if (!label) return cleanText(indexValue);
      return `${cleanText(indexValue)}: ${label}`;
    })
    .filter(Boolean);

  return merged.join(' | ');
}

function resolveAnswerValue(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;

  if ('answer' in record) return record.answer;
  return payload;
}

export function getSubmissionAnswerText(
  submission: GenericRecord,
  assignmentById: Map<string, GenericRecord> = new Map(),
): string {
  const payload = submission?.payload;
  const payloadRecord = asRecord(payload);

  const answerValue = resolveAnswerValue(payload);
  const answerList = toAnswerArray(answerValue);
  const answerIndexes = Array.isArray(payloadRecord?.answerIndexes)
    ? payloadRecord.answerIndexes.map((value: unknown) => cleanText(String(value))).filter(Boolean)
    : [];
  const normalizedIndexes = answerIndexes.length > 0 ? answerIndexes : answerList;

  const nestedRecord = asRecord(answerValue);
  if (nestedRecord?.type === 'mcc' && nestedRecord.completed === true) {
    return 'Unidad completada';
  }

  const explicitAnswerText = cleanText(payloadRecord?.answerText || payloadRecord?.answerLabel);
  const explicitAnswerOptions = Array.isArray(payloadRecord?.answerOptions)
    ? payloadRecord.answerOptions.map((item: unknown) => cleanText(String(item))).filter(Boolean)
    : [];

  const indexedFromPayload = formatIndexedAnswers(
    normalizedIndexes,
    explicitAnswerOptions.length > 0 ? explicitAnswerOptions : (explicitAnswerText ? [explicitAnswerText] : []),
  );
  if (indexedFromPayload) return indexedFromPayload;

  if (explicitAnswerOptions.length > 0) {
    return explicitAnswerOptions.join(' | ');
  }
  if (explicitAnswerText) {
    return explicitAnswerText;
  }

  if (answerList.length === 0) return '—';

  const assignment = assignmentById.get(submission?.assignmentId);
  const assignmentOptions = extractAssignmentOptions(assignment);

  const mappedOptions = normalizedIndexes
    .map((item) => {
      const index = Number(item);
      if (!Number.isInteger(index) || index < 0) return '';
      return assignmentOptions[index] || '';
    })
    .filter(Boolean);

  const indexedFromAssignment = formatIndexedAnswers(normalizedIndexes, mappedOptions);
  if (indexedFromAssignment) {
    return indexedFromAssignment;
  }

  if (mappedOptions.length > 0) {
    return mappedOptions.join(' | ');
  }

  const rawText = answerList.join(' | ');
  return rawText || '—';
}

export function getSubmissionResultState(submission: GenericRecord): 'correct' | 'incorrect' | 'pending' {
  const payload = asRecord(submission?.payload);

  if (typeof payload?.isCorrect === 'boolean') {
    return payload.isCorrect ? 'correct' : 'incorrect';
  }

  const nestedAnswer = asRecord(payload?.answer);
  if (typeof nestedAnswer?.isCorrect === 'boolean') {
    return nestedAnswer.isCorrect ? 'correct' : 'incorrect';
  }

  const score = typeof submission?.score === 'number' ? submission.score : null;
  if (score === null) return 'pending';

  if (score <= 1) return score > 0 ? 'correct' : 'incorrect';
  return score >= 4 ? 'correct' : 'incorrect';
}

export function isSubmissionReviewed(submission: GenericRecord): boolean {
  const gradedAt = cleanText(submission?.gradedAt);
  if (gradedAt) return true;

  if (typeof submission?.score === 'number' && Number.isFinite(submission.score)) {
    return true;
  }

  const feedback = cleanText(submission?.feedback);
  return feedback.length > 0;
}

export function getResultIcon(state: 'correct' | 'incorrect' | 'pending'): string {
  if (state === 'correct') return '✓';
  if (state === 'incorrect') return '✕';
  return '•';
}
