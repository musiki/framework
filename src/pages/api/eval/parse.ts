import type { APIRoute } from 'astro';
import { parseEvalBlock } from '../../../lib/eval/parse-eval-block.mjs';

export const prerender = false;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/eval/parse
 * Body: { block: string }  — el cuerpo YAML de un bloque ```eval```
 * Devuelve la normalización del parser (fuente de verdad de propiedades soportadas),
 * para el laboratorio docente de evaluaciones. No persiste nada.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Body JSON inválido' }, 400);
  }

  const block = typeof body?.block === 'string' ? body.block : '';
  if (!block.trim()) return json({ ok: false, error: 'Falta el campo "block"' }, 400);

  try {
    const parsed = parseEvalBlock(block, { fallbackId: 'lab-eval' });
    return json({
      ok: true,
      supported: !parsed?.unsupported,
      type: parsed?.type ?? null,
      parsed,
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'No se pudo parsear el bloque' }, 200);
  }
};
