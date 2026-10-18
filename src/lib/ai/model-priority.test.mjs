import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeRequestedModel,
  pickBestAvailableOllamaModel,
} from './model-priority.mjs';

test('sanitizeRequestedModel strips legacy hardcoded gemma4 models from YAML', () => {
  assert.equal(sanitizeRequestedModel('gemma4:31b-cloud'), '');
  assert.equal(sanitizeRequestedModel('GEMMA4:31B-CLOUD'), '');
  assert.equal(sanitizeRequestedModel('ollama:llama3.2:3b'), 'llama3.2:3b');
  assert.equal(sanitizeRequestedModel('qwen3:4b'), 'qwen3:4b');
});

test('pickBestAvailableOllamaModel prioritizes llama3.2:3b when legacy model is requested', () => {
  const availableModels = [
    'nomic-embed-text:latest',
    'qwen3:4b',
    'llama3.2:3b',
    'smollm2:135m',
  ];

  const chosen = pickBestAvailableOllamaModel({
    requestedModel: 'gemma4:31b-cloud',
    defaultModel: 'gemma4:31b-cloud',
    availableModels,
  });

  assert.equal(chosen, 'llama3.2:3b');
});

test('pickBestAvailableOllamaModel falls back to llama3.2:3b if requested model is not installed', () => {
  const availableModels = ['qwen3:4b', 'llama3.2:3b'];
  const chosen = pickBestAvailableOllamaModel({
    requestedModel: 'nonexistent-model:70b',
    defaultModel: 'qwen3:4b',
    availableModels,
  });

  assert.equal(chosen, 'llama3.2:3b');
});

test('pickBestAvailableOllamaModel honors installed explicit model', () => {
  const availableModels = ['qwen3:4b', 'llama3.2:3b'];
  const chosen = pickBestAvailableOllamaModel({
    requestedModel: 'qwen3:4b',
    defaultModel: 'llama3.2:3b',
    availableModels,
  });

  assert.equal(chosen, 'qwen3:4b');
});
