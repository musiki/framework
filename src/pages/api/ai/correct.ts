import type { APIRoute } from 'astro';
import { buildPatchEvaluationPrompt } from '../../../lib/ai/patch-prompt';
import { buildCorrectionApiUrl } from '../../../lib/ai/correction-api-url';
import {
  DEFAULT_OLLAMA_PRIORITY_MODELS,
  pickBestAvailableOllamaModel,
  sanitizeRequestedModel,
} from '../../../lib/ai/model-priority.mjs';

const DEFAULT_ORF_API_URL = 'http://127.0.0.1:3141';
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const timeoutMs = Number(import.meta.env.CORRECTION_API_TIMEOUT_MS || 65000);
const maxTextChars = 12000;
const maxPromptChars = Number(import.meta.env.CORRECTION_API_MAX_PROMPT_CHARS || 50000);
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_RUBRIC = [
  'Interpretación del texto y comprensión de ideas',
  'Claridad de tesis y coherencia argumental',
  'Calidad de evidencias y ejemplos',
  'Precisión del lenguaje académico',
  'Sugerencia de mejora concreta',
  'Asigna una nota de 0 a 10 y justifícala brevemente',
];

const ensureText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const ensureBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'si', 'sí', 'yes', 'clara', 'claro'].includes(normalized)) return true;
    if (['false', 'no', 'unclear', 'difusa'].includes(normalized)) return false;
  }
  return false;
};

const clampScore = (value: number): number => Math.min(10, Math.max(0, value));

const parseScore = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return clampScore(value);
  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:[.,]\d+)?)\s*(?:\/\s*10)?/);
    if (!match?.[1]) return null;
    const parsed = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(parsed)) return null;
    return clampScore(parsed);
  }
  return null;
};

const ensurePair = (value: unknown): string[] => {
  let items: string[] = [];
  if (Array.isArray(value)) {
    items = value.map((item) => ensureText(item)).filter(Boolean);
  } else if (typeof value === 'string') {
    items = value
      .split(/\n|;|\u2022|\-/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const out = items.slice(0, 2);
  while (out.length < 2) out.push('');
  return out;
};

const ensureStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => ensureText(item))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n|;/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const cleanupJsonCandidate = (text: unknown): string => {
  if (typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
};

const parseJsonLoosely = (rawText: unknown): Record<string, any> | null => {
  const cleaned = cleanupJsonCandidate(rawText);
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace === -1) return null;

  const source = cleaned.slice(firstBrace);

  const tryParse = (candidate: string): Record<string, any> | null => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(source);
  if (direct) return direct;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIndex = -1;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      endIndex = i;
      break;
    }
  }

  if (endIndex !== -1) {
    const balanced = cleanupJsonCandidate(source.slice(0, endIndex + 1));
    const parsedBalanced = tryParse(balanced);
    if (parsedBalanced) return parsedBalanced;
  }

  if (depth > 0) {
    const repaired = cleanupJsonCandidate(`${source}${'}'.repeat(depth)}`);
    const parsedRepaired = tryParse(repaired);
    if (parsedRepaired) return parsedRepaired;
  }

  const lastBrace = source.lastIndexOf('}');
  if (lastBrace !== -1) {
    const sliced = cleanupJsonCandidate(source.slice(0, lastBrace + 1));
    const parsedSliced = tryParse(sliced);
    if (parsedSliced) return parsedSliced;
  }

  return null;
};

const deriveScore = ({ tesisClara, fortalezas, debilidades, sugerencia }: {
  tesisClara: boolean;
  fortalezas: string[];
  debilidades: string[];
  sugerencia: string;
}): number => {
  let score = 5;
  score += tesisClara ? 1.5 : -1;
  score += fortalezas.filter(Boolean).length * 1.2;
  score -= debilidades.filter(Boolean).length * 0.8;
  if (sugerencia.length >= 30) score += 0.6;
  return Math.round(clampScore(score) * 10) / 10;
};

