import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, sanitizeSlug, slugify } from './frontmatter.ts';

test('parseFrontmatter: reads known keys and strips the frontmatter block from the body', () => {
  const markdown = `---\nslug: My Page\nmenu: true\nlayout: blog\ndraft: false\ndescription: hi\n---\nBody text.`;
  const { data, body } = parseFrontmatter(markdown);
  assert.equal(data.slug, 'my-page');
  assert.equal(data.menu, true);
  assert.equal(data.layout, 'blog');
  assert.equal(data.draft, false);
  assert.equal(data.description, 'hi');
  assert.equal(body.trim(), 'Body text.');
});

test('parseFrontmatter: drops an invalid layout instead of coercing it', () => {
  const { data } = parseFrontmatter(`---\nlayout: not-a-real-layout\n---\nBody`);
  assert.equal(data.layout, undefined);
});

test('parseFrontmatter: malformed YAML is treated as no frontmatter at all', () => {
  const markdown = `---\n: not valid yaml [\n---\nBody`;
  const { data, body } = parseFrontmatter(markdown);
  assert.deepEqual(data, {});
  assert.equal(body, markdown);
});

test('parseFrontmatter: a `---js` frontmatter block is never executed (gray-matter eval hardening)', () => {
  const globalKey = '__soog_site_frontmatter_pwned__';
  delete globalThis[globalKey];
  const markdown = `---js\nglobalThis.${globalKey} = true; ({ slug: 'pwned' })\n---\nBody text.`;

  try {
    const { data } = parseFrontmatter(markdown);
    assert.equal(globalThis[globalKey], undefined);
    // The unrecognized `---js` block yields no data, so none of its
    // (would-be eval'd) keys make it into the validated frontmatter.
    assert.deepEqual(data, {});
  } finally {
    delete globalThis[globalKey];
  }
});

test('sanitizeSlug: rejects path traversal and strips surrounding slashes', () => {
  assert.equal(sanitizeSlug('/foo/bar/'), 'foo-bar');
  assert.equal(sanitizeSlug('../etc/passwd'), undefined);
});

test('slugify: falls back to "page" for an empty result', () => {
  assert.equal(slugify('!!!'), 'page');
});
