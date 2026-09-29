import test from 'node:test';
import assert from 'node:assert/strict';
import { clientKey } from './client-key.ts';

const h = (o) => new Headers(o);
test('clientKey precedence', () => {
  assert.equal(clientKey(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }), '3.3.3.3'), '1.1.1.1');
  assert.equal(clientKey(h({ 'x-forwarded-for': 'spoof, 1.1.1.1, 2.2.2.2' }), '3.3.3.3'), '2.2.2.2');
  assert.equal(clientKey(h({}), '3.3.3.3'), '3.3.3.3');
  assert.equal(clientKey(h({}), undefined), 'unknown');
  assert.equal(clientKey(h({ 'x-forwarded-for': ' , ' }), ''), 'unknown');
});
