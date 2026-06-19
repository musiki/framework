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

export function normalizeMode(mode) {
  if (!mode) return 'academic';
  const mapping = {
    borrador: 'academic',
    seminario: 'seminar',
    tesis: 'thesis',
    artistico: 'lit_art',
    entrega: 'submission',
    academic: 'academic',
    seminar: 'seminar',
    thesis: 'thesis',
    lit_art: 'lit_art',
    artistic_research: 'artistic_research',
    submission: 'submission',
  };
  return mapping[mode] || 'academic';
}

export const EXCLUDED_ROLE = 'excluir';

export function paragraphsForAnalysis(paras, mode, roleByParagraph = new Map()) {
  const norm = normalizeMode(mode);
  const included = paras.filter(para => roleByParagraph.get(para.index) !== EXCLUDED_ROLE);
  if (norm !== 'lit_art') return included;
  return included.filter(para => approximateParagraphLines(para.text) > 2);
}

const CONNECTORS = [
  'sin embargo', 'pero', 'por lo tanto', 'en consecuencia', 'por ejemplo',
  'así', 'entonces', 'además', 'no obstante', 'por ende', 'en cambio',
  'cuando', 'al final', 'mientras', 'luego', 'después'
];

export function startsWithConnector(text) {
  const lower = (text || '').toLowerCase().trim();
  return CONNECTORS.some(c => lower.startsWith(c));
}

