import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentParagraphs, computeOrphanLabels,
  extractKeywords, detectChains, computeSuggestions,
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