const normalizeEvaluation = (rawEvaluation: unknown): Record<string, any> => {
  const base = rawEvaluation && typeof rawEvaluation === 'object' ? (rawEvaluation as Record<string, any>) : {};
  const recovered = parseJsonLoosely(base.raw || rawEvaluation) || {};

  const baseTesis = base.tesis && typeof base.tesis === 'object' ? base.tesis : {};
  const recoveredTesis = recovered.tesis && typeof recovered.tesis === 'object' ? recovered.tesis : {};
  const baseCal = base.calificacion && typeof base.calificacion === 'object' ? base.calificacion : {};
  const recCal = recovered.calificacion && typeof recovered.calificacion === 'object' ? recovered.calificacion : {};

  const resumen = ensureText(base.resumen) || ensureText(recovered.resumen);
  const tesisClara = ensureBool(baseTesis.clara ?? recoveredTesis.clara ?? base.tesis_clara ?? recovered.tesis_clara);
  const tesisExplicacion =
    ensureText(baseTesis.explicacion) ||
    ensureText(recoveredTesis.explicacion) ||
    ensureText(base.tesis_explicacion) ||
    ensureText(recovered.tesis_explicacion);

  const fortalezas = ensurePair(base.fortalezas ?? recovered.fortalezas);
  const debilidades = ensurePair(base.debilidades ?? recovered.debilidades);
  const sugerencia = ensureText(base.sugerencia) || ensureText(recovered.sugerencia);

  let nota = parseScore(baseCal.nota ?? recCal.nota ?? base.nota ?? recovered.nota);
  if (nota === null) nota = parseScore(sugerencia);
  if (nota === null) {
    nota = deriveScore({
      tesisClara,
      fortalezas,
      debilidades,
      sugerencia,
    });
  }

  const justificacion =
    ensureText(baseCal.justificacion) ||
    ensureText(recCal.justificacion) ||
    `Nota sugerida ${nota}/10 según criterios de la rúbrica.`;

  return {
    resumen,
    tesis: {
      clara: tesisClara,
      explicacion: tesisExplicacion,
    },
    fortalezas,
    debilidades,
    sugerencia,
    calificacion: {
      nota,
      justificacion,
    },
    raw: ensureText(base.raw) || ensureText(rawEvaluation),
  };
};

const createShortAiPrompt = ({
  prompt,
  studentText,
  rubricText,
}: {
  prompt: string;
  studentText: string;
  rubricText?: string;
}): string => {
  const rubric = ensureText(rubricText) || DEFAULT_RUBRIC.join('; ');

  return `Eres un asistente de corrección académica especializado en interpretación de textos.

Tu tarea: evaluar la respuesta de un estudiante a partir de una consigna del docente y devolver SOLO JSON válido (sin markdown, sin comentarios, sin texto extra) con esta estructura exacta:
{
  "resumen": "string",
  "tesis": {
    "clara": true,
    "explicacion": "string"
  },
  "fortalezas": ["string", "string"],
  "debilidades": ["string", "string"],
  "sugerencia": "string",
  "calificacion": {
    "nota": 0,
    "justificacion": "string"
  }
}

Reglas:
- Evalúa si la respuesta cumple la consigna del docente.
- "resumen": breve y objetivo (1-3 oraciones).
- "tesis.clara": booleano estricto true/false.
- "fortalezas": exactamente 2 items concretos.
- "debilidades": exactamente 2 items concretos.
- "sugerencia": una acción puntual y aplicable.
- "calificacion.nota": número entre 0 y 10 (acepta decimal, ej. 7.5).
- "calificacion.justificacion": 1 oración breve explicando por qué esa nota.
- Usa esta rúbrica base: ${rubric}

Consigna del docente:
"""
${prompt}
"""

Respuesta del estudiante:
"""
${studentText}
"""`;
};

