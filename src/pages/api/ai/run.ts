import type { APIRoute } from 'astro';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { formatOrfCapabilityPrompt } from '../../../lib/orf/capabilities';
import { normalizeOrfResponse, stringifyOrfForHumans } from '../../../lib/orf/schema';

const timeoutMs = Number(import.meta.env.CORRECTION_API_TIMEOUT_MS || 600000);
const maxPromptChars = Number(import.meta.env.CORRECTION_API_MAX_PROMPT_CHARS || 50000);
const EMBED_MODEL = 'nomic-embed-text';

const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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
        source: item.courseId?.toLowerCase() === courseId ? 'course' : 'vault',
      }));

    console.log(`[orf-rag] found ${results.length} relevant blocks`);
    return results;
  } catch (err: any) {
    console.error("[orf-rag] retrieval failed", err.message);
    return [];
  }
};

const shouldUseWebSearch = (query: string, explicit: unknown) => {
  if (explicit === true) return true;
  if (explicit === false) return false;
  return containsAny(query.toLowerCase(), [
    /\bweb\b/,
    /\bbusca(r)?\b/,
    /\bactual(es|idad)?\b/,
    /\bhoy\b/,
    /\breciente(s)?\b/,
    /\b[uú]ltim[oa]s?\b/,
    /\bfresh\b/,
    /\bnoticias?\b/,
  ]);
};

