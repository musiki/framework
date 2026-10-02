import test from 'node:test';
import assert from 'node:assert/strict';
import { findCitekeyQuery, insertCitekey, apiErrorKind, apiErrorMessage, adminErrorKind, libraryPickerOptions, slugErrorKind } from './client-core.ts';
import { slugProblemMessage } from './slugs.ts';

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
  assert.deepEqual(insertCitekey('see @stie', 4, 9, 'stiegler1998'), { text: 'see [@stiegler1998] ', caret: 20 });
  assert.deepEqual(insertCitekey('see @st and', 4, 7, 'stiegler1998'), { text: 'see [@stiegler1998] and', caret: 19 });
  assert.deepEqual(insertCitekey('see [@st] and', 5, 8, 'stiegler1998'), { text: 'see [@stiegler1998] and', caret: 19 });
  assert.deepEqual(insertCitekey('see [@st', 5, 8, 'stiegler1998'), { text: 'see [@stiegler1998] ', caret: 20 });
  assert.deepEqual(insertCitekey('(@st).', 1, 4, 'k'), { text: '([@k]).', caret: 5 });
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

test('admin 409 reasons map to their own messages', () => {
  assert.equal(adminErrorKind(409, 'the space must keep at least one admin'), 'lastAdmin');
  assert.equal(adminErrorKind(409, 'you cannot change or remove your own membership'), 'self');
  assert.equal(adminErrorKind(409, 'a forum with this slug already exists'), 'slugTaken');
  assert.equal(adminErrorKind(409, 'this address is used by a concept'), 'slugConcept');
  assert.equal(adminErrorKind(400, '"help" is a reserved word and cannot be a forum address'), 'slugReserved');
  assert.equal(adminErrorKind(400, 'invalid slug'), null);
  assert.equal(slugErrorKind(409, 'concept slug is a forum address'), 'forum');
  assert.equal(adminErrorKind(409, 'something else'), null);
  assert.equal(adminErrorKind(400, 'the space must keep at least one admin'), null);
  assert.equal(adminErrorKind(409, undefined), null);
});

test('libraryPickerOptions: none entry, labelled libraries, selection', () => {
  const strings = { none: '(none)', option: '{path} ({count} references)', unknown: 'Current: {id}' };
  const libs = [{ id: 'a', name: 'A', path: 'diss / A', items: 3 }, { id: 'b', name: 'B', path: '', items: 0 }];
  assert.deepEqual(libraryPickerOptions(libs, 'a', strings), [
    { value: '', label: '(none)', selected: false },
    { value: 'a', label: 'diss / A (3 references)', selected: true },
    { value: 'b', label: 'B (0 references)', selected: false },
  ]);
  assert.equal(libraryPickerOptions(libs, '', strings)[0].selected, true);
});

test('libraryPickerOptions keeps a linked id missing from the list', () => {
  const out = libraryPickerOptions([], 'gone-1', { none: '-', option: '{path}', unknown: 'Current: {id}' });
  assert.deepEqual(out.at(-1), { value: 'gone-1', label: 'Current: gone-1', selected: true });
  assert.equal(out.filter((o) => o.selected).length, 1);
});

test('slugErrorKind maps the API slug errors (and nothing else)', () => {
  assert.equal(slugErrorKind(409, 'concept slug already exists'), 'taken');
  for (const p of ['reserved', 'format', 'length', 'required']) assert.equal(slugErrorKind(400, slugProblemMessage(p, 'graph')), p, p);
  assert.equal(slugErrorKind(409, 'thread is locked or archived'), null);
  assert.equal(slugErrorKind(400, 'definition required'), null);
  assert.equal(slugErrorKind(403, 'concept slug already exists'), null);
  assert.equal(slugErrorKind(400, undefined), null);
});
