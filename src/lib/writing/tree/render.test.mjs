import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTree } from './render.ts';
const labels = Object.fromEntries(['newNote','newFolder','rename','delete','visibility','inherit','private','supervision','committee','public','confirmDelete','empty','loading','error','up','down','actions'].map(k => [k,k]));
function setup() {
  const dom = new JSDOM('<div id="tree"></div>'); globalThis.document = dom.window.document; globalThis.window = dom.window;
  return document.querySelector('#tree');
}
test('read-only tree escapes stored titles and exposes no management controls', async () => {
  const container = setup(); let opened;
  const tree = renderTree({ container, labels, locale: 'en', canManage: false, showVisibility: true,
    load: async () => ({ folders: [], notes: [{ id:'n', folderId:null, title:'<img src=x onerror=alert(1)>' }] }),
    onOpenNote: id => { opened = id; }, actions: {} });
  await tree.refresh(); assert.equal(container.querySelector('img'), null);
  assert.equal(container.querySelector('select'), null); assert.equal(container.querySelector('.wt-actions'), null);
  container.querySelector('button').click(); assert.equal(opened,'n'); tree.destroy();
});
test('destroy invalidates an outstanding load', async () => {
  const container = setup(); let resolve;
  const tree = renderTree({ container, labels, locale:'en', canManage:false, showVisibility:false,
    load: () => new Promise(r => { resolve = r; }), onOpenNote() {}, actions:{} });
  const pending = tree.refresh(); tree.destroy(); resolve({ folders:[], notes:[{id:'n',title:'late',folderId:null}] });
  await pending; assert.equal(container.textContent,'');
});
test('management move buttons send a sibling index, including initially unpositioned items', async () => {
  const container = setup(); let move;
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => ({folders:[],notes:[{id:'a',title:'Alpha',folderId:null},{id:'b',title:'Beta',folderId:null}]}),
    onOpenNote() {}, actions:{ reorder: async (...args) => { move = args; } } });
  await tree.refresh(); [...container.querySelectorAll('button')].find(b=>b.textContent==='down').click();
  await new Promise(r=>setTimeout(r,0)); assert.deepEqual(move,['note','a',null,1]); tree.destroy();
});
