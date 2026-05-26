// Pure functions mirrored from trace-margin.ts for Node test runner.

export const MIN_KEYWORD_LEN = 4;
export const TOP_KEYWORDS_PER_PARA = 5;
export const STOPWORDS = new Set([
  // Spanish
  'para', 'como', 'pero', 'más', 'con', 'que', 'una', 'uno', 'los', 'las',
  'del', 'este', 'esta', 'esto', 'desde', 'hasta', 'sobre', 'entre', 'cuando',
  'donde', 'puede', 'tiene', 'también', 'además', 'porque', 'aunque', 'según',
  'todos', 'todas', 'todo', 'bien', 'hacer', 'tener', 'haber', 'siendo', 'están',
  'estar', 'había', 'será', 'mismo', 'misma', 'mismos', 'mismas', 'ante', 'bajo',
  'cada', 'casi', 'cierto', 'contra', 'cual', 'cuya', 'dado', 'debe', 'deben',
  'ella', 'ellas', 'ellos', 'embargo', 'esas', 'esos', 'gran', 'hacia', 'incluso',
  'junto', 'lado', 'largo', 'lugar', 'manera', 'mayor', 'mediante', 'mejor',
  'menor', 'menos', 'mientras', 'modo', 'ninguna', 'ninguno', 'otras', 'otros',
  'otra', 'otro', 'pues', 'parte', 'poco', 'primer', 'primera', 'propio', 'propia',
  'sino', 'solo', 'sola', 'tanto', 'tipo', 'toda', 'tras', 'unos', 'unas',
  'varios', 'veces', 'forma', 'nivel', 'dicho', 'dicha', 'aquí', 'allí', 'ahora',
  'antes', 'después', 'siempre', 'nunca', 'algo', 'algún', 'alguna', 'algunos',
  'algunas', 'nada', 'nadie', 'mucho', 'bastante', 'demasiado', 'través',
  // English
  'that', 'with', 'this', 'have', 'from', 'they', 'will', 'been', 'were',
  'said', 'each', 'which', 'their', 'there', 'when', 'what', 'make', 'like',
  'time', 'just', 'know', 'take', 'into', 'year', 'your', 'good', 'some',
  'could', 'them', 'then', 'than', 'more', 'only', 'come', 'over', 'also',
  'back', 'after', 'first', 'well', 'most', 'about', 'would', 'very', 'these',
  'those', 'such', 'other', 'being', 'both', 'here', 'many', 'does', 'where',
  'through', 'because', 'between', 'without', 'during', 'before', 'should',
  'might', 'while', 'since', 'until', 'whether',
]);

export function segmentParagraphs(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const result = [];
  let index = 0;
  let last = 0;
  const regex = /\n[ \t]*\n|\n---\n/g;
  let match;

  const processPart = (rawPart, partFrom) => {
    const trimmed = rawPart.trim();
    if (!trimmed) return;
    const leadingSpace = rawPart.indexOf(trimmed);
    const from = partFrom + leadingSpace;
    const to = from + trimmed.length;
    const id = `p-${index}`;
    result.push({ index, text: trimmed, id, from, to });
    index++;
  };

  while ((match = regex.exec(text)) !== null) {
    processPart(text.slice(last, match.index), last);
    last = match.index + match[0].length;
  }
  processPart(text.slice(last), last);
  return result;
}

export function computeOrphanLabels(codes) {
  const counts = new Map();
  for (const c of codes) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, n]) => n === 1).map(([l]) => l));
}

export function resolveParagraphIndex(paras, position) {
  if (!paras.length) return null;
  let nearest = paras[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const para of paras) {
    if (position >= para.from && position <= para.to) return para.index;
    const distance = position < para.from ? para.from - position : position - para.to;
    if (distance < nearestDistance) {
      nearest = para;
      nearestDistance = distance;
    }
  }
  return nearest.index;
}

export function collectParagraphIndicesInRange(paras, from, to) {
  return new Set(paras
    .filter(para => para.to >= from && para.from <= to)
    .map(para => para.index));
}

const LIT_ART_APPROX_CHARS_PER_LINE = 64;

