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
test('noteIcon prefixes and noteSuffix appends onto the note label text, folders are unaffected', async () => {
  const container = setup();
  const tree = renderTree({ container, labels, locale:'en', canManage:false, showVisibility:false,
    load: async () => ({folders:[{id:'f',parentId:null,name:'Folder'}],notes:[{id:'n',title:'Alpha',folderId:null}]}),
    onOpenNote() {}, noteIcon: () => '🔷', noteSuffix: () => '(bob)', actions: {} });
  await tree.refresh();
  const labelsText = [...container.querySelectorAll('.wt-label')].map(b => b.textContent);
  assert.ok(labelsText.includes('🔷 Alpha (bob)'));
  assert.ok(labelsText.includes('Folder'));
  tree.destroy();
});
test('noteIcon/noteSuffix returning nothing leaves the label exactly as the plain title', async () => {
  const container = setup();
  const tree = renderTree({ container, labels, locale:'en', canManage:false, showVisibility:false,
    load: async () => ({folders:[],notes:[{id:'n',title:'Alpha',folderId:null}]}),
    onOpenNote() {}, noteIcon: () => null, noteSuffix: () => undefined, actions: {} });
  await tree.refresh();
  assert.equal(container.querySelector('.wt-label').textContent, 'Alpha');
  tree.destroy();
});
test('noteActions renders extra buttons in the note action menu and runs them, folders get none', async () => {
  const container = setup(); let shared;
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => ({folders:[{id:'f',parentId:null,name:'Folder'}],notes:[{id:'n',title:'Alpha',folderId:null}]}),
    onOpenNote() {}, noteActions: (note) => [{ label: 'Compartir', run: () => { shared = note.id; } }], actions: {} });
  await tree.refresh();
  const buttons = [...container.querySelectorAll('button')];
  const shareButtons = buttons.filter(b => b.textContent === 'Compartir');
  assert.equal(shareButtons.length, 1); // only the note gets it, not the folder
  shareButtons[0].click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(shared, 'n');
  tree.destroy();
});
test('dropping a folder onto a different folder reparents it (last child), not just reorders', async () => {
  const container = setup(); let call;
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => ({folders:[{id:'a',parentId:null,name:'A'},{id:'b',parentId:null,name:'B'}],notes:[]}),
    onOpenNote() {}, actions: { reorder: async (...args) => { call = args; } } });
  await tree.refresh();
  const labelA = [...container.querySelectorAll('.wt-label')].find(b => b.textContent === 'A');
  const rowB = [...container.querySelectorAll('.wt-row')].find(r => r.querySelector('.wt-label').textContent === 'B');
  const dataTransfer = { setData() {}, getData() { return ''; } };
  const dragStart = new window.Event('dragstart', { bubbles: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
  labelA.dispatchEvent(dragStart);
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  rowB.dispatchEvent(drop);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(call, ['folder', 'a', 'b', 0]); // reparented under 'b', not reordered as a root sibling
  tree.destroy();
});
test('a failing action shows the error label and still reloads the tree', async () => {
  const container = setup(); let loads = 0;
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => { loads++; return { folders: [], notes: [{ id:'n', title:'Alpha', folderId:null }] }; },
    onOpenNote() {}, actions: { renameNote: async () => { throw new Error('boom'); } } });
  await tree.refresh();
  const loadsBeforeRename = loads;
  window.prompt = () => 'New name';
  window.confirm = () => true;
  [...container.querySelectorAll('button')].find(b => b.textContent === 'rename').click();
  await new Promise(r => setTimeout(r, 0));
  // The reload happens BEFORE the error label is set (refresh() would otherwise
  // silently overwrite a status.textContent set beforehand) — asserted below by
  // checking the final status text is the error label, not blank/loading.
  assert.ok(loads > loadsBeforeRename);
  const status = container.querySelector('[role="status"]');
  assert.equal(status.textContent, labels.error);
  tree.destroy();
});
test('a failing action prefers actionError over error when the labels provide it, and it survives the post-failure reload', async () => {
  const container = setup();
  const labelsWithActionError = { ...labels, actionError: 'custom-action-error' };
  const tree = renderTree({ container, labels: labelsWithActionError, locale:'en', canManage:true, showVisibility:false,
    load: async () => ({ folders: [], notes: [{ id:'n', title:'Alpha', folderId:null }] }),
    onOpenNote() {}, actions: { renameNote: async () => { throw new Error('boom'); } } });
  await tree.refresh();
  window.prompt = () => 'New name';
  window.confirm = () => true;
  [...container.querySelectorAll('button')].find(b => b.textContent === 'rename').click();
  await new Promise(r => setTimeout(r, 0));
  const status = container.querySelector('[role="status"]');
  assert.equal(status.textContent, 'custom-action-error');
  tree.destroy();
});
test('dragstart sets a private MIME (not text/plain) plus any dragData hook payload', async () => {
  const container = setup();
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => ({folders:[],notes:[{id:'n',title:'Alpha',folderId:null}]}),
    onOpenNote() {}, dragData: (node) => node.kind === 'note' ? { 'text/x-musiki-note': node.note.id, 'text/x-musiki-note-title': node.note.title } : {},
    actions: {} });
  await tree.refresh();
  const label = container.querySelector('.wt-label');
  const set = [];
  const dataTransfer = { setData(k, v) { set.push([k, v]); }, getData() { return ''; } };
  const dragStart = new window.Event('dragstart', { bubbles: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
  label.dispatchEvent(dragStart);
  assert.ok(set.some(([k, v]) => k === 'application/x-writing-tree' && v === 'n'));
  assert.ok(!set.some(([k]) => k === 'text/plain'));
  assert.ok(set.some(([k, v]) => k === 'text/x-musiki-note' && v === 'n'));
  assert.ok(set.some(([k, v]) => k === 'text/x-musiki-note-title' && v === 'Alpha'));
  tree.destroy();
});
test('noteActions run directly, not through run() — no forced busy/reload for a side action like Compartir', async () => {
  const container = setup(); let loads = 0; let ran = false;
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => { loads++; return { folders: [], notes: [{ id:'n', title:'Alpha', folderId:null }] }; },
    onOpenNote() {}, noteActions: () => [{ label: 'Compartir', run: () => { ran = true; } }], actions: {} });
  await tree.refresh();
  const loadsBeforeShare = loads;
  [...container.querySelectorAll('button')].find(b => b.textContent === 'Compartir').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(ran);
  assert.equal(loads, loadsBeforeShare); // no reload triggered
  tree.destroy();
});
test('create controls are compact glyph icons whose accessible name is the label', async () => {
  const container = setup(); let created;
  const tree = renderTree({ container, labels, locale:'en', canManage:true, showVisibility:false,
    load: async () => ({folders:[],notes:[]}), onOpenNote() {},
    actions: { createNote: async (parentId) => { created = parentId; } } });
  await tree.refresh();
  const icons = [...container.querySelectorAll('.wt-create .wt-icon')];
  assert.deepEqual(icons.map(b => [b.textContent, b.getAttribute('aria-label'), b.title]),
    [['+', 'newNote', 'newNote'], ['⊟+', 'newFolder', 'newFolder']]);
  icons[0].click(); await new Promise(r => setTimeout(r, 0)); assert.equal(created, null);
  tree.destroy();
});
