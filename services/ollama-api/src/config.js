const parseNumber = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseCsv = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const ALLOWED_ORIGINS = parseCsv(process.env.ALLOWED_ORIGINS);

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: parseNumber(process.env.PORT, 8787),
  logLevel: process.env.LOG_LEVEL || 'info',
  apiToken: process.env.API_TOKEN || '',
  allowedOrigins: ALLOWED_ORIGINS,
  allowAnyOrigin: ALLOWED_ORIGINS.includes('*'),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  ollamaTimeoutMs: parseNumber(process.env.OLLAMA_TIMEOUT_MS, 60000),
  temperature: parseNumber(process.env.TEMPERATURE, 0.1),
  numPredict: parseNumber(process.env.NUM_PREDICT, 512),
  maxTextChars: parseNumber(process.env.MAX_TEXT_CHARS, 12000),
  rateLimitMax: parseNumber(process.env.RATE_LIMIT_MAX, 60),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
};

if (config.port <= 0 || config.port > 65535) {
  throw new Error(`Invalid PORT value: ${config.port}`);
}

if (config.maxTextChars < 200) {
  throw new Error('MAX_TEXT_CHARS must be at least 200');
}
