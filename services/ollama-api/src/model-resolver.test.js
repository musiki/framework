import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOllamaModel } from './model-resolver.js';

test('keeps an available requested model', () => {
  assert.deepEqual(resolveOllamaModel({
    requestedModel: 'gemma4:31b-cloud',
    defaultModel: 'nemotron-3-super:cloud',
    availableModels: ['gemma4:31b-cloud', 'nemotron-3-super:cloud'],
  }), {
    model: 'gemma4:31b-cloud',
    requestedModel: 'gemma4:31b-cloud',
    fallbackFrom: null,
  });
});

test('falls back when a pinned model is no longer installed', () => {
  assert.deepEqual(resolveOllamaModel({
    requestedModel: 'llama3.2:latest',
    defaultModel: 'gemma4:31b-cloud',
    availableModels: ['gemma4:31b-cloud'],
  }), {
    model: 'gemma4:31b-cloud',
    requestedModel: 'llama3.2:latest',
    fallbackFrom: 'llama3.2:latest',
  });
});

test('treats an omitted latest tag as equivalent', () => {
  assert.equal(resolveOllamaModel({
    requestedModel: 'llama3.2',
    defaultModel: 'gemma4:31b-cloud',
    availableModels: ['llama3.2:latest'],
  }).model, 'llama3.2:latest');
});

test('does not select an arbitrary model when the default is unavailable', () => {
  assert.equal(resolveOllamaModel({
    requestedModel: 'missing',
    defaultModel: 'also-missing',
    availableModels: ['untrusted-model'],
  }).model, '');
});
