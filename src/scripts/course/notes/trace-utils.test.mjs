import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentParagraphs, computeOrphanLabels,
  resolveParagraphIndex, collectParagraphIndicesInRange,
  extractKeywords, lemmatizeToken, detectChains, computeSuggestions, analyzeLocalTraces,
  paragraphsForAnalysis,
} from './trace-utils.mjs';

describe('segmentParagraphs', () => {
  test('splits on double newline', () => {
    const result = segmentParagraphs('First.\n\nSecond.');
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'First.');
    assert.equal(result[0].index, 0);
    assert.equal(result[1].text, 'Second.');
    assert.equal(result[1].index, 1);
  });

  test('from/to positions slice correctly', () => {
    const md = 'Hello\n\nWorld';
    const [a, b] = segmentParagraphs(md);
    assert.equal(md.slice(a.from, a.to), 'Hello');
    assert.equal(md.slice(b.from, b.to), 'World');
  });

  test('filters empty segments', () => {
    const result = segmentParagraphs('\n\nOnly one.\n\n\n');
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'Only one.');
  });

  test('splits on HR separator', () => {
    const result = segmentParagraphs('Before\n---\nAfter');
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'Before');
    assert.equal(result[1].text, 'After');
  });

  test('each segment has a unique string id', () => {
    const [a, b] = segmentParagraphs('Hello world\n\nFoo bar');
    assert.equal(typeof a.id, 'string');
    assert.notEqual(a.id, b.id);
  });

  test('accepts accented Spanish paragraph text when building identifiers', () => {
    const [paragraph] = segmentParagraphs('Síntesis y transformación melódica.');
    assert.equal(paragraph.id, 'p-0');
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(segmentParagraphs(''), []);
  });
});

describe('computeOrphanLabels', () => {
  test('label on only one paragraph is an orphan', () => {
    const codes = [
      { label: 'identity', paraIndex: 0 },
      { label: 'claim',    paraIndex: 1 },
      { label: 'identity', paraIndex: 2 },
    ];
    const orphans = computeOrphanLabels(codes);
    assert.ok(orphans.has('claim'));
    assert.ok(!orphans.has('identity'));
  });

  test('all labels are orphans when each appears once', () => {
    const codes = [{ label: 'a', paraIndex: 0 }, { label: 'b', paraIndex: 1 }];
    assert.equal(computeOrphanLabels(codes).size, 2);
  });

  test('returns empty set for no codes', () => {
    assert.equal(computeOrphanLabels([]).size, 0);
  });
});

describe('live monitor paragraph tracking', () => {
  const paras = segmentParagraphs('Primero\n\nSegundo largo\n\nTercero');

  test('resolves the paragraph under the cursor and nearest paragraph in gaps', () => {
    assert.equal(resolveParagraphIndex(paras, paras[1].from + 2), 1);
    assert.equal(resolveParagraphIndex(paras, paras[1].to + 1), 1);
    assert.equal(resolveParagraphIndex([], 0), null);
  });

  test('collects paragraphs intersecting the viewport', () => {
    const visible = collectParagraphIndicesInRange(paras, paras[0].from, paras[1].from + 2);
    assert.deepEqual([...visible], [0, 1]);
  });
});

describe('extractKeywords', () => {
  test('returns top keywords by frequency', () => {
    const kws = extractKeywords('síntesis síntesis contrapunto contrapunto contrapunto melodía');
    assert.ok(kws.includes('contrapunto'));
    assert.ok(kws.includes('síntesis'));
  });

  test('filters tokens shorter than MIN_KEYWORD_LEN', () => {
    const kws = extractKeywords('si no es tan muy bien');
    assert.deepEqual(kws, []);
  });

  test('filters stopwords', () => {
    const kws = extractKeywords('través también además cuando donde forma lugar');
    assert.deepEqual(kws, []);
  });

  test('returns at most 5 keywords', () => {
    const text = 'alpha beta gamma delta epsilon zeta theta iota';
    assert.ok(extractKeywords(text).length <= 5);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(extractKeywords(''), []);
  });

  test('handles accented unicode letters', () => {
    const kws = extractKeywords('armonía armonía tonalidad tonalidad');
    assert.ok(kws.includes('armonía'));
    assert.ok(kws.includes('tonalidad'));
  });

  test('uses lightweight Spanish lemmatization before counting', () => {
    assert.equal(lemmatizeToken('melodías'), 'melodía');
    assert.equal(lemmatizeToken('transformaciones'), 'transformación');
    assert.deepEqual(extractKeywords('melodías melodía transformaciones transformación'), ['melodía', 'transformación']);
  });
});

