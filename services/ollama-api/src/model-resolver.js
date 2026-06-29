const normalizeName = (value) => String(value || '').trim();

const equivalentNames = (name) => {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  if (normalized.endsWith(':latest')) {
    return [normalized, normalized.slice(0, -':latest'.length)];
  }
  return [normalized, `${normalized}:latest`];
};

const findAvailable = (candidate, availableModels) => {
  const available = new Set(availableModels.map(normalizeName).filter(Boolean));
  return equivalentNames(candidate).find((name) => available.has(name)) || '';
};

export function resolveOllamaModel({ requestedModel, defaultModel, availableModels }) {
  const requested = normalizeName(requestedModel);
  const fallback = normalizeName(defaultModel);
  const available = Array.isArray(availableModels)
    ? availableModels.map(normalizeName).filter(Boolean)
    : [];

  // If model discovery is unavailable, preserve the old behavior and let
  // Ollama decide. This avoids turning a temporary /api/tags failure into an
  // outage for generation.
  if (available.length === 0) {
    return {
      model: requested || fallback,
      requestedModel: requested || null,
      fallbackFrom: null,
    };
  }

  const requestedMatch = findAvailable(requested, available);
  if (requestedMatch) {
    return {
      model: requestedMatch,
      requestedModel: requested || null,
      fallbackFrom: null,
    };
  }

  const fallbackMatch = findAvailable(fallback, available);
  if (fallbackMatch) {
    return {
      model: fallbackMatch,
      requestedModel: requested || null,
      fallbackFrom: requested || null,
    };
  }

  return {
    model: '',
    requestedModel: requested || null,
    fallbackFrom: requested || null,
  };
}
