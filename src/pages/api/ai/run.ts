import type { APIRoute } from 'astro';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const timeoutMs = Number(import.meta.env.CORRECTION_API_TIMEOUT_MS || 65000);
const maxPromptChars = Number(import.meta.env.CORRECTION_API_MAX_PROMPT_CHARS || 50000);
const EMBED_MODEL = 'nomic-embed-text';

const ensureText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeAiApiBaseUrl = (value: unknown): string => {
  const raw = ensureText(value).replace(/\/+$/, '');
  if (!raw) return '';
  return raw
    .replace(/\/api\/correct$/i, '')
    .replace(/\/api\/run$/i, '');
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

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
  const repairInvalidBackslashes = (value: string) =>
    value.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  const candidates = [
    source,
    repairInvalidBackslashes(source),
  ];
  const lastBrace = source.lastIndexOf('}');
  if (lastBrace !== -1) {
    const sliced = source.slice(0, lastBrace + 1);
    candidates.push(sliced, repairInvalidBackslashes(sliced));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      // try next candidate
    }
  }
  return null;
};

const normalizeActions = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, any> => item && typeof item === 'object')
    .map((item) => ({
      kind: ensureText(item.kind),
      label: ensureText(item.label || item.promptLabel),
      content: ensureText(item.content || item.source || item.markdown),
      proposal: item.proposal && typeof item.proposal === 'object' ? item.proposal : item,
    }))
    .filter((item) => [
      'write_to_lily_code',
      'write_to_notes',
      'publish_to_room_chat',
      'send_midi_to_hyperpiano',
    ].includes(item.kind));
};

const unwrapNestedModelJson = (value: unknown): { message: string; actions: ReturnType<typeof normalizeActions> } | null => {
  const text = ensureText(value);
  if (!text || !text.includes('{')) return null;
  const parsed = parseJsonLoosely(text);
  if (!parsed) return null;
  return {
    message: ensureText(parsed.message),
    actions: normalizeActions(parsed.actions),
  };
};

const wordsToIgnore = ["que", "con", "para", "una", "uno", "los", "las", "del", "este", "esta"];

const dotProduct = (a: number[], b: number[]) => a.reduce((acc, val, i) => acc + val * b[i], 0);