describe('detectChains', () => {
  test('returns label → paraIndices for keywords in ≥2 paras', () => {
    const paras = [
      { index: 0, keywords: ['contrapunto', 'melodía'] },
      { index: 1, keywords: ['contrapunto', 'armonía'] },
    ];
    const chains = detectChains(paras);
    assert.ok(chains.has('contrapunto'));
    assert.deepEqual(chains.get('contrapunto'), [0, 1]);
  });

  test('does NOT return keywords appearing in only one paragraph', () => {
    const paras = [
      { index: 0, keywords: ['única'] },
      { index: 1, keywords: ['otra'] },
    ];
    const chains = detectChains(paras);
    assert.equal(chains.size, 0);
  });

  test('returns empty Map for empty input', () => {
    assert.equal(detectChains([]).size, 0);
  });
});

describe('computeSuggestions', () => {
  test('returns suggestion when chain keyword not yet coded', () => {
    const paras = [
      { index: 0, text: 'contrapunto contrapunto melodía' },
      { index: 1, text: 'contrapunto armonía armonía' },
    ];
    const suggestions = computeSuggestions(paras, []);
    assert.ok(suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 0));
    assert.ok(suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 1));
  });

  test('does NOT suggest a label already coded on that paragraph', () => {
    const paras = [
      { index: 0, text: 'contrapunto contrapunto melodía' },
      { index: 1, text: 'contrapunto armonía armonía' },
    ];
    const codes = [{ label: 'contrapunto', paraIndex: 0 }];
    const suggestions = computeSuggestions(paras, codes);
    assert.ok(!suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 0));
    assert.ok(suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 1));
  });

  test('returns empty array for single paragraph (no chains possible)', () => {
    const paras = [{ index: 0, text: 'contrapunto melodía armonía síntesis' }];
    assert.deepEqual(computeSuggestions(paras, []), []);
  });
});

describe('analyzeLocalTraces', () => {
  const paras = segmentParagraphs(
    'La melodía presenta una textura clara.\n\nLa melodía regresa como contraste.\n\nAparece únicamente timbre.',
  );

  test('creates concepts and relations for lexical chains', () => {
    const traces = analyzeLocalTraces(paras);
    assert.equal(traces[0].conceptos.find(c => c.etiqueta === 'melodía')?.estado, 'introducido');
    assert.equal(traces[1].conceptos.find(c => c.etiqueta === 'melodía')?.estado, 'reutilizado');
    assert.equal(traces[1].relaciones[0].indiceObjetivo, 0);
    assert.equal(traces[1].relaciones[0].tipo, 'retoma');
  });

  test('marks concepts not resumed later as low-severity diagnostics', () => {
    const traces = analyzeLocalTraces(paras);
    const diagnostic = traces[2].diagnosticos.find(d => d.tipo === 'concepto_huerfano' && d.etiqueta === 'timbre');
    assert.ok(diagnostic);
    assert.equal(diagnostic?.etiqueta, 'timbre');
    assert.equal('mensaje' in diagnostic, false);
  });

  test('artistic mode suppresses linear-progression diagnostics', () => {
    const longParas = segmentParagraphs(
      'La melodía extiende largamente una textura que retorna y se transforma en una memoria material del relato, con resonancias que permanecen durante toda la escena y conectan cada gesto narrativo.\n\nLa melodía reaparece largamente dentro de otra escena, desplaza su sentido original y compone una continuidad audible que permite seguir el hilo del relato aun cuando la voz se fragmenta.',
    );
    const traces = analyzeLocalTraces(longParas, new Map(), 'artistico');
    assert.ok(traces.every(trace => trace.diagnosticos.length === 0));
  });

  test('Lit Art omits short literary beats from analysis', () => {
    const literaryParas = segmentParagraphs(
      'Y Parecelso dijo:\n\nLa habitación sostenía una vibración larga, obstinada, que parecía venir de la pared y atravesaba los cuerpos mientras la conversación se volvía lentamente irreconocible y adquiría otra forma.',
    );
    const analyzed = paragraphsForAnalysis(literaryParas, 'artistico');
    assert.deepEqual(analyzed.map(para => para.index), [1]);
    assert.deepEqual(analyzeLocalTraces(literaryParas, new Map(), 'artistico').map(trace => trace.paraIndex), [1]);
  });

  test('keeps manually assigned rhetorical roles', () => {
    const traces = analyzeLocalTraces(paras, new Map([[1, 'contraste']]));
    assert.equal(traces[1].rolRetorico, 'contraste');
  });
});

