import type { APIRoute } from 'astro';
import { buildPatchEvaluationPrompt } from '../../../lib/ai/patch-prompt';

const timeoutMs = Number(import.meta.env.CORRECTION_API_TIMEOUT_MS || 65000);
const maxTextChars = 12000;
const maxPromptChars = Number(import.meta.env.CORRECTION_API_MAX_PROMPT_CHARS || 50000);
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

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
  const model = ensureText(body.model) || undefined;
  const provider = ensureText(body.provider).toLowerCase() || 'ollama';
  const taskType = ensureText(body.taskType || body.type).toLowerCase();
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

  return handleOllama(requestPayload);
};

async function handleOllama({ texto, rubrica, model, promptOverride }: CorrectionRequest): Promise<Response> {
  const correctionApiUrl = import.meta.env.CORRECTION_API_URL;
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN;

  if (!correctionApiUrl || !correctionApiToken) {
    return json(
      {
        error: 'Correction API is not configured',
        missing: {
          CORRECTION_API_URL: !correctionApiUrl,
          CORRECTION_API_TOKEN: !correctionApiToken,
        },
      },
      500,
    );
  }

  try {
    const response = await fetch(`${correctionApiUrl}/api/correct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${correctionApiToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        texto,
        rubrica,
        model,
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

    if (!response.ok) {
      return json(
        {
          error: 'Correction backend failed',
          upstreamStatus: response.status,
          upstreamBody: parsed,
        },
        502,
      );
    }

    if (parsed && typeof parsed === 'object') {
      const payload = parsed as Record<string, unknown>;
      return json({ provider: 'ollama', ...payload }, 200);
    }

    return json(
      {
        ok: true,
        provider: 'ollama',
        evaluation: normalizeEvaluation(parsed),
      },
      200,
    );
  } catch (error: any) {
    return json(
      {
        error: 'Failed to reach correction backend',
        detail: error?.message || 'Unknown error',
      },
      502,
    );
  }
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

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