const createReferenceAiPrompt = ({
  prompt,
  referenceText,
  studentText,
  rubricText,
}: {
  prompt: string;
  referenceText: string;
  studentText: string;
  rubricText?: string;
}): string => {
  const rubric = ensureText(rubricText) || DEFAULT_RUBRIC.join('; ');

  return `Eres un asistente de corrección académica especializado en comparación entre respuesta de referencia y respuesta estudiantil.

Tu tarea: evaluar la respuesta de un estudiante comparándola con una consigna y una respuesta de referencia. Devuelve SOLO JSON válido (sin markdown, sin comentarios, sin texto extra) con esta estructura exacta:
{
  "resumen": "string",
  "tesis": {
    "clara": true,
    "explicacion": "string"
  },
  "fortalezas": ["string", "string"],
  "debilidades": ["string", "string"],
  "sugerencia": "string",
  "calificacion": {
    "nota": 0,
    "justificacion": "string"
  }
}

Reglas:
- Evalúa si la respuesta del estudiante responde a la consigna y en qué medida se aproxima a la respuesta de referencia.
- No copies literalmente la respuesta de referencia; úsala como guía comparativa.
- "resumen": breve y objetivo (1-3 oraciones).
- "tesis.clara": booleano estricto true/false.
- "fortalezas": exactamente 2 items concretos.
- "debilidades": exactamente 2 items concretos.
- "sugerencia": una acción puntual y aplicable.
- "calificacion.nota": número entre 0 y 10 (acepta decimal, ej. 7.5).
- "calificacion.justificacion": 1 oración breve explicando por qué esa nota.
- Usa esta rúbrica base: ${rubric}

Consigna del docente:
"""
${prompt}
"""

Respuesta de referencia:
"""
${referenceText}
"""

Respuesta del estudiante:
"""
${studentText}
"""`;
};

const createDeepSeekPrompt = ({ studentText, rubricText }: { studentText: string; rubricText?: string }): string => {
  const rubric = ensureText(rubricText) || DEFAULT_RUBRIC.join('; ');

  return `Eres un asistente de corrección académica especializado en interpretación de textos.

Tu tarea: evaluar el texto de un estudiante y devolver SOLO JSON válido (sin markdown, sin comentarios, sin texto extra) con esta estructura exacta:
{
  "resumen": "string",
  "tesis": {
    "clara": true,
    "explicacion": "string"
  },
  "fortalezas": ["string", "string"],
  "debilidades": ["string", "string"],
  "sugerencia": "string",
  "calificacion": {
    "nota": 0,
    "justificacion": "string"
  }
}

Reglas:
- "resumen": breve y objetivo (1-3 oraciones).
- "tesis.clara": booleano estricto true/false.
- "fortalezas": exactamente 2 items concretos.
- "debilidades": exactamente 2 items concretos.
- "sugerencia": una acción puntual y aplicable.
- "calificacion.nota": número entre 0 y 10 (acepta decimal, ej. 7.5).
- "calificacion.justificacion": 1 oración breve explicando por qué esa nota.
- Evalúa con esta rúbrica base: ${rubric}

Texto del estudiante:
"""
${studentText}
"""`;
};

