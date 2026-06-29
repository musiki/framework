---
status: resolved
trigger: "short_ai evals return 502 from /api/ai/correct; example affordance-short-ai-01 requests Ollama model llama3.2:latest"
created: 2026-06-30
updated: 2026-06-30
---

## Symptoms

- Expected: a short_ai submission is evaluated by an available Ollama model and returns structured JSON.
- Actual: `/api/ai/correct` returns HTTP 502.
- Console: extension message-port noise plus two failed `/api/ai/correct` requests.
- Reproduction: submit the `affordance-short-ai-01` eval with at least 200 characters.

## Current Focus

- hypothesis: content pins a missing `llama3.2:latest` model; the bridge also permits a duplicated `/api/correct` path when configured with an endpoint URL instead of an origin.
- test: query VPS models and logs, call available models directly, then add model resolution/fallback and URL normalization.
- expecting: Gemma succeeds; missing llama is reported in service logs; fixed eval succeeds without 502.
- next_action: resolved; publish the s123 content changes through the normal content workflow.

## Evidence

- timestamp: 2026-06-30
  finding: VPS logs report `model 'llama3.2:latest' not found` for the failing requests.
- timestamp: 2026-06-30
  finding: `gemma4:31b-cloud` returns a valid correction in about five seconds; `deepseek-r1:8b` works but took about 88 seconds.
- timestamp: 2026-06-30
  finding: local CORRECTION_API_URL ends in `/api/correct`, while the bridge appends that path again.
- timestamp: 2026-06-30
  finding: Ollama 0.16.3 is installed; official current release is 0.30.8.

## Eliminated

- hypothesis: the short_ai eval block is not parsed or submitted.
  reason: parser and frontend both preserve provider/model and submit the correct short_ai payload.
- hypothesis: Ollama or the Fastify correction service is down.
  reason: both services are active and Gemma/DeepSeek direct corrections succeed.

## Resolution

- root_cause: short_ai content pinned `llama3.2:latest`, which was not installed on the VPS; the correction service passed that model name through and converted Ollama's model-not-found response into a generic 502. Local bridge configuration also used an endpoint URL that could duplicate `/api/correct`.
- fix: changed s123 text evals to `gemma4:31b-cloud`; added installed-model validation with configured-default fallback; normalized correction API URLs; improved upstream error propagation; set and deployed Gemma as the VPS default.
- verification: service tests and lint pass; framework's 76 tests and production build pass; all 93 eval blocks in s123/public parse; deployed service source matches local; direct Gemma affordance evaluation returns score 9; legacy llama request falls back to Gemma and returns HTTP 200.
- files_changed: services/ollama-api/src/server.js, services/ollama-api/src/config.js, services/ollama-api/src/model-resolver.js, services/ollama-api/src/model-resolver.test.js, services/ollama-api/package.json, services/ollama-api/.env.example, src/lib/ai/correction-api-url.ts, src/pages/api/ai/correct.ts, src/pages/api/ai/models.ts, service/docs, and s123 text-eval markdown files.
