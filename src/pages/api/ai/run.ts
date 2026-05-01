import type { APIRoute } from 'astro';

const timeoutMs = Number(import.meta.env.CORRECTION_API_TIMEOUT_MS || 65000);
const maxPromptChars = Number(import.meta.env.CORRECTION_API_MAX_PROMPT_CHARS || 50000);

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
      message: 'Todavia no tengo lectura RAG activa sobre el vault. Puedo preparar esa consulta cuando activemos retrieval textual, pero no quiero inventar fuentes ni cantidades.',
      actions: [],
    };
  }

  if (asksLilypond && containsAny(normalized, [/\btemplate\b/, /\bescala\b/, /\bdo\s+m(ayor)?\b/, /\bm[ií]nimo\b/])) {
    const source = '\\version "2.24.0"\n\\relative c\' {\n  c4 d e f\n  g a b c\n}\n';
    return {
      message: 'Preparé un template mínimo de LilyPond con la escala de Do mayor.',
      actions: [
        {
          kind: 'write_to_lily_code',
          label: 'Enviar a LILY-CODE',
          content: source,
          proposal: {
            target: 'lily-code',
            mode: 'insert',
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
}: {
  message: string;
  courseId: string;
  sessionId: string;
  role: string;
}) => `Eres Orf, un asistente local, musical y pedagogico dentro del conference room de Musiki.

Contexto disponible:
- courseId: ${courseId || 'desconocido'}
- sessionId: ${sessionId || 'sin clase activa detectada'}
- userRole: ${role || 'student'}
- modo: chat contextual sin RAG

Reglas:
- No inventes fuentes ni digas que consultaste notas del vault.
- No tienes RAG activo todavia. Si el usuario pide leer/resumir notas, autores citados, cantidad de notas, contenidos del vault o "ultimas clases", responde que todavia no tienes lectura RAG activa sobre el vault.
- No des numeros, autores, citas, titulos ni listas de notas si no aparecen explicitamente en este prompt.
- Responde en espanol, de forma breve, guiada y estructurada.
- Si la respuesta puede convertirse en codigo LilyPond, nota markdown, mensaje de chat o notas MIDI, agrega acciones.
- No digas que ya escribiste, publicaste o tocaste nada. Solo propones.
- Devuelve SOLO JSON valido, sin markdown externo.

Estructura exacta:
{
  "message": "respuesta para el usuario",
  "actions": [
    {
      "kind": "write_to_lily_code | write_to_notes | publish_to_room_chat | send_midi_to_hyperpiano",
      "label": "texto corto de boton",
      "content": "contenido a insertar/publicar",
      "proposal": {}
    }
  ]
}

Usa acciones solo si son naturales para la respuesta.
Para LilyPond, content debe ser codigo o bloque markdown con lilypond.
Para LilyPond minimo, usa siempre un snippet completo con \\version "2.24.0".
Para una escala de Do mayor, prefiere:
\\version "2.24.0"
\\relative c' {
  c4 d e f
  g a b c
}
Para notas, content debe ser markdown.
Para chat, content debe ser un mensaje breve apto para la sala.
Para MIDI, proposal.midiNotes debe usar pitch MIDI, startMs, durationMs y velocity.

Usuario:
"""${message}"""`;

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

  const deterministicOutput = buildDeterministicOrfOutput(message);
  if (deterministicOutput) {
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
  if (provider !== 'ollama') {
    return json({ ok: false, error: 'Only ollama provider is supported for Orf MVP' }, 400);
  }

  const correctionApiUrl = normalizeAiApiBaseUrl(import.meta.env.CORRECTION_API_URL);
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN;

  if (!correctionApiUrl || !correctionApiToken) {
    return json(
      {
        ok: false,
        error: 'AI API is not configured',
        missing: {
          CORRECTION_API_URL: !correctionApiUrl,
          CORRECTION_API_TOKEN: !correctionApiToken,
        },
      },
      500,
    );
  }

  const prompt = buildOrfChatPrompt({
    message,
    courseId: ensureText(body.scope?.courseId),
    sessionId: ensureText(body.scope?.sessionId),
    role: ensureText(body.user?.role || body.scope?.role),
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
              ? 'Recibí una respuesta estructurada inválida del modelo y la descarté para no mostrar JSON crudo. Probá reformular o usar una acción más específica.'
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
    return json(
      {
        ok: false,
        error: 'Failed to reach AI backend',
        detail: error?.message || 'Unknown error',
      },
      502,
    );
  }
};
