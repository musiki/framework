import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { segmentParagraphs } from '../../../../src/scripts/course/notes/trace-utils.mjs';

const DEFAULT_MODEL = 'gemma4:31b-cloud';
const timeoutMs = 60000;

const ROLE_SETS: Record<string, string[]> = {
  academic: ['afirmacion', 'definicion', 'contexto', 'ejemplo', 'analisis', 'contraste', 'transicion', 'sintesis', 'metodo', 'conclusion'],
  thesis: ['afirmacion', 'definicion', 'contexto', 'ejemplo', 'analisis', 'contraste', 'transicion', 'sintesis', 'metodo', 'conclusion'],
  seminar: ['afirmacion', 'definicion', 'contexto', 'ejemplo', 'analisis', 'contraste', 'transicion', 'sintesis', 'metodo', 'conclusion'],
  submission: ['afirmacion', 'definicion', 'contexto', 'ejemplo', 'analisis', 'contraste', 'transicion', 'sintesis', 'metodo', 'conclusion'],
  lit_art: [
    'scene_opening', 'image', 'motif_introduction', 'motif_return',
    'variation', 'voice_shift', 'interruption', 'description',
    'action', 'reflection', 'memory', 'dialogue', 'tension',
    'turn', 'ellipsis', 'montage', 'resonance', 'closure'
  ],
  artistic_research: [
    'process_note', 'artistic_question', 'material_observation',
    'technical_constraint', 'decision', 'discard', 'variant',
    'method', 'documentation', 'example', 'reflection', 'analysis',
    'peer_feedback', 'ai_feedback', 'revision', 'synthesis',
    'public_artifact', 'closure'
  ]
};

const cleanupJsonCandidate = (text: string): string => {
  return text
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const noteId = cleanString(body?.noteId ?? '', 36);
  const activeMode = cleanString(body?.mode ?? 'academic', 32);

  if (!noteId) return json({ error: 'noteId required' }, 400);

  // Check notes ownership
  const { data: notes } = await query(
    `SELECT content FROM "LiveClassNote" WHERE id = $1 AND "userId" = $2`,
    [noteId, user.id],
  );
  if (!notes?.length) return json({ error: 'Note not found' }, 403);

  const noteContent = notes[0].content ?? '';
  const paras = segmentParagraphs(noteContent);
  if (paras.length === 0) {
    return json({ suggestions: [] });
  }

  const roleList = ROLE_SETS[activeMode] || ROLE_SETS.academic;
  const roleListString = roleList.join(', ');

  const paragraphsString = paras.map(p => `Párrafo ${p.index}:\n"""\n${p.text}\n"""`).join('\n\n');

  const promptOverride = `Analiza los siguientes párrafos de un texto escrito en modo de análisis "${activeMode}".
Para cada párrafo, determina su rol retórico más apropiado y extrae hasta 5 conceptos o motivos clave (cadenas léxicas o palabras clave importantes).

Modo activo: ${activeMode}
Roles retóricos permitidos (debes usar estrictamente uno de estos nombres exactos):
${roleListString}

Formato de salida requerido:
Debes responder ÚNICAMENTE con un array JSON. No agregues explicaciones, notas, código de formato ni texto introductorio. El formato debe ser estrictamente:
[
  {
    "paraIndex": 0,
    "rhetorical_role": "nombre_exacto_del_rol",
    "concepts": ["concepto1", "concepto2"]
  },
  ...
]

Párrafos a analizar:
${paragraphsString}
`;

  const correctionApiUrl = import.meta.env.CORRECTION_API_URL;
  const correctionApiToken = import.meta.env.CORRECTION_API_TOKEN;

  if (!correctionApiUrl || !correctionApiToken) {
    return json({ error: 'AI Correction API is not configured' }, 500);
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
        texto: noteContent,
        rubrica: promptOverride,
        model: DEFAULT_MODEL,
        promptOverride,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return json({ error: `AI call failed: ${errText}` }, 500);
    }

    const responseText = await response.text();
    const cleaned = cleanupJsonCandidate(responseText);
    
    let suggestions = [];
    try {
      suggestions = JSON.parse(cleaned);
    } catch (e) {
      // Attempt to extract JSON from markdown or raw text if parsing fails directly
      const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try {
          suggestions = JSON.parse(match[0]);
        } catch {
          console.error('Failed to parse extracted JSON block from AI response', e);
        }
      } else {
        console.error('Failed to parse AI response as JSON', e);
      }
    }

    return json({ suggestions });
  } catch (err: any) {
    return json({ error: err.message || 'Timeout/Network error' }, 500);
  }
};
