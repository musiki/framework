import yaml from 'js-yaml';

const ALLOWED_MODES = new Set(['self', 'graded', 'peer', 'teacherreview', 'classtime']);
const MODE_ALIASES = new Map([
  ['teacher-review', 'teacherreview'],
  ['teacherrevision', 'teacherreview'],
  ['teacher_revision', 'teacherreview'],
  ['class-time', 'classtime'],
  ['class_time', 'classtime'],
  ['classlive', 'classtime'],
  ['class-live', 'classtime'],
  ['class_live', 'classtime'],
]);
const DEFAULT_MCC_BUTTON = 'Marcar como completado';
const DEFAULT_MCC_SUCCESS = 'Sección completada';

const asText = (value, fallback = '') => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

const asPositiveNumber = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const asPositiveInteger = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
};

const asBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const toList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(/\n|;/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const cleanId = (rawId, fallbackId) => {
  const candidate = asText(rawId, fallbackId)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return candidate || fallbackId;
};

const normalizeTripleQuotedEvalYaml = (rawBlock = '') => {
  const lines = String(rawBlock).split(/\r?\n/g);
  const normalized = [];

  const normalizeBlockContent = (blockLines, baseIndent) => {
    const expanded = blockLines.map((item) => String(item || '').replace(/\t/g, '  '));
    const meaningful = expanded.filter((item) => item.trim().length > 0);
    const minIndent = meaningful.reduce((acc, item) => {
      const match = item.match(/^ */);
      const indent = match ? match[0].length : 0;
      return Math.min(acc, indent);
    }, Number.POSITIVE_INFINITY);

    const safeIndent = Number.isFinite(minIndent) ? minIndent : 0;
    return expanded.map((item) => {
      const next = safeIndent > 0 ? item.slice(safeIndent) : item;
      return `${baseIndent}  ${next}`;
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const startMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9_-]*)\s*(:|=)\s*"""(.*)$/);

    if (!startMatch) {
      normalized.push(line);
      continue;
    }

    const [, indent, key, , rest] = startMatch;
    const inlineCloseIndex = rest.indexOf('"""');

    normalized.push(`${indent}${key}: |2`);

    if (inlineCloseIndex !== -1) {
      const inlineContent = rest.slice(0, inlineCloseIndex);
      if (inlineContent.length > 0) {
        normalized.push(...normalizeBlockContent([inlineContent], indent));
      }
      continue;
    }

    const blockLines = [];
    if (rest.length > 0) blockLines.push(rest);

    let closed = false;
    while (index + 1 < lines.length) {
      index += 1;
      const current = lines[index];
      const closeIndex = current.indexOf('"""');

      if (closeIndex === -1) {
        blockLines.push(current);
        continue;
      }

      const beforeClose = current.slice(0, closeIndex);
      if (beforeClose.length > 0) blockLines.push(beforeClose);
      closed = true;
      break;
    }

    if (blockLines.length > 0) {
      normalized.push(...normalizeBlockContent(blockLines, indent));
    }

    if (!closed) break;
  }

  return normalized.join('\n');
};

const normalizeLooseEvalYaml = (rawBlock = '') =>
  String(rawBlock)
    .split(/\r?\n/g)
    .map((line) => {
      // Accept top-level `key = value` syntax for authoring convenience.
      const assignment = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
      if (!assignment) return line;
      return `${assignment[1]}: ${assignment[2]}`;
    })
    .join('\n');

const loadEvalYaml = (blockValue) => {
  try {
    return yaml.load(blockValue);
  } catch (baseError) {
    const normalized = normalizeLooseEvalYaml(normalizeTripleQuotedEvalYaml(blockValue));
    if (normalized === blockValue) throw baseError;
    return yaml.load(normalized);
  }
};

const parseMcqOption = (option, index) => {
  if (typeof option === 'object' && option !== null) {
    const text = asText(option.text || option.label);
    if (!text) return null;
    return {
      id: `opt-${index + 1}`,
      text,
      isCorrect: Boolean(option.isCorrect),
    };
  }

  const raw = asText(option);
  if (!raw) return null;

  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  const markerMatch = unquoted.match(/^\[(x|X|\s)\]\s*(.*)$/);

  if (!markerMatch) {
    return {
      id: `opt-${index + 1}`,
      text: unquoted,
      isCorrect: false,
    };
  }

  return {
    id: `opt-${index + 1}`,
    text: markerMatch[2].trim(),
    isCorrect: markerMatch[1].toLowerCase() === 'x',
  };
};

const parsePollOption = (option, index) => {
  if (typeof option === 'object' && option !== null) {
    const text = asText(option.text || option.label || option.value);
    if (!text) return null;
    return {
      id: `opt-${index + 1}`,
      text,
    };
  }

  const raw = asText(option);
  if (!raw) return null;

  return {
    id: `opt-${index + 1}`,
    // Reuse MCQ-like marker cleanup to support mixed authoring.
    text: raw.replace(/^['"]|['"]$/g, '').replace(/^\[(x|X|\s)\]\s*/, '').trim(),
  };
};

const normalizeMcq = (raw, common, config = {}) => {
  const { forceMultiple = false } = config;
  const options = toList(raw.options)
    .map((option, index) => parseMcqOption(option, index))
    .filter((option) => option && option.text);

  if (options.length < 2) {
    throw new Error(`MCQ ${common.id} requires at least 2 options`);
  }

  if (!options.some((option) => option.isCorrect)) {
    options[0].isCorrect = true;
  }

  const correctCount = options.filter((option) => option.isCorrect).length;
  const allowMultiple = forceMultiple
    || correctCount > 1;

  return {
    ...common,
    type: 'mcq',
    prompt: asText(raw.prompt),
    explanation: asText(raw.explanation),
    hint: asText(raw.hint),
    allowMultiple,
    selectionMode: allowMultiple ? 'multiple' : 'single',
    options,
  };
};

const normalizeMcc = (raw, common) => {
  const objectives = toList(raw.objectives || raw.objetivos || raw.goals)
    .map((objective) => asText(objective))
    .filter(Boolean);

  return {
    ...common,
    type: 'mcc',
    prompt: asText(raw.prompt || raw.title || 'Marca esta sección como completada.'),
    summary: asText(raw.summary || raw.description),
    objectives,
    buttonLabel: asText(raw.buttonLabel || raw.button || raw.cta, DEFAULT_MCC_BUTTON),
    successLabel: asText(raw.successLabel || raw.success, DEFAULT_MCC_SUCCESS),
  };
};

const normalizePoll = (raw, common) => {
  const options = toList(raw.options)
    .map((option, index) => parsePollOption(option, index))
    .filter((option) => option && option.text);

  if (options.length < 2) {
    throw new Error(`Poll ${common.id} requires at least 2 options`);
  }

  const timerSeconds = resolveTimerSeconds(raw);

  return {
    ...common,
    type: 'poll',
    prompt: asText(raw.prompt || raw.question || raw.title || ''),
    options,
    anonymous: asBoolean(raw.anonymous, true),
    allowMultiple: asBoolean(raw.allowMultiple ?? raw.multiple, false),
    showResults: asBoolean(raw.showResults, true),
    autoStart: asBoolean(raw.autoStart, false),
    timed: timerSeconds > 0,
    timerSeconds,
  };
};

const resolveTimerSeconds = (raw) => {
  const rawTime = raw.time ?? raw.timed ?? raw.timer;
  const durationSecondsFromField =
    asPositiveInteger(raw.durationSeconds, 0)
    || asPositiveInteger(raw.seconds, 0);
  const durationMinutesFromField =
    asPositiveInteger(raw.durationMinutes, 0)
    || asPositiveInteger(raw.minutes, 0);
  const numericTimeMinutes = typeof rawTime === 'number'
    ? asPositiveInteger(rawTime, 0)
    : asPositiveInteger(asText(rawTime), 0);

  let timerSeconds = 0;
  if (durationSecondsFromField > 0) {
    timerSeconds = durationSecondsFromField;
  } else if (durationMinutesFromField > 0) {
    timerSeconds = durationMinutesFromField * 60;
  } else if (numericTimeMinutes > 0) {
    timerSeconds = numericTimeMinutes * 60;
  } else if (asBoolean(rawTime, false)) {
    timerSeconds = 120;
  }

  return timerSeconds;
};

const normalizeWordcloud = (raw, common) => {
  const options = toList(raw.options)
    .map((option, index) => parsePollOption(option, index))
    .filter((option) => option && option.text);

  const timerSeconds = resolveTimerSeconds(raw);

  return {
    ...common,
    type: 'wordcloud',
    prompt: asText(raw.prompt || raw.question || raw.title || ''),
    options,
    anonymous: asBoolean(raw.anonymous, true),
    allowMultiple: false,
    showResults: asBoolean(raw.showResults, true),
    autoStart: asBoolean(raw.autoStart, false),
    timed: timerSeconds > 0,
    timerSeconds,
  };
};

const normalizePatchAi = (raw, common) => {
  const checks = toList(raw.checks || raw.criteriaPrompts || raw.criteria_prompts || raw.prompts)
    .map((item) => asText(item))
    .filter(Boolean);

  return {
    ...common,
    type: 'patch_ai',
    prompt: asText(raw.prompt || raw.question || raw.title || ''),
    referencePatch: asText(
      raw.referencePatch
      || raw.reference_patch
      || raw.patchGuide
      || raw.patch_guide
      || raw.guidePatch
      || raw.patch_referencia
      || raw.patchReferencia,
    ),
    evaluationPrompt: asText(
      raw.evaluationPrompt
      || raw.evaluatorPrompt
      || raw.modelPrompt
      || raw.aiPrompt
      || raw.systemPrompt,
    ),
    checks,
    provider: asText(raw.provider, 'ollama').toLowerCase() || 'ollama',
    model: asText(raw.model),
    passScore: asPositiveNumber(raw.passScore, 6),
    minChars: asPositiveInteger(raw.minChars, 0),
    placeholder: asText(
      raw.placeholder
      || raw.studentPlaceholder
      || raw.student_placeholder
      || 'Pega aqui el patch del alumno.',
    ),
    submitLabel: asText(raw.submitLabel || raw.cta || raw.buttonLabel || 'Evaluar patch'),
  };
};

const normalizeShortAi = (raw, common) => ({
  ...common,
  type: 'short_ai',
  prompt: asText(raw.prompt || raw.question || raw.title || ''),
  rubric: asText(raw.rubric || raw.criteria || raw.rubrica),
  provider: asText(raw.provider, 'ollama').toLowerCase() || 'ollama',
  model: asText(raw.model),
  passScore: asPositiveNumber(raw.passScore, 6),
  minChars: asPositiveInteger(raw.minChars, 0),
  placeholder: asText(
    raw.placeholder
    || raw.studentPlaceholder
    || raw.student_placeholder
    || 'Escribe aqui tu respuesta.',
  ),
  submitLabel: asText(raw.submitLabel || raw.cta || raw.buttonLabel || 'Evaluar respuesta'),
});

const normalizeReferenceAi = (raw, common) => ({
  ...common,
  type: 'reference_ai',
  prompt: asText(raw.prompt || raw.question || raw.title || ''),
  referenceText: asText(
    raw.referenceText
    || raw.reference_text
    || raw.referenceAnswer
    || raw.reference_answer
    || raw.answerGuide
    || raw.answer_guide
    || raw.respuestaReferencia
    || raw.respuesta_referencia,
  ),
  rubric: asText(raw.rubric || raw.criteria || raw.rubrica),
  provider: asText(raw.provider, 'ollama').toLowerCase() || 'ollama',
  model: asText(raw.model),
  passScore: asPositiveNumber(raw.passScore, 6),
  minChars: asPositiveInteger(raw.minChars, 0),
  placeholder: asText(
    raw.placeholder
    || raw.studentPlaceholder
    || raw.student_placeholder
    || 'Escribe aqui tu respuesta.',
  ),
  submitLabel: asText(raw.submitLabel || raw.cta || raw.buttonLabel || 'Evaluar respuesta'),
});

export function parseEvalBlock(blockValue, options = {}) {
  const { fallbackId = 'eval-item' } = options;

  const parsed = loadEvalYaml(blockValue);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Eval block must be a YAML object');
  }

  const type = asText(parsed.type, 'mcq').toLowerCase();
  const modeCandidate = asText(parsed.mode, 'self').toLowerCase();
  const normalizedMode = MODE_ALIASES.get(modeCandidate) || modeCandidate;

  const common = {
    id: cleanId(parsed.id, fallbackId),
    mode: ALLOWED_MODES.has(normalizedMode) ? normalizedMode : 'self',
    points: asPositiveNumber(parsed.points, 1),
    title: asText(parsed.title),
    group: asText(parsed.group || parsed.tarea),
    allowEdit: asBoolean(parsed.allowEdit ?? parsed.allowedit ?? parsed.allow_edit ?? parsed.editable, false),
  };

  if (type === 'mcq') return normalizeMcq(parsed, common);
  if (type === 'msq') return normalizeMcq(parsed, common, { forceMultiple: true });
  if (type === 'mcc') return normalizeMcc(parsed, common);
  if (type === 'poll') return normalizePoll(parsed, common);
  if (type === 'wordcloud') return normalizeWordcloud(parsed, common);
  if (type === 'patch_ai') return normalizePatchAi(parsed, common);
  if (type === 'short_ai') return normalizeShortAi(parsed, common);
  if (type === 'reference_ai') return normalizeReferenceAi(parsed, common);

  return {
    ...common,
    type,
    prompt: asText(parsed.prompt || parsed.title || ''),
    unsupported: true,
    raw: parsed,
  };
}
