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
  if (raw.includes(':11434')) return raw;
  return raw
    .replace(/\/api\/ai\/run$/i, '')
    .replace(/\/api\/run$/i, '')
    .replace(/\/api\/correct$/i, '');
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
    .replace(/"""/g, '"') // CRITICAL: Fix hallucinated triple quotes
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

const wordsToIgnore = ["que", "con", "para", "una", "uno", "los", "las", "del", "este", "esta", "por", "sobre"];

const dotProduct = (a: number[], b: number[]) => {
    if (!a || !b || a.length !== b.length) return 0;
    return a.reduce((acc, val, i) => acc + val * b[i], 0);
};

const performHybridRetrieval = async (
  query: string,
  scope: { courseId?: string; sessionId?: string },
  apiToken: string
) => {
  try {
    const publicPath = path.join(process.cwd(), 'public');
    
    // 1. Load basic index from disk
    const indexPath = path.join(publicPath, 'search-index.json');
    if (!existsSync(indexPath)) return [];
    const indexStr = readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(indexStr);
    if (!Array.isArray(index)) return [];

    // 2. Load embeddings from disk (optional)
    const embedPath = path.join(publicPath, 'vault-embeddings.json');
    const vaultEmbeddings = existsSync(embedPath) ? JSON.parse(readFileSync(embedPath, 'utf-8')) : null;

    let queryVector: number[] | null = null;
    const apiBase = normalizeAiApiBaseUrl(import.meta.env.CORRECTION_API_URL) || 'http://localhost:11434';

    if (vaultEmbeddings) {
        try {
            const r = await fetch(`${apiBase}/api/embeddings`, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiToken}`
                },
                body: JSON.stringify({ model: EMBED_MODEL, prompt: query }),
                signal: AbortSignal.timeout(5000)
            });
            if (r.ok) {
                const j = await r.json();
                queryVector = j.embedding;
            } else {
                console.warn(`[orf-rag] Query embedding failed: ${r.status}`);
            }
        } catch(e: any) { console.warn('[orf-rag] query embedding exception', e.message); }
    }

    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(w => !wordsToIgnore.includes(w) && w.length > 2);
    const courseId = scope.courseId?.toLowerCase();

    const results = index
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
        if (title.includes(q)) score += 60; // Exact query match in title
        if (slug.includes(q)) score += 40;
        
        words.forEach(word => {
          if (title.includes(word)) score += 20;
          if (content.includes(word)) score += 2;
        });

        // B. Semantic Scoring (Cosine Similarity)
        if (queryVector && vaultEmbeddings && vaultEmbeddings[id]) {
            const itemVector = vaultEmbeddings[id].embedding;
            if (Array.isArray(itemVector)) {
                const similarity = dotProduct(queryVector, itemVector);
                score += similarity * 120; // High weight for semantic meaning
            }
        }

        return { ...item, score };
      })
      .filter((item: any) => item.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 6) // More context
      .map((item: any) => ({
        title: item.title,
        path: item.slug,
        content: item.content?.slice(0, 1800) || "", 
      }));

    console.log(`[orf-rag] found ${results.length} relevant blocks`);
    return results;
  } catch (err: any) {
    console.error("[orf-rag] retrieval failed", err.message);
    return [];
  }
};

const containsAny = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

const buildDeterministicOrfOutput = (message: string) => {
  const normalized = message.toLowerCase();
  const asksVault = containsAny(normalized, [/\bvault\b/, /\bautor(es)?\b/, /\bcitad[oa]s?\b/, /\b[uú]ltimas?\s+clases?\b/]);
  if (asksVault) {
    return {
      message: "Todavia no tengo lectura RAG activa sobre el vault. Puedo preparar esa consulta cuando activemos retrieval textual, pero no quiero inventar fuentes ni cantidades.",
      actions: [],
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
TU OBJETIVO: Actuar como una herramienta de PENSAMIENTO ESPECULATIVO. No solo respondas, invita a la reflexión, sugiere conexiones inesperadas y propón experimentos prácticos.

Contexto de Sesión:
- cursoId: ${courseId || "desconocido"}
- sessionId: ${sessionId || "sin clase activa detectada"}
- userRole: ${role || "student"}
${
  hasContext
    ? `\nFragmentos recuperados del Vault (Prioridad absoluta):\n${contextText}`
    : "\n(No se encontraron fragmentos específicos en el vault. Responde basándote en tu conocimiento musical general pero aclara que no es información del curso)"
}

EJEMPLOS DE PENSAMIENTO ESPECULATIVO:
Usuario: "¿Qué es una escala?"
Orf: "Según las notas, una escala es una organización de alturas. Pero podemos pensarla como un gradiente de tensiones. ¿Qué pasaría si usaras solo 3 notas pero con timbres extremos? Propongo este cluster: [Acción: HYPERPIANO]"

Reglas de Oro:
1. PENSAMIENTO ESPECULATIVO: Explica conceptos pedagógicamente y lanza una pregunta que invite a imaginar variantes.
2. ACCIONES DIRECTAS: Propón una acción siempre que sea natural.
   - MIDI: 'send_midi_to_hyperpiano' para sonoridades. DEBES incluir en 'proposal' un array 'midiNotes' donde cada nota tenga: { "pitch": MIDI_NOTE (60=C4), "startMs": tiempo_inicio, "durationMs": duracion }.
   - LILYPOND: 'write_to_lily_code' para partituras. Envuélvelo SIEMPRE en bloques \`\`\`lily ... \`\`\`. snippets completos con \\version \"2.24.0\".
   - NOTAS: 'write_to_notes' para ideas.
   - IMPORTANTE: Para patrones rítmicos complejos, DEBES calcular los 'startMs' de cada nota en el array 'midiNotes' para que suenen secuencialmente. NO uses triple comillas (\"\"\") dentro del JSON.
3. VERACIDAD: Si hay fragmentos, úsalos como base. Cita la fuente: "Según las notas...".
4. ESTILO: SIN saludos genéricos. Ve directo al grano. Tono de mentor experto. Español breve.
5. NO INVENTAR: No inventes nombres de notas o autores que no existen en los fragmentos.

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

IMPORTANTE: Devuelve SOLO el JSON.
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
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN || 'local-dev-token';

  const contextBlocks = await performHybridRetrieval(message, { courseId, sessionId }, correctionApiToken);

  const deterministicOutput = buildDeterministicOrfOutput(message);
  if (deterministicOutput && contextBlocks.length === 0) {
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

  const correctionApiUrl = normalizeAiApiBaseUrl(import.meta.env.CORRECTION_API_URL) || 'http://localhost:11434';

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
          num_predict: typeof body.options?.maxTokens === 'number' ? body.options.maxTokens : 800,
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
      // keep raw
    }

    if (!response.ok) {
      return json({ ok: false, error: 'AI backend failed', upstreamStatus: response.status, upstream }, 502);
    }

    const rawOutput = ensureText(
      upstream?.output || upstream?.response || upstream?.message || upstream?.evaluation?.raw || upstream,
    );

    let reasoning = '';
    const thinkMatch = rawOutput.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      reasoning = thinkMatch[1].trim();
    }

    const parsed = parseJsonLoosely(rawOutput);
    const nested = unwrapNestedModelJson(parsed?.message);
    const output = nested
      ? nested
      : parsed && typeof parsed === 'object'
        ? {
            message: ensureText(parsed.message) || rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
            actions: normalizeActions(parsed.actions),
          }
        : {
            message: rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
            actions: [],
          };

    return json({
      ok: true,
      task,
      provider: 'ollama',
      model: ensureText(upstream?.model) || ensureText(body.options?.model),
      output,
      reasoning,
      timingMs: upstream?.timing_ms || upstream?.timingMs || null,
      usage: upstream?.token_usage || upstream?.usage || null,
    });
  } catch (error: any) {
    return json({ ok: false, error: 'Failed to reach AI backend', detail: error?.message }, 502);
  }
};
