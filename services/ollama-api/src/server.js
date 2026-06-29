import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { config } from './config.js';
import { createCorrectionPrompt } from './prompt.js';
import { normalizeModelResponse } from './parser.js';
import { resolveOllamaModel } from './model-resolver.js';

const app = Fastify({
  logger: {
    level: config.logLevel,
  },
  requestIdHeader: 'x-request-id',
});

await app.register(helmet, {
  contentSecurityPolicy: false,
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (config.allowAnyOrigin) return cb(null, true);
    if (config.allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'), false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow,
});

app.addHook('preHandler', async (request, reply) => {
  if (request.routeOptions.url === '/health') return;
  if (!config.apiToken) return;

  const authHeader = request.headers.authorization || '';
  const expected = `Bearer ${config.apiToken}`;
  if (authHeader !== expected) {
    return reply.code(401).send({
      ok: false,
      error: 'Unauthorized',
    });
  }
});

app.get('/health', async () => {
  return {
    ok: true,
    service: 'ollama-correction-api',
    ts: new Date().toISOString(),
  };
});

app.get('/api/models', async (_request, reply) => {
  try {
    const models = await fetchOllamaModels();

    return {
      ok: true,
      default_model: config.ollamaModel,
      models,
    };
  } catch (error) {
    requestLogError(app, error, 'Failed to fetch local models');
    return reply.code(502).send({ ok: false, error: 'Cannot reach Ollama service' });
  }
});

app.post('/api/correct', {
  schema: {
    body: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        rubrica: { type: 'string' },
        model: { type: 'string' },
        promptOverride: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
}, async (request, reply) => {
  const texto = typeof request.body?.texto === 'string' ? request.body.texto.trim() : '';
  const rubrica = typeof request.body?.rubrica === 'string' ? request.body.rubrica : '';
  const model = typeof request.body?.model === 'string' ? request.body.model.trim() : '';
  const promptOverride = typeof request.body?.promptOverride === 'string' ? request.body.promptOverride.trim() : '';

  if (!promptOverride && !texto) {
    return reply.code(400).send({
      ok: false,
      error: 'texto or promptOverride is required',
    });
  }

  if (texto.length > config.maxTextChars) {
    return reply.code(413).send({
      ok: false,
      error: `Texto demasiado largo. Máximo ${config.maxTextChars} caracteres.`,
    });
  }

  if (promptOverride.length > config.maxPromptChars) {
    return reply.code(413).send({
      ok: false,
      error: `Prompt demasiado largo. Máximo ${config.maxPromptChars} caracteres.`,
    });
  }

  const requestedModel = model || config.ollamaModel;
  const prompt = promptOverride || createCorrectionPrompt({ studentText: texto, rubricText: rubrica });

  try {
    const modelResolution = await resolveAvailableModel(requestedModel);
    if (!modelResolution.model) {
      return reply.code(422).send({
        ok: false,
        code: 'MODEL_NOT_AVAILABLE',
        error: `Requested model '${requestedModel}' is unavailable and default model '${config.ollamaModel}' is not installed.`,
      });
    }
    const selectedModel = modelResolution.model;
    const ollamaResponse = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(config.ollamaTimeoutMs),
      body: JSON.stringify({
        model: selectedModel,
        prompt,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.numPredict,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const responseText = await ollamaResponse.text();
      requestLogError(app, responseText, 'Ollama /api/generate returned non-200');
      return reply.code(502).send({
        ok: false,
        error: 'Error from Ollama generate endpoint',
      });
    }

    const raw = await ollamaResponse.json();
    const normalized = normalizeModelResponse(raw.response || '');

    return {
      ok: true,
      model: raw.model || selectedModel,
      requested_model: modelResolution.requestedModel,
      model_fallback: modelResolution.fallbackFrom,
      created_at: raw.created_at || null,
      evaluation: normalized,
      timing_ms: {
        total: nanosecondsToMs(raw.total_duration),
        load: nanosecondsToMs(raw.load_duration),
        prompt_eval: nanosecondsToMs(raw.prompt_eval_duration),
        eval: nanosecondsToMs(raw.eval_duration),
      },
      token_usage: {
        prompt_eval_count: raw.prompt_eval_count ?? null,
        eval_count: raw.eval_count ?? null,
      },
    };
  } catch (error) {
    requestLogError(app, error, 'Correction flow failed');
    return reply.code(502).send({
      ok: false,
      error: 'No se pudo procesar la corrección con Ollama',
    });
  }
});

app.post('/api/run', {
  schema: {
    body: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        prompt: { type: 'string' },
        model: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            temperature: { type: 'number' },
            num_predict: { type: 'number' },
          },
          additionalProperties: true,
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
}, async (request, reply) => {
  const task = typeof request.body?.task === 'string' ? request.body.task.trim() : 'chat';
  const prompt = typeof request.body?.prompt === 'string' ? request.body.prompt.trim() : '';
  const model = typeof request.body?.model === 'string' ? request.body.model.trim() : '';
  const bodyOptions = request.body?.options && typeof request.body.options === 'object'
    ? request.body.options
    : {};

  if (!prompt) {
    return reply.code(400).send({
      ok: false,
      error: 'prompt is required',
    });
  }

  if (prompt.length > config.maxPromptChars) {
    return reply.code(413).send({
      ok: false,
      error: `Prompt demasiado largo. Máximo ${config.maxPromptChars} caracteres.`,
    });
  }

  const requestedModel = model || config.ollamaModel;

  try {
    const modelResolution = await resolveAvailableModel(requestedModel);
    if (!modelResolution.model) {
      return reply.code(422).send({
        ok: false,
        code: 'MODEL_NOT_AVAILABLE',
        error: `Requested model '${requestedModel}' is unavailable and default model '${config.ollamaModel}' is not installed.`,
      });
    }
    const selectedModel = modelResolution.model;
    const ollamaResponse = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(config.ollamaTimeoutMs),
      body: JSON.stringify({
        model: selectedModel,
        prompt,
        stream: false,
        options: {
          temperature: typeof bodyOptions.temperature === 'number' ? bodyOptions.temperature : config.temperature,
          num_predict: typeof bodyOptions.num_predict === 'number' ? bodyOptions.num_predict : config.numPredict,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const responseText = await ollamaResponse.text();
      requestLogError(app, responseText, 'Ollama /api/generate returned non-200');
      return reply.code(502).send({
        ok: false,
        error: 'Error from Ollama generate endpoint',
      });
    }

    const raw = await ollamaResponse.json();

    return {
      ok: true,
      task,
      model: raw.model || selectedModel,
      requested_model: modelResolution.requestedModel,
      model_fallback: modelResolution.fallbackFrom,
      created_at: raw.created_at || null,
      output: raw.response || '',
      timing_ms: {
        total: nanosecondsToMs(raw.total_duration),
        load: nanosecondsToMs(raw.load_duration),
        prompt_eval: nanosecondsToMs(raw.prompt_eval_duration),
        eval: nanosecondsToMs(raw.eval_duration),
      },
      token_usage: {
        prompt_eval_count: raw.prompt_eval_count ?? null,
        eval_count: raw.eval_count ?? null,
      },
    };
  } catch (error) {
    requestLogError(app, error, 'AI run flow failed');
    return reply.code(502).send({
      ok: false,
      error: 'No se pudo procesar la solicitud con Ollama',
    });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (error.validation) {
    return reply.code(400).send({
      ok: false,
      error: 'Invalid request payload',
      details: error.validation,
    });
  }

  return reply.code(500).send({
    ok: false,
    error: 'Internal server error',
  });
});

async function fetchOllamaModels() {
  const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(config.ollamaTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama /api/tags failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data.models)
    ? data.models.map((item) => ({
        name: item.name,
        size: item.size,
        modified_at: item.modified_at,
      }))
    : [];
}

async function resolveAvailableModel(requestedModel) {
  try {
    const models = await fetchOllamaModels();
    return resolveOllamaModel({
      requestedModel,
      defaultModel: config.ollamaModel,
      availableModels: models.map((item) => item.name),
    });
  } catch (error) {
    app.log.warn({ err: error }, 'Could not discover Ollama models; generation will use requested model directly');
    return resolveOllamaModel({
      requestedModel,
      defaultModel: config.ollamaModel,
      availableModels: [],
    });
  }
}

function nanosecondsToMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value / 1_000_000);
}

function requestLogError(server, error, message) {
  server.log.error({ err: error }, message);
}

const start = async () => {
  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
