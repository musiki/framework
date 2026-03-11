const ensureText = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const ensureBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'si', 'sí', 'yes', 'clara', 'claro'].includes(normalized)) return true;
    if (['false', 'no', 'unclear', 'difusa'].includes(normalized)) return false;
  }
  return false;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseScoreFromText = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(?:\/\s*10)?/);
  if (!match?.[1]) return null;
  const num = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return clamp(num, 0, 10);
};

const ensureScore = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(value, 0, 10);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(numeric)) return clamp(numeric, 0, 10);
    return parseScoreFromText(trimmed);
  }

  return null;
};

const ensurePair = (value) => {
  const build = (items) => {
    const normalized = items.map(ensureText).filter(Boolean).slice(0, 2);
    while (normalized.length < 2) normalized.push('');
    return normalized;
  };

  if (Array.isArray(value)) {
    return build(value);
  }

  if (typeof value === 'string') {
    return build(
      value
        .split(/\n|;|\u2022|\-/g)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );
  }

  return ['', ''];
};

const cleanupJsonCandidate = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
};

const safeParseJson = (candidate) => {
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

function findBalancedJsonCandidate(raw) {
  const source = cleanupJsonCandidate(raw);
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
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
      return source.slice(start, i + 1);
    }
  }

  if (depth > 0) {
    return `${source.slice(start)}${'}'.repeat(depth)}`;
  }

  return null;
}

function extractFirstJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const fencedJsonMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJsonMatch?.[1]) {
    const parsed = safeParseJson(cleanupJsonCandidate(fencedJsonMatch[1]));
    if (parsed) return parsed;
  }

  const balancedCandidate = findBalancedJsonCandidate(raw);
  const balancedParsed = safeParseJson(cleanupJsonCandidate(balancedCandidate || ''));
  if (balancedParsed) return balancedParsed;

  const firstBrace = raw.indexOf('{');
  if (firstBrace === -1) return null;

  const tailCandidate = cleanupJsonCandidate(raw.slice(firstBrace));
  const parsedTail = safeParseJson(tailCandidate);
  if (parsedTail) return parsedTail;

  const repairedTail = safeParseJson(`${tailCandidate}}`);
  if (repairedTail) return repairedTail;

  return null;
}

function deriveScore({ tesisClara, fortalezas, debilidades, sugerencia }) {
  let score = 5;

  score += tesisClara ? 1.5 : -1;
  score += fortalezas.filter(Boolean).length * 1.2;
  score -= debilidades.filter(Boolean).length * 0.8;
  if (ensureText(sugerencia).length >= 30) score += 0.6;

  return Math.round(clamp(score, 0, 10) * 10) / 10;
}

function parseSections(raw) {
  const lines = raw.split('\n').map((line) => line.trim());
  const readAfter = (prefixes) => {
    const prefixList = Array.isArray(prefixes) ? prefixes : [prefixes];
    const idx = lines.findIndex((line) => prefixList.some((prefix) => line.toLowerCase().startsWith(prefix)));
    if (idx === -1) return '';

    const line = lines[idx];
    const matchedPrefix = prefixList.find((prefix) => line.toLowerCase().startsWith(prefix)) || '';
    return line.slice(matchedPrefix.length).trim() || lines[idx + 1] || '';
  };

  return {
    resumen: readAfter('resumen:'),
    tesis: {
      clara: ensureBool(readAfter(['tesis clara:', 'tesis.clara:'])),
      explicacion: readAfter(['tesis explicacion:', 'tesis explicación:', 'tesis.explicacion:', 'explicacion tesis:', 'explicación tesis:']),
    },
    fortalezas: ensurePair(readAfter('fortalezas:')),
    debilidades: ensurePair(readAfter('debilidades:')),
    sugerencia: readAfter('sugerencia:'),
    calificacion: {
      nota: ensureScore(readAfter(['calificacion.nota:', 'calificación.nota:', 'nota:', 'calificacion:', 'calificación:'])),
      justificacion: readAfter(['calificacion.justificacion:', 'calificación.justificación:', 'justificacion:', 'justificación:']),
    },
  };
}

export function normalizeModelResponse(rawResponse) {
  const parsed = extractFirstJsonObject(rawResponse) || parseSections(rawResponse || '');

  const tesisObj = typeof parsed.tesis === 'object' && parsed.tesis !== null ? parsed.tesis : {};
  const calificacionObj = typeof parsed.calificacion === 'object' && parsed.calificacion !== null ? parsed.calificacion : {};

  const fortalezas = ensurePair(parsed.fortalezas);
  const debilidades = ensurePair(parsed.debilidades);
  const sugerencia = ensureText(parsed.sugerencia);

  const parsedScore =
    ensureScore(calificacionObj.nota ?? parsed.nota ?? parsed.score) ??
    parseScoreFromText(sugerencia) ??
    parseScoreFromText(ensureText(parsed.calificacion));

  const score = parsedScore ?? deriveScore({
    tesisClara: ensureBool(tesisObj.clara ?? parsed.tesis_clara),
    fortalezas,
    debilidades,
    sugerencia,
  });

  const scoreReason = ensureText(calificacionObj.justificacion ?? parsed.calificacion_justificacion) ||
    `Nota sugerida ${score}/10 según claridad, fortalezas, debilidades y mejora propuesta.`;

  return {
    resumen: ensureText(parsed.resumen),
    tesis: {
      clara: ensureBool(tesisObj.clara ?? parsed.tesis_clara),
      explicacion: ensureText(tesisObj.explicacion ?? parsed.tesis_explicacion),
    },
    fortalezas,
    debilidades,
    sugerencia,
    calificacion: {
      nota: score,
      justificacion: scoreReason,
    },
    raw: ensureText(rawResponse),
  };
}