type CorrectionRequest = {
  texto?: string;
  rubrica?: string;
  model?: string;
  promptOverride?: string;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const texto = ensureText(body.texto);
  const rubrica = ensureText(body.rubrica) || undefined;
  const rawModel = ensureText(body.model);
  const provider = ensureText(body.provider).toLowerCase() || 'ollama';
  const model = (provider === 'ollama' || provider === 'orf')
    ? (sanitizeRequestedModel(rawModel) || undefined)
    : (rawModel || undefined);
  const taskType = ensureText(body.taskType || body.type).toLowerCase();
  const explicitPromptOverride = ensureText(body.promptOverride);
  let requestPayload: CorrectionRequest = {
    texto,
    rubrica,
    model,
  };

  if (taskType === 'patch' || taskType === 'patch_ai') {
    const consigna = ensureText(body.consigna || body.prompt);
    const referencePatch = ensureText(body.referencePatch || body.reference_patch);
    const studentPatch = ensureText(body.studentPatch || body.student_patch || body.texto);
    const evaluationPrompt = ensureText(
      body.evaluationPrompt
      || body.evaluatorPrompt
      || body.modelPrompt
      || body.aiPrompt
      || body.systemPrompt,
    );
    const criteriaPrompts = ensureStringList(
      body.criteriaPrompts
      || body.criteria_prompts
      || body.checks
      || body.prompts,
    );

    if (!consigna || !referencePatch || !studentPatch) {
      return json({ error: 'consigna, referencePatch and studentPatch are required for patch task' }, 400);
    }

    const promptOverride = buildPatchEvaluationPrompt({
      consigna,
      referencePatch,
      studentPatch,
      criteriaPrompts,
      evaluationPrompt,
    });

    if (promptOverride.length > maxPromptChars) {
      return json({ error: `prompt too long (max ${maxPromptChars} chars)` }, 413);
    }

    requestPayload = {
      texto: studentPatch,
      rubrica: promptOverride,
      promptOverride,
      model,
    };
  } else if (taskType === 'short' || taskType === 'short_ai') {
    const consigna = ensureText(body.consigna || body.prompt);
    const studentText = ensureText(body.studentText || body.student_text || body.texto);

    if (!consigna || !studentText) {
      return json({ error: 'prompt and texto are required for short_ai task' }, 400);
    }

    const promptOverride = explicitPromptOverride || createShortAiPrompt({
      prompt: consigna,
      studentText,
      rubricText: rubrica,
    });

    if (promptOverride.length > maxPromptChars) {
      return json({ error: `prompt too long (max ${maxPromptChars} chars)` }, 413);
    }

    requestPayload = {
      texto: studentText,
      rubrica: promptOverride,
      promptOverride,
      model,
    };
  } else if (taskType === 'reference' || taskType === 'reference_ai') {
    const consigna = ensureText(body.consigna || body.prompt);
    const referenceText = ensureText(body.referenceText || body.reference_text || body.referenceAnswer || body.reference_answer);
    const studentText = ensureText(body.studentText || body.student_text || body.texto);

    if (!consigna || !referenceText || !studentText) {
      return json({ error: 'prompt, referenceText and texto are required for reference_ai task' }, 400);
    }

    const promptOverride = explicitPromptOverride || createReferenceAiPrompt({
      prompt: consigna,
      referenceText,
      studentText,
      rubricText: rubrica,
    });

    if (promptOverride.length > maxPromptChars) {
      return json({ error: `prompt too long (max ${maxPromptChars} chars)` }, 413);
    }

    requestPayload = {
      texto: studentText,
      rubrica: promptOverride,
      promptOverride,
      model,
    };
  } else {
    if (!texto) {
      return json({ error: 'texto is required' }, 400);
    }

    if (texto.length > maxTextChars) {
      return json({ error: `texto too long (max ${maxTextChars} chars)` }, 413);
    }
  }

  if (provider === 'deepseek') {
    return handleDeepSeek(requestPayload);
  }
  if (provider === 'openrouter') {
    return handleOpenRouter(requestPayload);
  }
  if (provider === 'gemini' || provider === 'google') {
    return handleGemini(requestPayload);
  }

  return handleOllama(requestPayload, provider);
};

async function discoverInstalledOllamaModels(
  orfApiUrl: string,
  correctionApiUrl?: string,
  correctionApiToken?: string,
  ollamaBaseUrl = DEFAULT_OLLAMA_BASE_URL,
): Promise<string[]> {
  // 1. Try ORF /v1/models/installed
  try {
    const orfResp = await fetch(`${orfApiUrl.replace(/\/+$/, '')}/v1/models/installed`, {
      method: 'GET',
      signal: AbortSignal.timeout(3500),
    });
    if (orfResp.ok) {
      const data = await orfResp.json();
      const installed = Array.isArray(data?.installed)
        ? data.installed
            .filter((m: any) => m?.installed && m?.provider === 'ollama')
            .map((m: any) => ensureText(m.id).replace(/^ollama:/i, ''))
            .filter(Boolean)
        : [];
      if (installed.length > 0) return installed;
    }
  } catch {
    // Continue to next discovery source
  }

  // 2. Try correction-api /api/models
  if (correctionApiUrl && correctionApiToken) {
    try {
      const corrResp = await fetch(buildCorrectionApiUrl(correctionApiUrl, '/api/models'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${correctionApiToken}` },
        signal: AbortSignal.timeout(3500),
      });
      if (corrResp.ok) {
        const data = await corrResp.json();
        const models = Array.isArray(data?.models)
          ? data.models.map((m: any) => ensureText(m?.name || m)).filter(Boolean)
          : [];
        if (models.length > 0) return models;
      }
    } catch {
      // Continue to direct Ollama tags
    }
  }

  // 3. Try direct Ollama /api/tags
  try {
    const tagsResp = await fetch(`${ollamaBaseUrl.replace(/\/+$/, '')}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3500),
    });
    if (tagsResp.ok) {
      const data = await tagsResp.json();
      const models = Array.isArray(data?.models)
        ? data.models.map((m: any) => ensureText(m?.name || m)).filter(Boolean)
        : [];
      if (models.length > 0) return models;
    }
  } catch {
    // Ignore
  }

  return [];
}

