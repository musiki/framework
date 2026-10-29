import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canViewReview,
  computeUrnCandidates,
  countWords,
  validatePairSelection,
} from './logic.ts';

describe('Amigx Críticx — logic & urn rules', () => {
  test('countWords counts words accurately with no maximum limit', () => {
    assert.equal(countWords(''), 0);
    assert.equal(countWords('   \n\t  '), 0);
    assert.equal(countWords('Una sola oración de prueba.'), 5);
    assert.equal(countWords('Uno   dos\ntres\tcuatro'), 4);
    const longText = Array.from({ length: 1500 }, (_, i) => `palabra${i}`).join(' ');
    assert.equal(countWords(longText), 1500);
  });

  test('validatePairSelection enforces non-self, first-come-first-take urn, and non-reciprocal rule', () => {
    const existingPairs = [
      { authorUserId: 'u-ana', recipientUserId: 'u-bruno' },
      { authorUserId: 'u-carla', recipientUserId: 'u-diego' },
    ];

    // 1. Self selection forbidden
    const selfRes = validatePairSelection('u-ana', 'u-ana', existingPairs);
    assert.equal(selfRes.ok, false);
    if (!selfRes.ok) assert.equal(selfRes.code, 'SELF');

    // 2. First-come, first-take: u-bruno is already taken by u-ana
    const takenRes = validatePairSelection('u-elena', 'u-bruno', existingPairs);
    assert.equal(takenRes.ok, false);
    if (!takenRes.ok) assert.equal(takenRes.code, 'ALREADY_TAKEN');

    // 3. Same author re-saving their own recipient is allowed
    const ownRes = validatePairSelection('u-ana', 'u-bruno', existingPairs);
    assert.equal(ownRes.ok, true);

    // 4. Non-reciprocal (crossed critical friends): u-bruno cannot choose u-ana because u-ana chose u-bruno
    const reciprocalRes = validatePairSelection('u-bruno', 'u-ana', existingPairs);
    assert.equal(reciprocalRes.ok, false);
    if (!reciprocalRes.ok) assert.equal(reciprocalRes.code, 'RECIPROCAL');

    // 5. Valid non-reciprocal, untaken choice: u-bruno chooses u-carla
    const validRes = validatePairSelection('u-bruno', 'u-carla', existingPairs);
    assert.equal(validRes.ok, true);
  });

  test('computeUrnCandidates removes self, taken students, and anyone who chose current user', () => {
    const students = [
      { id: 'u-ana', name: 'Ana', email: 'ana@test.ar' },
      { id: 'u-bruno', name: 'Bruno', email: 'bruno@test.ar' },
      { id: 'u-carla', name: 'Carla', email: 'carla@test.ar' },
      { id: 'u-diego', name: 'Diego', email: 'diego@test.ar' },
    ];
    // Ana chose Bruno
    const pairs = [{ authorUserId: 'u-ana', recipientUserId: 'u-bruno' }];

    // From Bruno's perspective:
    // - Bruno is excluded (self)
    // - Ana is excluded (non-reciprocal: Ana already chose Bruno!)
    // - Carla and Diego remain available
    const brunoCandidates = computeUrnCandidates(students, pairs, 'u-bruno');
    assert.deepEqual(
      brunoCandidates.map((s) => s.id),
      ['u-carla', 'u-diego'],
    );

    // From Carla's perspective:
    // - Carla is excluded (self)
    // - Bruno is excluded (already taken by Ana in the urn)
    // - Ana and Diego remain available
    const carlaCandidates = computeUrnCandidates(students, pairs, 'u-carla');
    assert.deepEqual(
      carlaCandidates.map((s) => s.id),
      ['u-ana', 'u-diego'],
    );
  });

  test('canViewReview enforces visibility for teachers, author, recipient, and public toggle', () => {
    const privateSubmitted = {
      authorUserId: 'u-ana',
      recipientUserId: 'u-bruno',
      isPublic: false,
      status: 'submitted',
    };

    assert.equal(canViewReview(privateSubmitted, 'u-ana', false), true);
    assert.equal(canViewReview(privateSubmitted, 'u-bruno', false), true);
    assert.equal(canViewReview(privateSubmitted, 'u-carla', false), false);
    assert.equal(canViewReview(privateSubmitted, 'u-teacher', true), true);

    const publicSubmitted = {
      ...privateSubmitted,
      isPublic: true,
    };
    assert.equal(canViewReview(publicSubmitted, 'u-carla', false), true);
  });

  test('migration SQL defines AmigxCriticxReview with urn and non-self constraints', () => {
    const sql = readFileSync(
      new URL('../../../postgres-patches/migrations/20261028220000_amigx_criticx.sql', import.meta.url),
      'utf8',
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "AmigxCriticxReview"/);
    assert.match(sql, /UNIQUE \("courseId", "authorUserId"\)/);
    assert.match(sql, /UNIQUE \("courseId", "recipientUserId"\)/);
    assert.match(sql, /CHECK \("authorUserId" <> "recipientUserId"\)/);
  });
});