describe('creative modes dummy texts and diagnostics', () => {
  test('Investigación Artística dummy text analysis', () => {
    const text = [
      '¿Cómo puede un sensor de presión transformar la escucha? Diseñé un prototipo de instrumento electrónico con un sensor de presión donde una presión mínima podía producir una respuesta sonora de escucha que no pareciera una simple traducción del gesto.',
      'La variante A respondía demasiado rápido. Cada presión generaba una vibración inmediata, casi ilustrativa. Decidí descartarla porque convertía el dispositivo en una interfaz demostrativa y no en un campo de indeterminación.',
      'La variante B introdujo una demora aleatoria entre el contacto y la vibración. Esa demora modificó el gesto y la escucha: el performer ya no podía anticipar el resultado de su gesto, y el performer empezó a ajustar cada gesto a la incertidumbre del sistema.',
      'Documenté la prueba del motor con video, audio directo y una captura del patch. La evidencia del motor muestra que los momentos más interesantes de la documentación del motor aparecen cuando el motor responde tarde and el performer interrumpe el movimiento antes de recibir confirmación sonora.',
      'Después del feedback de pares, mantuve la demora pero reduje su rango. La revisión no resolvió completamente el problema, pero hizo más clara la relación entre restricción técnica, decisión compositiva y percepción del gesto.'
    ].join('\n\n');

    const paras = segmentParagraphs(text);
    const roleByParagraph = new Map([
      [0, 'method'],
      [1, 'decision'],
      [2, 'material_observation'],
      [3, 'documentation'],
      [4, 'reflection']
    ]);

    const traces = analyzeLocalTraces(paras, roleByParagraph, 'artistic_research');

    // Assert counts
    assert.equal(traces.length, 5);

    // Assert modes
    assert.equal(traces[0].modo, 'artistic_research');

    // Assert concepts / keywords extracted
    const allConcepts = new Set(traces.flatMap(t => t.conceptos.map(c => c.etiqueta)));
    assert.ok(allConcepts.has('sensor'));
    assert.ok(allConcepts.has('motor'));
    assert.ok(allConcepts.has('gesto'));
    assert.ok(allConcepts.has('demora'));
    assert.ok(allConcepts.has('escucha'));
    assert.ok(allConcepts.has('performer'));
    assert.ok(allConcepts.has('documentación') || allConcepts.has('documenté'));

    // Assert diagnostics behavior: undocumented_decision should be suppressed
    const p1Trace = traces[1];
    assert.equal(p1Trace.rolRetorico, 'decision');
    const decisionDiag = p1Trace.diagnosticos.find(d => d.tipo === 'undocumented_decision');
    assert.equal(decisionDiag, undefined); // Suppressed because P3 is documentation
  });

  test('Lit Art dummy text analysis and diagnostics', () => {
    const text = [
      'La noche caía lentamente sobre los tejados de pizarra de la ciudad vieja, envolviendo las calles estrechas y empedradas en una niebla fría y espesa que difuminaba la luz amarilla de los faroles.',
      'El espejo reflejaba la penumbra del atardecer en el centro de la habitación vacía y polvorienta, donde el espejo de marco dorado y labrado esperaba en silencio una sombra o un rostro que nunca llegaba a aparecer.',
      'De pronto, el narrador siente que no es él quien escribe estas líneas; es otra voz más profunda la que dicta el fluir constante de las palabras desde el rincón más oscuro y apartado del estudio.',
      'Al acercarme con cautela, el espejo antiguo devolvió una imagen sumamente extraña y de espejo desconocida, completamente deformada por el paso del tiempo y las capas de polvo acumulado durante largas décadas.',
      'El murmullo constante del viento se filtraba lentamente por las rendijas estrechas de las viejas ventanas de madera carcomida, arrastrando consigo el eco lejano y melancólico de unas campanas que sonaban a medianoche. La lluvia persistente comenzaba a golpear con una fuerza obstinada y regular contra los cristales empañados de la habitación, borrando de inmediato cualquier rastro de luz o sombra en la calle solitaria. Los pocos transeúntes que aún quedaban apresuraban el paso con visible urgencia en busca de un refugio temporal en los portales oscuros y silenciosos de la avenida principal. Ninguno de aquellos hombres cansados se detuvo un solo instante a mirar hacia la ventana solitaria del segundo piso, donde la lámpara de aceite seguía encendida.'
    ].join('\n\n');

    const paras = segmentParagraphs(text);
    const roleByParagraph = new Map([
      [0, 'scene_opening'],
      [1, 'motif_introduction'],
      [2, 'voice_shift'],
      [3, 'motif_return'],
      [4, 'description']
    ]);

    const traces = analyzeLocalTraces(paras, roleByParagraph, 'lit_art');

    // Assert counts
    assert.equal(traces.length, 5);

    // Assert modes
    assert.equal(traces[0].modo, 'lit_art');

    // Assert motif return diagnostic
    const p3Trace = traces[3];
    assert.equal(p3Trace.rolRetorico, 'motif_return');
    const motifDiag = p3Trace.diagnosticos.find(d => d.tipo === 'motif_return');
    assert.ok(motifDiag);
    assert.equal(motifDiag.etiqueta, 'espejo');

    // Assert voice shift diagnostic
    const p2Trace = traces[2];
    assert.equal(p2Trace.rolRetorico, 'voice_shift');
    const voiceDiag = p2Trace.diagnosticos.find(d => d.tipo === 'voice_shift');
    assert.ok(voiceDiag);

    // Assert dense paragraph diagnostic (P4)
    const p4Trace = traces[4];
    const denseDiag = p4Trace.diagnosticos.find(d => d.tipo === 'dense_paragraph');
    assert.ok(denseDiag);
  });
});
