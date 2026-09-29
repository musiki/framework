// Concept definitions render through the same sanitized mm renderer as posts
// (createMmPostRenderer + renderForumMarkdown + the bounded render cache), end
// to end with a fake lilypond-service: script stripped, KaTeX kept, ```lily
// fences become a same-origin /lily/<hash>.svg figure written to the store.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fakeService, makeTmpDir, ok } from '../lilypond/test/fake-service.mjs';

// lilypond-rendered-comment keeps a cache under <cwd>/.cache: isolate it.
const workDir = makeTmpDir('mm-def-render-');
process.chdir(workDir);
const store = path.join(workDir, 'store');
process.env.LILYPOND_ASSET_DIR = store;

const { getConcept } = await import('./concepts-core.ts');
const { createMmPostRenderer } = await import('./post-render.ts');
const { createRenderCache } = await import('./forum-render-cache.ts');
const { renderForumMarkdown } = await import('../forum-markdown.ts');
const { resetLilypondServiceState } = await import('../lilypond/service.mjs');

const SPACE = '00000000-0000-4000-8000-000000000001';
const FORUM = '00000000-0000-4000-8000-000000000010';
const LILY = "{ c'4 d' e' }";
const DEFINITION = [
  'The weight matrix $\\mathbf{W}$ maps inputs. <script>alert(1)</script>',
  '',
  '<img src="x" onerror="alert(2)"> [bad](javascript:alert(3))',
  '',
  '```lily',
  LILY,
  '```',
].join('\n');

const q = async (text) => {
  if (text.includes('WHERE c."spaceId" = $1::uuid AND c.slug = $2')) {
    return { data: [{ id: 'c1', spaceId: SPACE, slug: 'w', label: 'W', labelNb: null, status: 'neologism', threadId: null,
      createdBy: null, createdByName: null, createdAt: 't0', updatedAt: 't1', forumId: FORUM, forumSlug: 'f', forumTitle: 'F',
      forumSettings: {} }], error: null };
  }
  if (text.includes('FROM "ConceptVersion" v')) {
    return { data: [{ id: 'v1', lang: 'en', definition: DEFINITION, sources: [], editedBy: null, creditedUserId: null,
      fromPostId: null, createdAt: '2026-01-01T00:00:00Z' }], error: null };
  }
  return { data: [], error: null };
};

let srv;
before(async () => {
  srv = await fakeService(() => ok());
  process.env.LILYPOND_SOCKET = srv.socketPath;
  resetLilypondServiceState();
});
after(async () => { await srv.close(); delete process.env.LILYPOND_SOCKET; });

test('definitionHtml: sanitized, KaTeX kept, lily fence → same-origin score image; raw markdown kept; cached per version', async () => {
  let renders = 0;
  const cache = createRenderCache(createMmPostRenderer({
    renderMarkdown: (md, options) => { renders += 1; return renderForumMarkdown(md, options); },
    loadForum: async () => null,
    resolve: async () => new Map(),
  }));
  const render = (md, ref) => cache.render(md, ref ? { ...ref, lang: 'en' } : ref);

  const c = await getConcept(q, { spaceId: SPACE, slug: 'w', render });
  const html = c.current.en.definitionHtml;
  assert.equal(c.current.en.definition, DEFINITION, 'raw markdown is kept for editing/export');
  assert.ok(!/<script|alert\(1\)|onerror|javascript:/i.test(html), html);
  assert.match(html, /class="katex"/);
  assert.match(html, /<math/);
  const hash = crypto.createHash('md5').update(LILY).digest('hex');
  assert.match(html, new RegExp(`<figure class="lilypond-block lily-score" data-lily-url="/lily/${hash}\\.svg" data-midi-url="/lily/${hash}\\.midi">`));
  assert.match(html, new RegExp(`<img src="/lily/${hash}\\.svg" alt="" loading="lazy"`));
  assert.ok(!/<svg/i.test(html), 'no inline SVG in sanitized output');
  assert.ok(fs.existsSync(path.join(store, `${hash}.svg`)), 'score written to LILYPOND_ASSET_DIR');
  assert.ok(fs.existsSync(path.join(store, `${hash}.midi`)));
  assert.equal(c.history[0].definitionHtml, html);

  const seen = srv.seen.length;
  const again = await getConcept(q, { spaceId: SPACE, slug: 'w', render });
  assert.equal(again.current.en.definitionHtml, html);
  assert.equal(renders, 1, 'second read is a cache hit');
  assert.equal(srv.seen.length, seen, 'no second service render');
});