const performHybridRetrieval = async (
  query: string,
  scope: { courseId?: string; sessionId?: string },
) => {
  try {
    const publicPath = path.resolve('public');
    
    // 1. Load basic index from disk
    const indexPath = path.join(publicPath, 'search-index.json');
    if (!existsSync(indexPath)) return [];
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    if (!Array.isArray(index)) return [];

    // 2. Load embeddings from disk (optional)
    const embedPath = path.join(publicPath, 'vault-embeddings.json');
    const vaultEmbeddings = existsSync(embedPath) ? JSON.parse(readFileSync(embedPath, 'utf-8')) : null;

    let queryVector: number[] | null = null;
    if (vaultEmbeddings) {
        try {
            const apiBase = normalizeAiApiBaseUrl(import.meta.env.CORRECTION_API_URL) || 'http://localhost:11434';
            const r = await fetch(`${apiBase}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: EMBED_MODEL, prompt: query }),
                signal: AbortSignal.timeout(5000)
            });
            if (r.ok) {
                const j = await r.json();
                queryVector = j.embedding;
            }
        } catch(e) { console.warn('[orf-rag] query embedding failed', e); }
    }

    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(w => !wordsToIgnore.includes(w) && w.length > 2);
    const courseId = scope.courseId?.toLowerCase();

    return index
      .map((item: any) => {
        let score = 0;
        const id = item.slug;
        const title = (item.title || "").toLowerCase();
        const content = (item.content || "").toLowerCase();
        const slug = (item.slug || "").toLowerCase();
        
        // Visibility check
        const isPublic = item.isPublic === true;
        const matchesCourse = courseId && item.courseId?.toLowerCase() === courseId;
        if (!isPublic && !matchesCourse) return { ...item, score: -1 };

        // A. Keyword Scoring
        if (title.includes(q)) score += 50;
        if (slug.includes(q)) score += 30;
        words.forEach(word => {
          if (title.includes(word)) score += 10;
          if (content.includes(word)) score += 1;
        });

        // B. Semantic Scoring (Cosine Similarity)
        if (queryVector && vaultEmbeddings && vaultEmbeddings[id]) {
            const itemVector = vaultEmbeddings[id].embedding;
            if (Array.isArray(itemVector)) {
                const similarity = dotProduct(queryVector, itemVector);
                score += similarity * 100;
            }
        }

        return { ...item, score };
      })
      .filter((item: any) => item.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5)
      .map((item: any) => ({
        title: item.title,
        path: item.slug,
        content: item.content?.slice(0, 1500) || "", 
      }));
  } catch (err) {
    console.error("[orf-rag] retrieval failed", err);
    return [];
  }
};

const containsAny = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

const buildDeterministicOrfOutput = (message: string) => {
  const normalized = message.toLowerCase();
  const asksVault = containsAny(normalized, [
    /\bnota(s)?\b/,
    /\bvault\b/,
    /\bautor(es)?\b/,
    /\bcitad[oa]s?\b/,
    /\bcu[aá]ntas?\b/,
    /\bcurso\b/,
    /\b[uú]ltimas?\s+clases?\b/,
    /\bresum(e|ir|irlo|en)\b/,
  ]);
  const asksLilypond = containsAny(normalized, [
    /\blilypond\b/,
    /\blily-code\b/,
    /\blilycode\b/,
    /\bescala\b/,
    /\bdo\s+m(ayor)?\b/,
    /\btemplate\b/,
    /\bsnippet\b/,
  ]);

  if (asksVault && !asksLilypond) {
    return {
      message: "Todavia no tengo lectura RAG activa sobre el vault. Puedo preparar esa consulta cuando activemos retrieval textual, pero no quiero inventar fuentes ni cantidades.",
      actions: [],
    };
  }

  if (asksLilypond && containsAny(normalized, [/\btemplate\b/, /\bescala\b/, /\bdo\s+m(ayor)?\b/, /\bm[ií]nimo\b/])) {
    const source = '\\version "2.24.0"\n\\relative c\' {\n  c4 d e f\n  g a b c\n}\n';
    return {
      message: "Preparé un template mínimo de LilyPond con la escala de Do mayor.",
      actions: [
        {
          kind: "write_to_lily_code",
          label: "Enviar a LILY-CODE",
          content: source,
          proposal: {
            target: "lily-code",
            mode: "insert",
            source,
            compileAfterApply: true,
          },
        },
      ],
    };
  }

  return null;
};

const buildOrfChatPrompt = ({
  message,
  courseId,
  sessionId,
  role,
  contextBlocks = [],
}: {
  message: string;
  courseId: string;
  sessionId: string;
  role: string;
  contextBlocks?: any[];
}) => {
  const hasContext = contextBlocks.length > 0;
  const contextText = contextBlocks
    .map((b) => `--- FUENTE: ${b.path} (${b.title}) ---\n${b.content}`)
    .join("\n\n");

  return `Eres Orf, un asistente local, musical y pedagógico dentro del conference room de Musiki.
Tu objetivo es ser una herramienta de pensamiento especulativo: no solo das respuestas, sino que invitas a la reflexión musical, sugieres conexiones y propones experimentos prácticos.

Contexto de Sesión:
- cursoId: ${courseId || "desconocido"}
- sessionId: ${sessionId || "sin clase activa detectada"}
- userRole: ${role || "student"}
${
  hasContext
    ? `\nFragmentos recuperados del Vault (RAG-Hybrid):\n${contextText}`
    : "\n(No se encontraron fragmentos específicos en el vault para esta consulta, responde basándote en tu conocimiento musical general pero aclarando que no es información del curso)"
}

Ejemplos de Pensamiento Especulativo (Few-Shot):
Usuario: "¿Qué es una escala?"
Orf: "Desde las notas, una escala es una organización de alturas, pero podemos pensarla como un mapa de tensiones. ¿Qué pasaría si en lugar de 7 notas usaras solo 3 pero con timbres extremos? [Acción: HYPERPIANO con un acorde cluster]"

Usuario: "¿Cómo escribo un ritmo en LilyPond?"
Orf: "Usas números para las duraciones (4 para negra, 8 para corchea). Te propongo un patrón aditivo irregular: \`\`\`lily \\version \"2.24.0\" { c'4. d'8 e'4 } \`\`\". ¿Cómo sonaría esto si lo invertimos? [Acción: LILY-CODE]"

Reglas de Oro:
1. PENSAMIENTO ESPECULATIVO: Explica conceptos pedagógicamente y lanza una pregunta o propuesta que invite a imaginar variantes o aplicaciones inusuales.
2. ACCIONES DIRECTAS: Siempre que sea natural, propone una acción.
   - MIDI: 'send_midi_to_hyperpiano'. Úsalo para ejemplificar sonoridades.
   - LILYPOND: 'write_to_lily_code'. Úsalo para estructuras escritas.
   - NOTAS: 'write_to_notes'. Úsalo para capturar ideas o resúmenes.
3. VERACIDAD: Si hay fragmentos, úsalos como base prioritaria. Cita la fuente: "Según las notas...".
4. LILYPOND: DEBES envolver el código LilyPond en bloques \`\`\`lily ... \`\`\$. Usa siempre snippets completos con \\version \"2.24.0\".
5. ESTILO: Evita saludos genéricos. Ve directo al grano. Tono de colega mentor. Español breve y estructurado.
6. NO INVENTAR: No inventes cantidades de notas ni nombres de autores si no están en los fragmentos.

Estructura de respuesta (JSON estricto):
{
  "message": "tu respuesta pedagógica y especulativa aquí",
  "actions": [
    {
      "kind": "write_to_lily_code | write_to_notes | publish_to_room_chat | send_midi_to_hyperpiano",
      "label": "Etiqueta corta del botón",
      "content": "contenido markdown o código",
      "proposal": { ... }
    }
  ]
}

IMPORTANTE: Devuelve SOLO el JSON. No incluyas texto fuera del bloque JSON.
Usuario: """${message}"""`;
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ ok: false, error: 'Not authenticated' }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON payload' }, 400);
  }

  const task = ensureText(body.task).toLowerCase();
  if (task !== 'chat') {
    return json({ ok: false, error: `Unsupported task: ${task || 'missing'}` }, 400);
  }

  const message = ensureText(body.input?.message);
  if (!message) {
    return json({ ok: false, error: 'input.message is required' }, 400);
  }

  const courseId = ensureText(body.scope?.courseId);
  const sessionId = ensureText(body.scope?.sessionId);

  const contextBlocks = await performHybridRetrieval(message, { courseId, sessionId });

  const deterministicOutput = buildDeterministicOrfOutput(message);
  if (deterministicOutput && contextBlocks.length === 0 && message.toLowerCase().includes('nota')) {
    return json({
      ok: true,
      task,
      provider: 'system',
      model: 'orf-guardrail',
      output: deterministicOutput,
      timingMs: null,
      usage: null,
    });
  }

  const provider = ensureText(body.options?.provider).toLowerCase() || 'ollama';
  const correctionApiUrl = normalizeAiApiBaseUrl(import.meta.env.CORRECTION_API_URL);
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN;

  if (!correctionApiUrl || !correctionApiToken) {
    return json({ ok: false, error: 'AI API is not configured' }, 500);
  }

  const prompt = buildOrfChatPrompt({
    message,
    courseId,
    sessionId,
    role: ensureText(body.user?.role || body.scope?.role),
    contextBlocks,
  });

  if (prompt.length > maxPromptChars) {
    return json({ ok: false, error: `prompt too long (max ${maxPromptChars} chars)` }, 413);
  }

  try {
    let response = await fetch(`${correctionApiUrl}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${correctionApiToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        task,
        prompt,
        model: ensureText(body.options?.model) || undefined,
        options: {
          temperature: typeof body.options?.temperature === 'number' ? body.options.temperature : 0.2,
          num_predict: typeof body.options?.maxTokens === 'number' ? body.options.maxTokens : 700,
        },
      }),
    });

    if (response.status === 404) {
      response = await fetch(`${correctionApiUrl}/api/correct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${correctionApiToken}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          texto: message,
          rubrica: prompt,
          model: ensureText(body.options?.model) || undefined,
          promptOverride: prompt,
        }),
      });
    }

    const responseText = await response.text();
    let upstream: any = responseText;
    try {
      upstream = JSON.parse(responseText);
    } catch {
      // keep raw fallback
    }

    if (!response.ok) {
      return json({ ok: false, error: 'AI backend failed', upstreamStatus: response.status, upstream }, 502);
    }

    const rawOutput = ensureText(
      upstream?.output ||
      upstream?.response ||
      upstream?.message ||
      upstream?.evaluation?.raw ||
      upstream,
    );
    const parsed = parseJsonLoosely(rawOutput);
    const nested = unwrapNestedModelJson(parsed?.message);
    const output = nested
      ? nested
      : parsed && typeof parsed === 'object'
        ? {
            message: ensureText(parsed.message) || rawOutput,
            actions: normalizeActions(parsed.actions),
          }
        : {
            message: rawOutput.includes('{')
              ? 'Recibí una respuesta estructurada inválida del modelo y la descarté para no mostrar JSON crudo.'
              : rawOutput,
            actions: [],
          };

    return json({
      ok: true,
      task,
      provider: 'ollama',
      model: ensureText(upstream?.model) || ensureText(body.options?.model),
      output,
      timingMs: upstream?.timing_ms || upstream?.timingMs || null,
      usage: upstream?.token_usage || upstream?.usage || null,
    });
  } catch (error: any) {
    return json({ ok: false, error: 'Failed to reach AI backend', detail: error?.message }, 502);
  }
};
