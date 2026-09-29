import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderQueue, MermaidTimeoutError } from './mermaid-queue.mjs';

test('jobs run one at a time, in order', async () => {
  const enqueue = createRenderQueue({ timeoutMs: 1000 });
  const log = [];
  const job = (name, ms) => () => new Promise((r) => { log.push(`start ${name}`); setTimeout(() => { log.push(`end ${name}`); r(name); }, ms); });
  const out = await Promise.all([enqueue(job('a', 20)), enqueue(job('b', 1)), enqueue(job('c', 1))]);
  assert.deepEqual(out, ['a', 'b', 'c']);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('a job that never settles times out, cleans up and releases the queue', async () => {
  const cleaned = [];
  const enqueue = createRenderQueue({ timeoutMs: 30, onTimeout: (job) => { cleaned.push(job.name); job.cleanup(); } });
  let cleanedUp = false;
  const stuck = enqueue((job) => {
    job.name = 'stuck';
    job.cleanup = () => { cleanedUp = true; };
    return new Promise(() => {}); // e.g. JSDOM waiting for an <img> to load
  });
  const next = enqueue(() => Promise.resolve('next'));
  await assert.rejects(stuck, (e) => e instanceof MermaidTimeoutError);
  assert.equal(await next, 'next');
  assert.deepEqual(cleaned, ['stuck']);
  assert.equal(cleanedUp, true);
});

test('errors reject only their own job; timed-out flag is set for late settles', async () => {
  const enqueue = createRenderQueue({ timeoutMs: 20 });
  await assert.rejects(enqueue(() => Promise.reject(new Error('bad'))), /bad/);
  let job;
  let finish;
  const late = enqueue((j) => { job = j; return new Promise((r) => { finish = r; }); });
  await assert.rejects(late, MermaidTimeoutError);
  assert.equal(job.timedOut, true);
  finish('too late'); // must not throw or affect later jobs
  assert.equal(await enqueue(() => 'ok'), 'ok');
});