export function computeSentences(paraText, paragraphId) {
  const rawSentences = (paraText || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  return rawSentences.map((text, idx) => {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const length = words.length;
    const endsWithQuestion = text.endsWith('?');
    const hasConnector = startsWithConnector(text);
    return {
      id: `${paragraphId}-s-${idx}`,
      paragraphId,
      index: idx,
      text,
      role: null,
      length,
      startsWithConnector: hasConnector,
      endsWithQuestion,
      motifs: extractKeywords(text),
    };
  });
}

export function computeRhythm(sentences) {
  const sentenceCount = sentences.length;
  if (sentenceCount === 0) {
    return {
      sentenceCount: 0,
      avgSentenceLength: 0,
      lengthVariance: 0,
      shortSentenceRatio: 0,
      longSentenceRatio: 0,
      punctuationProfile: { comma: 0, semicolon: 0, colon: 0, dash: 0, question: 0, exclamation: 0 }
    };
  }
  const lengths = sentences.map(s => s.length);
  const avgSentenceLength = lengths.reduce((a, b) => a + b, 0) / sentenceCount;
  const variance = lengths.reduce((acc, len) => acc + Math.pow(len - avgSentenceLength, 2), 0) / sentenceCount;
  
  let shortCount = 0;
  let longCount = 0;
  for (const len of lengths) {
    if (len < 12) shortCount++;
    if (len > 28) longCount++;
  }
  const shortSentenceRatio = shortCount / sentenceCount;
  const longSentenceRatio = longCount / sentenceCount;
  
  const fullText = sentences.map(s => s.text).join(' ');
  const punctuationProfile = {
    comma: (fullText.match(/,/g) || []).length,
    semicolon: (fullText.match(/;/g) || []).length,
    colon: (fullText.match(/:/g) || []).length,
    dash: (fullText.match(/[-—]/g) || []).length,
    question: (fullText.match(/[?¿]/g) || []).length,
    exclamation: (fullText.match(/[!¡]/g) || []).length,
  };
  
  return {
    sentenceCount,
    avgSentenceLength,
    lengthVariance: variance,
    shortSentenceRatio,
    longSentenceRatio,
    punctuationProfile,
  };
}

export function classifyRhythm(rhythm, sentences) {
  const { sentenceCount, avgSentenceLength, lengthVariance, punctuationProfile } = rhythm;
  if (punctuationProfile.question >= 1) return 'questioning';
  
  const fullText = sentences.map(s => s.text).join(' ');
  if (fullText.includes('...') || fullText.includes('…') || (sentenceCount >= 3 && avgSentenceLength < 8)) {
    return 'fragmentary';
  }
  
  if (sentenceCount === 1 && avgSentenceLength > 28) {
    return 'single_long_sentence';
  }
  
  if (sentenceCount > 1 && sentences[sentences.length - 1].length < avgSentenceLength * 0.75) {
    return 'emphatic_closure';
  }
  
  if (sentenceCount >= 3 && avgSentenceLength < 12) {
    return 'short_sentences';
  }
  
  const commasColonsSemicolons = punctuationProfile.comma + punctuationProfile.semicolon + punctuationProfile.colon;
  if (commasColonsSemicolons >= sentenceCount * 1.0) {
    return 'accumulative';
  }
  
  if (sentenceCount >= 3 && lengthVariance > 10) {
    return 'mixed_rhythm';
  }
  
  return 'mixed_rhythm';
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

export function computeDiagnostics(mode, para, occurrences, analyzedParas, roleByParagraph) {
  const normMode = normalizeMode(mode);
  const keywords = extractKeywords(para.text);
  const diagnostics = [];
  
  if (normMode === 'academic' || normMode === 'thesis' || normMode === 'seminar' || normMode === 'submission') {
    for (const keyword of keywords) {
      const occs = occurrences.get(keyword) ?? [];
      if (occs.length === 1) {
        diagnostics.push({
          severidad: 'baja',
          tipo: 'concepto_huerfano',
          etiqueta: keyword,
        });
      }
    }
  } else if (normMode === 'lit_art') {
    const currentRole = roleByParagraph.get(para.index) || null;
    
    if (currentRole === 'motif_introduction') {
      for (const keyword of keywords) {
        const occs = occurrences.get(keyword) ?? [];
        const subsequentOccs = occs.filter(idx => idx > para.index);
        if (subsequentOccs.length === 0) {
          diagnostics.push({
            severidad: 'media',
            tipo: 'unreturned_motif',
            etiqueta: keyword,
            mensaje: `Motivo no retomado: "${keyword}"`
          });
        }
      }
    }
    
    if (currentRole === 'motif_return') {
      for (const keyword of keywords) {
        const occs = occurrences.get(keyword) ?? [];
        if (occs.some(idx => idx < para.index)) {
          diagnostics.push({
            severidad: 'baja',
            tipo: 'motif_return',
            etiqueta: keyword,
            mensaje: `Retorno del motivo "${keyword}"`
          });
        }
      }
    }
    
    if (currentRole === 'voice_shift') {
      diagnostics.push({
        severidad: 'baja',
        tipo: 'voice_shift',
        mensaje: `Cambio de voz detectado en P${para.index}`
      });
    }

    const sentences = computeSentences(para.text, para.id);
    const rhythm = computeRhythm(sentences);
    if (rhythm.avgSentenceLength > 25 && rhythm.sentenceCount > 3) {
      diagnostics.push({
        severidad: 'baja',
        tipo: 'dense_paragraph',
        mensaje: 'Párrafo denso con frases largas'
      });
    }
  } else if (normMode === 'artistic_research') {
    const currentRole = roleByParagraph.get(para.index) || null;
    const hasDocumentation = analyzedParas.some(p => roleByParagraph.get(p.index) === 'documentation');
    const hasProcess = analyzedParas.some(p => {
      const r = roleByParagraph.get(p.index);
      return r === 'process_note' || r === 'method';
    });
    const hasReflection = analyzedParas.some(p => roleByParagraph.get(p.index) === 'reflection');
    
    if (currentRole === 'decision' && !hasDocumentation) {
      diagnostics.push({
        severidad: 'media',
        tipo: 'undocumented_decision',
        mensaje: 'Decisión sin documentación en el proceso'
      });
    }
    
    if (currentRole === 'material_observation' && !hasDocumentation) {
      diagnostics.push({
        severidad: 'media',
        tipo: 'missing_material_evidence',
        mensaje: 'Observación material sin evidencia de documentación'
      });
    }

    if (currentRole === 'variant') {
      const totalVariants = analyzedParas.filter(p => roleByParagraph.get(p.index) === 'variant').length;
      const hasAnalysis = analyzedParas.some(p => roleByParagraph.get(p.index) === 'analysis');
      if (totalVariants === 1 && !hasAnalysis) {
        diagnostics.push({
          severidad: 'baja',
          tipo: 'variant_without_comparison',
          mensaje: 'Variante sin comparación de alternativas'
        });
      }
    }
    
    if (currentRole === 'reflection' && !hasProcess) {
      diagnostics.push({
        severidad: 'baja',
        tipo: 'reflection_without_process',
        mensaje: 'Reflexión sin registro previo de proceso'
      });
    }
    
    if (currentRole === 'process_note' && !hasReflection) {
      diagnostics.push({
        severidad: 'baja',
        tipo: 'process_without_reflection',
        mensaje: 'Nota de proceso sin reflexión crítica asociada'
      });
    }
  }
  
  return diagnostics;
}

export function analyzeLocalTraces(paras, roleByParagraph = new Map(), mode = 'borrador') {
  const normMode = normalizeMode(mode);
  const analyzedParas = paragraphsForAnalysis(paras, normMode, roleByParagraph);
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
    
    const diagnostics = computeDiagnostics(normMode, para, occurrences, analyzedParas, roleByParagraph);
    const sentences = computeSentences(para.text, para.id);
    const rhythm = computeRhythm(sentences);
    const rhythmClass = classifyRhythm(rhythm, sentences);
    
    return {
      paraIndex: para.index,
      temaPrincipal: keywords[0] ?? null,
      conceptos: concepts,
      rolRetorico: roleByParagraph.get(para.index) ?? null,
      relaciones: [...relationsByTarget.values()],
      diagnosticos: diagnostics,
      modo: normMode,
      paragraphId: para.id,
      rhythm,
      rhythmClass,
      sentences,
    };
  });
}
