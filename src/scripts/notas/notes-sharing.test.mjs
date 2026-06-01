import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper duplicates for Node.js test environment (matching workspace implementations)
function formatRelativeTime(dateStr) {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'ahora';
  if (diffMins < 60) return `hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function findAnnotationOffsets(docText, quote, anchorJson) {
  if (!quote) return null;
  let index = docText.indexOf(quote);
  if (index === -1) return null;
  let nextIndex = docText.indexOf(quote, index + 1);
  if (nextIndex === -1) {
    return { from: index, to: index + quote.length };
  }
  const prefix = anchorJson?.prefix || '';
  const suffix = anchorJson?.suffix || '';
  let bestIndex = index;
  let bestScore = -1;
  let currentIdx = index;
  while (currentIdx !== -1) {
    let score = 0;
    if (prefix) {
      const docPrefix = docText.slice(Math.max(0, currentIdx - prefix.length), currentIdx);
      if (docPrefix === prefix) score += 10;
      else {
        for (let i = 1; i <= Math.min(prefix.length, docPrefix.length); i++) {
          if (docPrefix.slice(-i) === prefix.slice(-i)) score += 1;
        }
      }
    }
    if (suffix) {
      const docSuffix = docText.slice(currentIdx + quote.length, currentIdx + quote.length + suffix.length);
      if (docSuffix === suffix) score += 10;
      else {
        for (let i = 1; i <= Math.min(suffix.length, docSuffix.length); i++) {
          if (docSuffix.slice(0, i) === suffix.slice(0, i)) score += 1;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = currentIdx;
    }
    currentIdx = docText.indexOf(quote, currentIdx + 1);
  }
  return { from: bestIndex, to: bestIndex + quote.length };
}

describe('findAnnotationOffsets', () => {
  const doc = "El gato negro saltó sobre la mesa. El gato blanco durmió bajo la silla. El gato negro saltó al jardín.";

  test('finds unique quote', () => {
    const quote = "bajo la silla";
    const range = findAnnotationOffsets(doc, quote, {});
    assert.deepEqual(range, { from: doc.indexOf(quote), to: doc.indexOf(quote) + quote.length });
  });

  test('resolves duplicate quotes using prefix context', () => {
    const quote = "gato negro saltó";
    // We want the second occurrence: "El gato negro saltó al jardín."
    const anchorJson = {
      prefix: "la silla. El "
    };
    const range = findAnnotationOffsets(doc, quote, anchorJson);
    const expectedFrom = doc.lastIndexOf(quote);
    assert.equal(range.from, expectedFrom);
  });

  test('resolves duplicate quotes using suffix context', () => {
    const quote = "gato negro saltó";
    // We want the first occurrence: "El gato negro saltó sobre la mesa."
    const anchorJson = {
      suffix: " sobre la mesa"
    };
    const range = findAnnotationOffsets(doc, quote, anchorJson);
    const expectedFrom = doc.indexOf(quote);
    assert.equal(range.from, expectedFrom);
  });

  test('returns null if quote not found', () => {
    assert.equal(findAnnotationOffsets(doc, "perro marron", {}), null);
  });
});

describe('formatRelativeTime', () => {
  test('returns "ahora" for very recent times', () => {
    const now = new Date().toISOString();
    assert.equal(formatRelativeTime(now), 'ahora');
  });

  test('returns minutes for less than 1 hour', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.equal(formatRelativeTime(date), 'hace 5 min');
  });

  test('returns hours for less than 24 hours', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    assert.equal(formatRelativeTime(date), 'hace 3 h');
  });
});