const performWebSearch = async (query: string) => {
  const maxResults = 4;
  const braveKey = ensureText(import.meta.env.BRAVE_SEARCH_API_KEY);
  const tavilyKey = ensureText(import.meta.env.TAVILY_API_KEY);
  const customUrl = ensureText(import.meta.env.ORF_WEB_SEARCH_URL);

  try {
    if (customUrl) {
      const url = new URL(customUrl);
      url.searchParams.set('q', query);
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return [];
      const payload: any = await response.json();
      const items = Array.isArray(payload.results) ? payload.results : Array.isArray(payload.items) ? payload.items : [];
      return items.slice(0, maxResults).map((item: any) => ({
        title: ensureText(item.title),
        path: ensureText(item.url || item.link),
        content: ensureText(item.snippet || item.description || item.content).slice(0, 900),
        source: 'web',
        url: ensureText(item.url || item.link),
      })).filter((item: any) => item.path || item.content);
    }

    if (braveKey) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(maxResults));
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': braveKey,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return [];
      const payload: any = await response.json();
      return (payload.web?.results ?? []).slice(0, maxResults).map((item: any) => ({
        title: ensureText(item.title),
        path: ensureText(item.url),
        content: ensureText(item.description).slice(0, 900),
        source: 'web',
        url: ensureText(item.url),
      })).filter((item: any) => item.path || item.content);
    }

    if (tavilyKey) {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          api_key: tavilyKey,
          max_results: maxResults,
          query,
          search_depth: 'basic',
        }),
      });
      if (!response.ok) return [];
      const payload: any = await response.json();
      return (payload.results ?? []).slice(0, maxResults).map((item: any) => ({
        title: ensureText(item.title),
        path: ensureText(item.url),
        content: ensureText(item.content).slice(0, 900),
        source: 'web',
        url: ensureText(item.url),
      })).filter((item: any) => item.path || item.content);
    }
  } catch (err: any) {
    console.warn('[orf-web] search failed', err?.message || err);
  }

  return [];
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
  webBlocks = [],
}: {
  message: string;
  courseId: string;
  sessionId: string;
  role: string;
  contextBlocks?: any[];
  webBlocks?: any[];
}) => {
  const agentContext = [
    'ORF es el agente transversal de Musiki. Prioriza respuestas humanas, breves y pedagógicas.',
    'ORF puede emitir acciones tipadas para chat, notas, pizarra, MIDI a Hyperpiano y partituras LilyPond.',
    'La UI ejecuta acciones validadas directamente; el JSON es solo protocolo interno y nunca debe mostrarse al usuario.',
    formatOrfCapabilityPrompt(),
  ].join('\n');
  const hasContext = contextBlocks.length > 0 || webBlocks.length > 0;
  const contextText = contextBlocks
    .map((b) => `--- FUENTE ${String(b.source || 'vault').toUpperCase()}: ${b.path} (${b.title}) ---\n${b.content}`)
    .join("\n\n");
  const webText = webBlocks
    .map((b) => `--- FUENTE WEB: ${b.url || b.path} (${b.title}) ---\n${b.content}`)
    .join("\n\n");

  return `Eres Orf, un asistente local, musical y pedagógico dentro del conference room de Musiki.
TU OBJETIVO: responder con humanidad, usar primero el curso activo, luego notas/vault de Musiki, luego tu contexto interno de agente, y finalmente fuentes web cuando existan.

Contexto de Sesión:
- cursoId: ${courseId || "desconocido"}
- sessionId: ${sessionId || "sin clase activa detectada"}
- userRole: ${role || "student"}
- fecha: ${new Date().toISOString().slice(0, 10)}

Contexto interno de ORF:
${agentContext}
${
  hasContext
    ? `\nFragmentos recuperados de Musiki:\n${contextText || "(sin notas locales relevantes)"}\n\nFragmentos web frescos:\n${webText || "(sin websearch o sin resultados configurados)"}`
    : "\n(No se encontraron fragmentos específicos. Responde con conocimiento musical general y aclara cuando no sea información del curso.)"
}

Reglas:
1. Responde en español directo, cálido y concreto. Sin saludos genéricos.
2. No inventes fuentes. Si usas fragmentos, agrega citations con path/url.
3. Propón acciones solo cuando el pedido lo implique naturalmente. No pidas confirmación.
4. Para LilyPond usa source completo con \\version "2.24.0".
5. Para MIDI usa eventos absolutos: note 0-127, startMs, durationMs, velocity 0-1.
6. Para pizarra usa coordenadas normalizadas 0..1.
7. Nunca escribas JSON dentro de summary.

Acciones disponibles:
- chat.message: { "type": "chat.message", "markdown": "texto para el chat" }
- notes.write: { "type": "notes.write", "target": "room", "mode": "append", "markdown": "nota markdown" }
- lilypond.score: { "type": "lilypond.score", "title": "titulo", "source": "\\\\version \\"2.24.0\\"\\n...", "renderPreview": true }
- midi.sequence: { "type": "midi.sequence", "target": "hyperpiano", "events": [{ "note": 60, "startMs": 0, "durationMs": 350, "velocity": 0.72 }] }
- board.note: { "type": "board.note", "text": "texto", "x": 0.12, "y": 0.18, "color": "#ffffff", "size": "sm" }
- board.draw: { "type": "board.draw", "strokes": [{ "color": "#ffffff", "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.2, "y": 0.3 }] }] }

Estructura de respuesta obligatoria, JSON estricto:
{
  "summary": "respuesta humana para mostrar al usuario",
  "actions": [
    { "type": "..." }
  ],
  "citations": [
    { "source": "course | vault | web | agent", "title": "...", "path": "...", "url": "..." }
  ],
  "warnings": []
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
  const provider = ensureText(body.provider || body.options?.provider).toLowerCase() || 'ollama';
  const model = ensureText(body.options?.model) || undefined;

  const contextBlocks = await performHybridRetrieval(message, { courseId, sessionId }, correctionApiToken);
  const webBlocks = shouldUseWebSearch(message, body.context?.webSearch)
    ? await performWebSearch(message)
    : [];

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
    webBlocks,
  });

  if (prompt.length > maxPromptChars) {
    return json({ ok: false, error: `prompt too long (max ${maxPromptChars} chars)` }, 413);
  }

  if (provider === 'deepseek') {
    return handleDeepSeekRun({ prompt, model, task, body });
  }
  if (provider === 'openrouter') {
    return handleOpenRouterRun({ prompt, model, task, body });
  }
  if (provider === 'gemini' || provider === 'google') {
    return handleGeminiRun({ prompt, model, task, body });
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
    const legacyOutput = nested
      ? nested
      : parsed && typeof parsed === 'object'
        ? {
            message: ensureText(parsed.message),
            summary: ensureText(parsed.summary) || ensureText(parsed.message) || rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
            actions: parsed.actions,
            citations: parsed.citations,
            warnings: parsed.warnings,
          }
        : {
            summary: rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
            actions: [],
          };
    const normalized = normalizeOrfResponse(legacyOutput);
    const output = {
      ...normalized,
      message: stringifyOrfForHumans(normalized),
      structured: normalized,
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

function parseAndNormalizeOrfResponse(rawOutput: string) {
  let reasoning = '';
  const thinkMatch = rawOutput.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    reasoning = thinkMatch[1].trim();
  }

  const parsed = parseJsonLoosely(rawOutput);
  const nested = unwrapNestedModelJson(parsed?.message);
  const legacyOutput = nested
    ? nested
    : parsed && typeof parsed === 'object'
      ? {
          message: ensureText(parsed.message),
          summary: ensureText(parsed.summary) || ensureText(parsed.message) || rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
          actions: parsed.actions,
          citations: parsed.citations,
          warnings: parsed.warnings,
        }
      : {
          summary: rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
          actions: [],
        };
  const normalized = normalizeOrfResponse(legacyOutput);
  return {
    output: {
      ...normalized,
      message: stringifyOrfForHumans(normalized),
      structured: normalized,
    },
    reasoning,
  };
}

type RunParams = {
  prompt: string;
  model?: string;
  task: string;
  body: Record<string, any>;
};

async function handleDeepSeekRun({ prompt, model, task, body }: RunParams): Promise<Response> {
  const deepSeekApiKey = import.meta.env.DEEPSEEK_API_KEY;
  const deepSeekBaseUrl = ensureText(import.meta.env.DEEPSEEK_BASE_URL) || DEFAULT_DEEPSEEK_BASE_URL;
  const deepSeekModel = model || ensureText(import.meta.env.DEEPSEEK_MODEL) || DEFAULT_DEEPSEEK_MODEL;

  if (!deepSeekApiKey) {
    return json({ ok: false, error: 'DeepSeek API is not configured' }, 500);
  }

  const temperature = typeof body.options?.temperature === 'number' ? body.options.temperature : 0.2;
  const maxTokens = typeof body.options?.maxTokens === 'number' ? body.options.maxTokens : 800;

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
            content: 'Eres Orf, el asistente transversal de Musiki. Devuelve SOLO JSON válido con los campos obligatorios: summary, actions, citations, warnings.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    const responseText = await response.text();
    let parsed: any = responseText;
    try {
      parsed = JSON.parse(responseText);
    } catch {}

    if (!response.ok) {
      return json({ ok: false, error: 'DeepSeek API request failed', upstreamStatus: response.status, upstream: parsed }, 502);
    }

    const rawOutput = ensureText(parsed?.choices?.[0]?.message?.content) || ensureText(parsed);
    const { output, reasoning } = parseAndNormalizeOrfResponse(rawOutput);

    const usage = parsed?.usage || {};
    return json({
      ok: true,
      task,
      provider: 'deepseek',
      model: ensureText(parsed?.model) || deepSeekModel,
      output,
      reasoning,
      timingMs: null,
      usage: {
        prompt_eval_count: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        eval_count: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
      },
    });
  } catch (error: any) {
    return json({ ok: false, error: 'Failed to reach DeepSeek API', detail: error?.message }, 502);
  }
}

async function handleOpenRouterRun({ prompt, model, task, body }: RunParams): Promise<Response> {
  const openRouterApiKey = import.meta.env.OPENROUTER_API_KEY;
  const openRouterBaseUrl = ensureText(import.meta.env.OPENROUTER_BASE_URL) || DEFAULT_OPENROUTER_BASE_URL;
  const openRouterModel = model || ensureText(import.meta.env.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL;

  if (!openRouterApiKey) {
    return json({ ok: false, error: 'OpenRouter API is not configured' }, 500);
  }

  const temperature = typeof body.options?.temperature === 'number' ? body.options.temperature : 0.2;
  const maxTokens = typeof body.options?.maxTokens === 'number' ? body.options.maxTokens : 800;

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
            content: 'Eres Orf, el asistente transversal de Musiki. Devuelve SOLO JSON válido con los campos obligatorios: summary, actions, citations, warnings.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    const responseText = await response.text();
    let parsed: any = responseText;
    try {
      parsed = JSON.parse(responseText);
    } catch {}

    if (!response.ok) {
      return json({ ok: false, error: 'OpenRouter API request failed', upstreamStatus: response.status, upstream: parsed }, 502);
    }

    const rawOutput = ensureText(parsed?.choices?.[0]?.message?.content) || ensureText(parsed);
    const { output, reasoning } = parseAndNormalizeOrfResponse(rawOutput);

    const usage = parsed?.usage || {};
    return json({
      ok: true,
      task,
      provider: 'openrouter',
      model: ensureText(parsed?.model) || openRouterModel,
      output,
      reasoning,
      timingMs: null,
      usage: {
        prompt_eval_count: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        eval_count: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
      },
    });
  } catch (error: any) {
    return json({ ok: false, error: 'Failed to reach OpenRouter API', detail: error?.message }, 502);
  }
}

async function handleGeminiRun({ prompt, model, task, body }: RunParams): Promise<Response> {
  const geminiApiKey = import.meta.env.GEMINI_API_KEY;
  const geminiBaseUrl = ensureText(import.meta.env.GEMINI_BASE_URL) || DEFAULT_GEMINI_BASE_URL;
  const geminiModel = model || ensureText(import.meta.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;

  if (!geminiApiKey) {
    return json({ ok: false, error: 'Gemini API is not configured' }, 500);
  }

  const temperature = typeof body.options?.temperature === 'number' ? body.options.temperature : 0.2;
  const maxTokens = typeof body.options?.maxTokens === 'number' ? body.options.maxTokens : 800;

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
              content: 'Eres Orf, el asistente transversal de Musiki. Devuelve SOLO JSON válido con los campos obligatorios: summary, actions, citations, warnings.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: { type: 'json_object' },
          temperature,
          max_tokens: maxTokens,
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
            parts: [{ text: 'Eres Orf, el asistente transversal de Musiki. Devuelve SOLO JSON válido con los campos obligatorios: summary, actions, citations, warnings.' }]
          },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature,
            maxOutputTokens: maxTokens,
          }
        }),
      });
    }

    const responseText = await response.text();
    let parsed: any = responseText;
    try {
      parsed = JSON.parse(responseText);
    } catch {}

    if (!response.ok) {
      return json({ ok: false, error: 'Gemini API request failed', upstreamStatus: response.status, upstream: parsed }, 502);
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

    const { output, reasoning } = parseAndNormalizeOrfResponse(rawOutput);

    return json({
      ok: true,
      task,
      provider: 'gemini',
      model: ensureText(parsedObj?.model) || geminiModel,
      output,
      reasoning,
      timingMs: null,
      usage: {
        prompt_eval_count: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        eval_count: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
      },
    });
  } catch (error: any) {
    return json({ ok: false, error: 'Failed to reach Gemini API', detail: error?.message }, 502);
  }
}
