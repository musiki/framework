import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupByChapter, computeNewOrders, noteSlugToRelPath, slugify, escHtml } from './notes-sidebar-utils.mjs';

describe('groupByChapter', () => {
  test('groups notes by chapter and sorts by order', () => {
    const notes = [
      { slug: 'cursos/s1/a.md', title: 'A', chapter: 'Ch1', order: 2, type: 'lesson', status: 'draft', filePath: '' },
      { slug: 'cursos/s1/b.md', title: 'B', chapter: 'Ch1', order: 1, type: 'lesson', status: 'draft', filePath: '' },
      { slug: 'cursos/s1/c.md', title: 'C', chapter: 'Ch2', order: 0, type: 'lesson', status: 'draft', filePath: '' },
    ];
    const groups = groupByChapter(notes);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].name, 'Ch2'); // Ch2 has min order 0
    assert.equal(groups[1].notes[0].slug, 'cursos/s1/b.md'); // Ch1 sorted: b(1) before a(2)
  });

  test('notes without chapter go to (sin capítulo)', () => {
    const notes = [
      { slug: 'x', title: 'X', chapter: '', order: 0, type: 'lesson', status: 'draft', filePath: '' },
    ];
    const groups = groupByChapter(notes);
    assert.equal(groups[0].name, '(sin capítulo)');
  });

  test('respects new order of notes across chapters to sort chapters', () => {
    const notes = [
      { slug: 'cursos/s1/a.md', title: 'A', chapter: 'Ch1', order: 2, type: 'lesson', status: 'draft', filePath: '' },
      { slug: 'cursos/s1/b.md', title: 'B', chapter: 'Ch2', order: 1, type: 'lesson', status: 'draft', filePath: '' },
    ];
    // Initially, min order of Ch2 is 1, Ch1 is 2. So Ch2 comes first.
    let groups = groupByChapter(notes);
    assert.equal(groups[0].name, 'Ch2');
    assert.equal(groups[1].name, 'Ch1');

    // If we re-assign sequential orders to place Ch1 first:
    // Ch1 note order = 0, Ch2 note order = 1
    notes.find(n => n.chapter === 'Ch1').order = 0;
    notes.find(n => n.chapter === 'Ch2').order = 1;

    groups = groupByChapter(notes);
    assert.equal(groups[0].name, 'Ch1');
    assert.equal(groups[1].name, 'Ch2');
  });

  test('sorts chapters with digit prefixes using the prefix as order fallback', () => {
    const notes = [
      { slug: 'cursos/s1/a.md', title: 'A', chapter: '80 RECURSOS', order: 0, type: 'lesson', status: 'draft', filePath: '' },
      { slug: 'cursos/s1/b.md', title: 'B', chapter: '70 CONCEPTOS', order: 0, type: 'lesson', status: 'draft', filePath: '' },
      { slug: 'cursos/s1/c.md', title: 'C', chapter: '02 ACÚSTICA', order: 0, type: 'lesson', status: 'draft', filePath: '' },
    ];
    const groups = groupByChapter(notes);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].name, '02 ACÚSTICA');
    assert.equal(groups[1].name, '70 CONCEPTOS');
    assert.equal(groups[2].name, '80 RECURSOS');
  });
});

describe('computeNewOrders', () => {
  const notes = [
    { slug: 'a', order: 0, title: 'A', chapter: '', type: '', status: '', filePath: '' },
    { slug: 'b', order: 1, title: 'B', chapter: '', type: '', status: '', filePath: '' },
    { slug: 'c', order: 2, title: 'C', chapter: '', type: '', status: '', filePath: '' },
  ];

  test('moves c to first position', () => {
    const result = computeNewOrders(notes, 'c', null);
    assert.deepEqual(result.map(r => r.slug), ['c', 'a', 'b']);
    assert.deepEqual(result.map(r => r.order), [0, 1, 2]);
  });

  test('moves a after c', () => {
    const result = computeNewOrders(notes, 'a', 'c');
    assert.deepEqual(result.map(r => r.slug), ['b', 'c', 'a']);
  });

  test('returns empty if draggedSlug not found', () => {
    assert.deepEqual(computeNewOrders(notes, 'z', null), []);
  });
});

describe('noteSlugToRelPath', () => {
  test('strips courseId prefix and .md, normalizes accents+spaces', () => {
    const rel = noteSlugToRelPath('cursos/s123/10 Introducción/lesson-01.md', 's123');
    assert.equal(rel, '10-introduccion/lesson-01');
  });

  test('flat note (no subfolder)', () => {
    const rel = noteSlugToRelPath('cursos/s123/tropo.md', 's123');
    assert.equal(rel, 'tropo');
  });
});

describe('slugify', () => {
  test('normalizes title to slug', () => {
    assert.equal(slugify('Armonía Básica'), 'armonia-basica');
    assert.equal(slugify('  Intro  '), 'intro');
  });

  test('strips special chars', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
  });
});

describe('escHtml', () => {
  test('escapes HTML entities', () => {
    assert.equal(escHtml('<script>&"test"</script>'), '&lt;script&gt;&amp;&quot;test&quot;&lt;/script&gt;');
  });
});
