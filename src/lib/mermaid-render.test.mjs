// Real renderer (JSDOM + mermaid): an <img> in a node label used to hang
// renderMermaidSvg forever and stall every later render in the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMermaidSvg } from './mermaid-render.mjs';

const within = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no result within ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
};

test('a diagram with an <img> label renders, and later renders are not stalled', async () => {
  const img = renderMermaidSvg('graph TD; A["<img src=/mm/a.png>"]-->B');
  const next = renderMermaidSvg('graph TD; X-->Y');
  assert.match(await within(img, 5000), /<svg/);
  assert.match(await within(next, 5000), /<svg/);
});