async function evaluateViaOrf(
  orfApiUrl: string,
  resolvedModel: string,
  prompt: string,
): Promise<Response | null> {
  try {
    const orfModelId = resolvedModel.startsWith('ollama:') ? resolvedModel : `ollama:${resolvedModel}`;
    const response = await fetch(`${orfApiUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: orfModelId,
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente de corrección académica. Devuelve SOLO JSON válido sin bloques markdown ni comentarios.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        stream: false,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const rawContent = ensureText(data?.content || data?.choices?.[0]?.message?.content);
    if (!rawContent) return null;

    const evaluation = normalizeEvaluation(rawContent);
    const telemetry = data?.telemetry || {};

    return json(
      {
        ok: true,
        provider: 'orf',
        model: resolvedModel,
        created_at: new Date().toISOString(),
        evaluation,
        timing_ms: {
          total: typeof telemetry.durationMs === 'number' ? telemetry.durationMs : null,
          load: null,
          prompt_eval: null,
          eval: null,
        },
        token_usage: {
          prompt_eval_count: typeof telemetry.tokensPrompt === 'number' ? telemetry.tokensPrompt : null,
          eval_count: typeof telemetry.tokensCompletion === 'number' ? telemetry.tokensCompletion : null,
          total_tokens: typeof telemetry.tokensTotal === 'number' ? telemetry.tokensTotal : null,
        },
      },
      200,
    );
  } catch {
    return null;
  }
}

async function handleOllama(
  { texto, rubrica, model, promptOverride }: CorrectionRequest,
  requestedProvider = 'ollama',
): Promise<Response> {
  const correctionApiUrl = import.meta.env.CORRECTION_API_URL;
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN;
  const orfApiUrl = ensureText(import.meta.env.ORF_API_URL) || DEFAULT_ORF_API_URL;
  const ollamaBaseUrl = ensureText(import.meta.env.OLLAMA_BASE_URL) || DEFAULT_OLLAMA_BASE_URL;

  const availableModels = await discoverInstalledOllamaModels(
    orfApiUrl,
    correctionApiUrl,
    correctionApiToken,
    ollamaBaseUrl,
  );

  const resolvedModel = pickBestAvailableOllamaModel({
    requestedModel: model,
    defaultModel: ensureText(import.meta.env.OLLAMA_MODEL) || DEFAULT_OLLAMA_PRIORITY_MODELS[0],
    availableModels,
  });

  const prompt = ensureText(promptOverride) || createDeepSeekPrompt({
    studentText: ensureText(texto),
    rubricText: rubrica,
  });

  // If explicitly using provider: 'orf', try ORF first
  if (requestedProvider === 'orf') {
    const orfResponse = await evaluateViaOrf(orfApiUrl, resolvedModel, prompt);
    if (orfResponse) return orfResponse;
  }

  // Primary local evaluation via correction-api (/opt/ollama-api) with resolved priority model
  if (correctionApiUrl && correctionApiToken) {
    try {
      const response = await fetch(buildCorrectionApiUrl(correctionApiUrl, '/api/correct'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${correctionApiToken}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          texto,
          rubrica,
          model: resolvedModel,
          promptOverride,
        }),
      });

      const responseText = await response.text();
      let parsed: unknown = responseText;

      try {
        parsed = JSON.parse(responseText);
      } catch {
        // Keep raw text fallback.
      }

      if (response.ok) {
        if (parsed && typeof parsed === 'object') {
          const payload = parsed as Record<string, unknown>;
          return json(
            {
              provider: 'ollama',
              model: ensureText(payload.model) || resolvedModel,
              ...payload,
            },
            200,
          );
        }

        return json(
          {
            ok: true,
            provider: 'ollama',
            model: resolvedModel,
            evaluation: normalizeEvaluation(parsed),
          },
          200,
        );
      }
    } catch {
      // Fall through to ORF / direct Ollama fallback
    }
  }

  // Fallback 1: ORF service (/v1/chat/completions)
  const orfFallbackResponse = await evaluateViaOrf(orfApiUrl, resolvedModel, prompt);
  if (orfFallbackResponse) return orfFallbackResponse;

  // Fallback 2: Direct Ollama (/api/generate)
  try {
    const directResp = await fetch(`${ollamaBaseUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: resolvedModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 1200,
        },
      }),
    });

    if (directResp.ok) {
      const raw = await directResp.json();
      return json(
        {
          ok: true,
          provider: 'ollama',
          model: ensureText(raw?.model) || resolvedModel,
          created_at: raw?.created_at || new Date().toISOString(),
          evaluation: normalizeEvaluation(raw?.response || ''),
        },
        200,
      );
    }
  } catch {
    // Ignore and return final error below
  }

  return json(
    {
      error: 'Failed to reach correction backend (ollama-api and orf-api unavailable)',
      model: resolvedModel,
    },
    502,
  );
}