function approximateParagraphLines(text) {
  return text.split('\n').reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.trim().length / LIT_ART_APPROX_CHARS_PER_LINE)),
    0,
  );
}

export function paragraphsForAnalysis(paras, mode) {
  if (mode !== 'artistico') return paras;
  return paras.filter(para => approximateParagraphLines(para.text) > 2);
}

export function extractKeywords(text, stopwords = STOPWORDS) {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .map(lemmatizeToken)
    .filter(t => t.length >= MIN_KEYWORD_LEN && !stopwords.has(t));

  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEYWORDS_PER_PARA)
    .map(([word]) => word);
}

export function lemmatizeToken(token) {
  const word = String(token || '').toLowerCase();
  if (word.length > 8 && word.endsWith('ciones')) return `${word.slice(0, -6)}ción`;
  if (word.length > 8 && word.endsWith('idades')) return `${word.slice(0, -6)}idad`;
  if (word.length > 6 && !word.endsWith('sis') && /[aeiouáéíóú]s$/u.test(word)) return word.slice(0, -1);
  return word;
}

export function detectChains(paragraphsWithKeywords) {
  const labelToIndices = new Map();
  for (const { index, keywords } of paragraphsWithKeywords) {
    for (const kw of keywords) {
      if (!labelToIndices.has(kw)) labelToIndices.set(kw, []);
      labelToIndices.get(kw).push(index);
    }
  }
  const result = new Map();
  for (const [label, indices] of labelToIndices) {
    if (indices.length >= 2) result.set(label, indices);
  }
  return result;
}

export function computeSuggestions(paras, codes) {
  const existingSet = new Set(codes.map(c => `${c.paraIndex}:${c.label}`));

  const parasWithKeywords = paras.map(p => ({
    index: p.index,
    keywords: extractKeywords(p.text),
  }));

  const chains = detectChains(parasWithKeywords);
  const results = [];

  for (const [label, indices] of chains) {
    for (const paraIndex of indices) {
      if (!existingSet.has(`${paraIndex}:${label}`)) {
        results.push({ label, paraIndex });
      }
    }
  }
  return results;
}

export function analyzeLocalTraces(paras, roleByParagraph = new Map(), mode = 'borrador') {
  const analyzedParas = paragraphsForAnalysis(paras, mode);
  const keywordsByParagraph = analyzedParas.map(para => ({
    index: para.index,
    keywords: extractKeywords(para.text),
  }));
  const occurrences = new Map();
  for (const para of keywordsByParagraph) {
    for (const keyword of para.keywords) {
      if (!occurrences.has(keyword)) occurrences.set(keyword, []);
      occurrences.get(keyword).push(para.index);
    }
  }

  return analyzedParas.map((para, offset) => {
    const keywords = keywordsByParagraph[offset].keywords;
    const concepts = keywords.map(label => {
      const positions = occurrences.get(label) ?? [];
      const status = positions[0] === para.index ? 'introducido' : 'reutilizado';
      return { etiqueta: label, estado: status, confianza: positions.length > 1 ? 0.72 : 0.45 };
    });
    const relationsByTarget = new Map();
    for (const label of keywords) {
      const previous = (occurrences.get(label) ?? []).filter(index => index < para.index).pop();
      if (previous === undefined) continue;
      const evidence = relationsByTarget.get(previous)?.evidencia;
      relationsByTarget.set(previous, {
        indiceObjetivo: previous,
        tipo: 'retoma',
        evidencia: evidence ? `${evidence}, ${label}` : label,
        confianza: 0.68,
      });
    }
    const diagnostics = mode === 'artistico'
      ? []
      : keywords
        .filter(label => (occurrences.get(label) ?? []).length === 1)
        .map(label => ({
          severidad: 'baja',
          tipo: 'concepto_huerfano',
          etiqueta: label,
        }));
    return {
      paraIndex: para.index,
      temaPrincipal: keywords[0] ?? null,
      conceptos: concepts,
      rolRetorico: roleByParagraph.get(para.index) ?? null,
      relaciones: [...relationsByTarget.values()],
      diagnosticos: diagnostics,
      modo: mode,
    };
  });
}
