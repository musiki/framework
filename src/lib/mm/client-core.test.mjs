import test from 'node:test';
import assert from 'node:assert/strict';
import { findCitekeyQuery, insertCitekey, apiErrorKind, apiErrorMessage } from './client-core.ts';

test('citekey query right after @', () => {
  assert.deepEqual(findCitekeyQuery('see @stie', 9), { start: 4, query: 'stie' });
  assert.deepEqual(findCitekeyQuery('@', 1), { start: 0, query: '' });
  assert.deepEqual(findCitekeyQuery('(@stiegler1998', 14), { start: 1, query: 'stiegler1998' });
  assert.deepEqual(findCitekeyQuery('a\n@x:y', 6), { start: 2, query: 'x:y' });
});

test('no citekey query for e-mails, plain text or caret elsewhere', () => {
  assert.equal(findCitekeyQuery('mail me@example', 15), null);
  assert.equal(findCitekeyQuery('plain text', 5), null);
  assert.equal(findCitekeyQuery('@stie later', 11), null);
  assert.equal(findCitekeyQuery('', 0), null);
  assert.equal(findCitekeyQuery('@abc', 9), null);
});

test('insert citekey replaces the partial and adds one space', () => {
  assert.deepEqual(insertCitekey('see @stie', 4, 9, 'stiegler1998'), { text: 'see @stiegler1998 ', caret: 18 });
  assert.deepEqual(insertCitekey('see @st and', 4, 7, 'stiegler1998'), { text: 'see @stiegler1998 and', caret: 17 });
});

test('api error kinds', () => {
  assert.equal(apiErrorKind(429), 'rateLimited');
  assert.equal(apiErrorKind(401), 'signIn');
  assert.equal(apiErrorKind(403), 'forbidden');
  assert.equal(apiErrorKind(404), 'notFound');
  assert.equal(apiErrorKind(409), 'conflict');
  assert.equal(apiErrorKind(400), 'invalid');
  assert.equal(apiErrorKind(415), 'invalid');
  assert.equal(apiErrorKind(500), 'generic');
  assert.equal(apiErrorKind(0), 'generic');
});

test('api error message: detail only for validation/conflict', () => {
  const s = { rateLimited: 'Slow down', signIn: 'Sign in', forbidden: 'No', notFound: 'Gone', conflict: 'Changed', invalid: 'Check', generic: 'Oops' };
  assert.equal(apiErrorMessage(429, 'Too many requests', s), 'Slow down');
  assert.equal(apiErrorMessage(400, 'title is too short', s), 'Check (title is too short)');
  assert.equal(apiErrorMessage(409, 'post already adopted', s), 'Changed (post already adopted)');
  assert.equal(apiErrorMessage(500, 'Internal error', s), 'Oops');
  assert.equal(apiErrorMessage(400, undefined, s), 'Check');
});