async function handleDeepSeek({ texto, rubrica, model, promptOverride }: CorrectionRequest): Promise<Response> {
  const deepSeekApiKey = import.meta.env.DEEPSEEK_API_KEY;
  const deepSeekBaseUrl = ensureText(import.meta.env.DEEPSEEK_BASE_URL) || DEFAULT_DEEPSEEK_BASE_URL;
  const deepSeekModel = model || ensureText(import.meta.env.DEEPSEEK_MODEL) || DEFAULT_DEEPSEEK_MODEL;

  if (!deepSeekApiKey) {
    return json(
      {
        error: 'DeepSeek API is not configured',
        missing: {
          DEEPSEEK_API_KEY: true,
        },
      },
      500,
    );
  }

  const prompt = ensureText(promptOverride) || createDeepSeekPrompt({ studentText: ensureText(texto), rubricText: rubrica });

  try {
    const response = await fetch(`${deepSeekBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepSeekApiKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: deepSeekModel,
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente de corrección académica. Devuelve SOLO JSON válido.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        stream: false,
      }),
    });

    const responseText = await response.text();
    let parsed: unknown = responseText;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Keep text fallback.
    }

    if (!response.ok) {
      return json(
        {
          error: 'DeepSeek API request failed',
          upstreamStatus: response.status,
          upstreamBody: parsed,
        },
        502,
      );
    }

    const parsedObj = parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    const rawOutput = ensureText(parsedObj?.choices?.[0]?.message?.content) || ensureText(parsed);
    const evaluation = normalizeEvaluation(rawOutput);

    const usage = parsedObj?.usage || {};
    const created = typeof parsedObj?.created === 'number'
      ? new Date(parsedObj.created * 1000).toISOString()
      : new Date().toISOString();

    return json(
      {
        ok: true,
        provider: 'deepseek',
        model: ensureText(parsedObj?.model) || deepSeekModel,
        created_at: created,
        evaluation,
        timing_ms: {
          total: null,
          load: null,
          prompt_eval: null,
          eval: null,
        },
        token_usage: {
          prompt_eval_count: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
          eval_count: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
          total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        },
      },
      200,
    );
  } catch (error: any) {
    return json(
      {
        error: 'Failed to reach DeepSeek API',
        detail: error?.message || 'Unknown error',
      },
      502,
    );
  }
}

async function handleOpenRouter({ texto, rubrica, model, promptOverride }: CorrectionRequest): Promise<Response> {
  const openRouterApiKey = import.meta.env.OPENROUTER_API_KEY;
  const openRouterBaseUrl = ensureText(import.meta.env.OPENROUTER_BASE_URL) || DEFAULT_OPENROUTER_BASE_URL;
  const openRouterModel = model || ensureText(import.meta.env.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL;

  if (!openRouterApiKey) {
    return json(
      {
        error: 'OpenRouter API is not configured',
        missing: {
          OPENROUTER_API_KEY: true,
        },
      },
      500,
    );
  }

  const prompt = ensureText(promptOverride) || createDeepSeekPrompt({ studentText: ensureText(texto), rubricText: rubrica });

  try {
    const response = await fetch(`${openRouterBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openRouterApiKey}`,
        'HTTP-Referer': 'https://musiki.org.ar',
        'X-Title': 'Musiki',
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: openRouterModel,
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente de corrección académica. Devuelve SOLO JSON válido.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        stream: false,
      }),
    });

    const responseText = await response.text();
    let parsed: unknown = responseText;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Keep text fallback.
    }

    if (!response.ok) {
      return json(
        {
          error: 'OpenRouter API request failed',
          upstreamStatus: response.status,
          upstreamBody: parsed,
        },
        502,
      );
    }

    const parsedObj = parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    const rawOutput = ensureText(parsedObj?.choices?.[0]?.message?.content) || ensureText(parsed);
    const evaluation = normalizeEvaluation(rawOutput);

    const usage = parsedObj?.usage || {};
    const created = typeof parsedObj?.created === 'number'
      ? new Date(parsedObj.created * 1000).toISOString()
      : new Date().toISOString();

    return json(
      {
        ok: true,
        provider: 'openrouter',
        model: ensureText(parsedObj?.model) || openRouterModel,
        created_at: created,
        evaluation,
        timing_ms: {
          total: null,
          load: null,
          prompt_eval: null,
          eval: null,
        },
        token_usage: {
          prompt_eval_count: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
          eval_count: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
          total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        },
      },
      200,
    );
  } catch (error: any) {
    return json(
      {
        error: 'Failed to reach OpenRouter API',
        detail: error?.message || 'Unknown error',
      },
      502,
    );
  }
}

async function handleGemini({ texto, rubrica, model, promptOverride }: CorrectionRequest): Promise<Response> {
  const geminiApiKey = import.meta.env.GEMINI_API_KEY;
  const geminiBaseUrl = ensureText(import.meta.env.GEMINI_BASE_URL) || DEFAULT_GEMINI_BASE_URL;
  const geminiModel = model || ensureText(import.meta.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;

  if (!geminiApiKey) {
    return json(
      {
        error: 'Gemini API is not configured',
        missing: {
          GEMINI_API_KEY: true,
        },
      },
      500,
    );
  }

  const prompt = ensureText(promptOverride) || createDeepSeekPrompt({ studentText: ensureText(texto), rubricText: rubrica });
  const cleanBase = geminiBaseUrl.replace(/\/+$/, '');
  const isOpenAiCompatible = cleanBase.includes('/openai');

  try {
    let response: Response;
    if (isOpenAiCompatible) {
      response = await fetch(`${cleanBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${geminiApiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: geminiModel,
          messages: [
            {
              role: 'system',
              content: 'Eres un asistente de corrección académica. Devuelve SOLO JSON válido.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: { type: 'json_object' },
          stream: false,
        }),
      });
    } else {
      const url = `${cleanBase}/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          systemInstruction: {
            parts: [{ text: 'Eres un asistente de corrección académica. Devuelve SOLO JSON válido.' }]
          },
          generationConfig: {
            responseMimeType: 'application/json',
          }
        }),
      });
    }

    const responseText = await response.text();
    let parsed: unknown = responseText;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Keep text fallback.
    }

    if (!response.ok) {
      return json(
        {
          error: 'Gemini API request failed',
          upstreamStatus: response.status,
          upstreamBody: parsed,
        },
        502,
      );
    }

    const parsedObj = parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    let rawOutput = '';
    let usage: Record<string, any> = {};

    if (isOpenAiCompatible) {
      rawOutput = ensureText(parsedObj?.choices?.[0]?.message?.content) || ensureText(parsed);
      usage = parsedObj?.usage || {};
    } else {
      rawOutput = ensureText(parsedObj?.candidates?.[0]?.content?.parts?.[0]?.text) || ensureText(parsed);
      const usageMetadata = parsedObj?.usageMetadata || {};
      usage = {
        prompt_tokens: usageMetadata.promptTokenCount,
        completion_tokens: usageMetadata.candidatesTokenCount,
        total_tokens: usageMetadata.totalTokenCount,
      };
    }

    const evaluation = normalizeEvaluation(rawOutput);
    const created = typeof parsedObj?.created === 'number'
      ? new Date(parsedObj.created * 1000).toISOString()
      : new Date().toISOString();

    return json(
      {
        ok: true,
        provider: 'gemini',
        model: ensureText(parsedObj?.model) || geminiModel,
        created_at: created,
        evaluation,
        timing_ms: {
          total: null,
          load: null,
          prompt_eval: null,
          eval: null,
        },
        token_usage: {
          prompt_eval_count: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
          eval_count: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
          total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        },
      },
      200,
    );
  } catch (error: any) {
    return json(
      {
        error: 'Failed to reach Gemini API',
        detail: error?.message || 'Unknown error',
      },
      502,
    );
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
