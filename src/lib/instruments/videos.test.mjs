import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVideos, MAX_VIDEOS, parseVideoUrl } from './videos.ts';

const ID = 'dQw4w9WgXcQ';
const yt = (id = ID) => ({ provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` });

test('youtube url shapes', () => {
  for (const u of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?feature=share&v=${ID}&t=10s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
    `https://www.youtube.com/shorts/${ID}`,
    `//www.youtube.com/embed/${ID}`,
  ]) {
    assert.deepEqual(parseVideoUrl(u), yt(), u);
  }
});

test('vimeo url shapes keep h hash', () => {
  assert.deepEqual(parseVideoUrl('https://vimeo.com/123456'), { provider: 'vimeo', id: '123456', url: 'https://vimeo.com/123456' });
  assert.deepEqual(parseVideoUrl('https://player.vimeo.com/video/123456'), { provider: 'vimeo', id: '123456', url: 'https://vimeo.com/123456' });
  assert.deepEqual(parseVideoUrl('https://player.vimeo.com/video/123456?h=ab12cd&autoplay=1'), { provider: 'vimeo', id: '123456', url: 'https://vimeo.com/123456?h=ab12cd' });
  assert.deepEqual(parseVideoUrl('https://vimeo.com/123456?h=ab12cd'), { provider: 'vimeo', id: '123456', url: 'https://vimeo.com/123456?h=ab12cd' });
});

test('lookalikes are rejected', () => {
  for (const u of [
    'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    'https://www.youtube.com/@someone',
    'https://www.youtube.com/playlist?list=PLabcdefghijk',
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}extra`,
    `https://evil.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `https://notyoutu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    'https://vimeo.com/channels/staffpicks',
    'https://vimeo.com/channels/staffpicks/123456',
    'https://vimeo.com/user123',
    'https://vimeo.com/groups/abc/videos/123456',
    'https://player.vimeo.com/video/abc',
    'not a url',
  ]) {
    assert.equal(parseVideoUrl(u), null, u);
  }
});

test('scans every yaml string value recursively and the body', () => {
  const data = {
    video: `https://youtu.be/${ID}`,
    nested: { deep: [{ link: 'https://vimeo.com/42' }] },
    img: 'https://example.org/a.png',
    n: 5,
    d: new Date(),
  };
  const body = `Text [clip](https://www.youtube.com/embed/AAAAAAAAAAA) and plain https://vimeo.com/99, ok.\n<iframe src="https://player.vimeo.com/video/7?h=zz&amp;autoplay=1"></iframe>`;
  assert.deepEqual(extractVideos(data, body).map((v) => `${v.provider}:${v.id}`), [
    `youtube:${ID}`, 'vimeo:42', 'youtube:AAAAAAAAAAA', 'vimeo:99', 'vimeo:7',
  ]);
  assert.equal(extractVideos(data, body)[4].url, 'https://vimeo.com/7?h=zz');
});

test('scheme-less whole-field yaml values are recognised', () => {
  assert.deepEqual(extractVideos({ video: `youtu.be/${ID}` }, ''), [yt()]);
});

test('dedupes by provider+id keeping first-seen order', () => {
  const body = `https://youtu.be/${ID} https://www.youtube.com/watch?v=${ID} https://vimeo.com/5 https://vimeo.com/5`;
  assert.equal(extractVideos({}, body).length, 2);
  assert.equal(extractVideos({ a: 'https://vimeo.com/5' }, body)[0].provider, 'vimeo');
});

test('caps at 12', () => {
  const body = Array.from({ length: 30 }, (_, i) => `https://vimeo.com/${i + 1}`).join('\n');
  assert.equal(extractVideos({}, body).length, MAX_VIDEOS);
});

test('only urls leave: no surrounding text, tolerant of nullish input', () => {
  const out = JSON.stringify(extractVideos({ note: 'secret yaml' }, `PRIVATE TEXT https://youtu.be/${ID} MORE PRIVATE`));
  assert.ok(!/PRIVATE|secret/.test(out));
  assert.deepEqual(extractVideos(null, undefined), []);
});

test('urls ending a sentence or inside markdown links parse cleanly', () => {
  assert.deepEqual(extractVideos({}, `See https://youtu.be/${ID}.`), [yt()]);
  assert.deepEqual(extractVideos({}, `[x](https://youtu.be/${ID})`), [yt()]);
});
