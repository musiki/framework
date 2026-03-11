import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { config } from './config.js';
import { createCorrectionPrompt } from './prompt.js';
import { normalizeModelResponse } from './parser.js';

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
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(config.ollamaTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      return reply.code(502).send({ ok: false, error: `Ollama error: ${text}` });
    }

    const data = await response.json();
    const models = Array.isArray(data.models)
      ? data.models.map((item) => ({
          name: item.name,
          size: item.size,
          modified_at: item.modified_at,
        }))
      : [];

    return {
      ok: true,
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
      required: ['texto'],
      properties: {
        texto: { type: 'string', minLength: 1 },
        rubrica: { type: 'string' },
        model: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
}, async (request, reply) => {
  const { texto, rubrica, model } = request.body;

  if (texto.length > config.maxTextChars) {
    return reply.code(413).send({
      ok: false,
      error: `Texto demasiado largo. Máximo ${config.maxTextChars} caracteres.`,
    });
  }

  const selectedModel = model || config.ollamaModel;
  const prompt = createCorrectionPrompt({ studentText: texto, rubricText: rubrica });

  try {
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
