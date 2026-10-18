export const DEFAULT_OLLAMA_PRIORITY_MODELS = [
  'llama3.2:3b',
  'llama3.2:latest',
  'llama3.2',
  'llama3.1:8b',
  'llama3:8b',
  'qwen3:4b',
  'glm-4.7-flash:latest',
  'deepseek-r1:8b',
  'smollm2:135m',
];

export const LEGACY_IGNORED_YAML_MODELS = new Set([
  'gemma4:31b-cloud',
  'gemma4:31b',
  'gemma3:27b',
  'gemma2:9b',
  'gemma:7b',
]);

const ensureModelName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^ollama:/i, '');
};

const isEmbeddingOnlyModel = (name) => {
  const normalized = ensureModelName(name).toLowerCase();
  return !normalized || normalized.includes('embed');
};

export function sanitizeRequestedModel(model) {
  const cleaned = ensureModelName(model);
  if (!cleaned) return '';
  if (LEGACY_IGNORED_YAML_MODELS.has(cleaned.toLowerCase())) {
    return '';
  }
  return cleaned;
}

export function pickBestAvailableOllamaModel({
  requestedModel = '',
  defaultModel = '',
  availableModels = [],
  priorityModels = DEFAULT_OLLAMA_PRIORITY_MODELS,
} = {}) {
  const requested = sanitizeRequestedModel(requestedModel);
  const configuredDefault = sanitizeRequestedModel(defaultModel);
  const availableList = Array.isArray(availableModels)
    ? availableModels.map((item) => ensureModelName(typeof item === 'object' && item ? item.name : item)).filter(Boolean)
    : [];

  if (availableList.length === 0) {
    return requested || configuredDefault || priorityModels[0] || 'llama3.2:3b';
  }

  const availableByLower = new Map(
    availableList.map((name) => [name.toLowerCase(), name]),
  );

  // 1. Honor explicit non-legacy requested model if installed
  if (requested && availableByLower.has(requested.toLowerCase())) {
    return availableByLower.get(requested.toLowerCase());
  }

  // 2. Prioritize priority list (starting with Llama models)
  for (const candidate of priorityModels) {
    const cleanCandidate = ensureModelName(candidate).toLowerCase();
    if (availableByLower.has(cleanCandidate)) {
      return availableByLower.get(cleanCandidate);
    }
  }

  // 3. Any installed llama* family model
  const anyLlama = availableList.find(
    (name) => name.toLowerCase().startsWith('llama') && !isEmbeddingOnlyModel(name),
  );
  if (anyLlama) return anyLlama;

  // 4. Configured default model if installed
  if (configuredDefault && availableByLower.has(configuredDefault.toLowerCase())) {
    return availableByLower.get(configuredDefault.toLowerCase());
  }

  // 5. First non-embedding model available
  const firstGenerative = availableList.find((name) => !isEmbeddingOnlyModel(name));
  return firstGenerative || availableList[0] || 'llama3.2:3b';
}
