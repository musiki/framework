#!/usr/bin/env node

const DEFAULT_TEXT = 'La música generativa utiliza reglas y azar para producir variaciones, pero necesito mejorar la claridad de mi tesis.';

function parseArgs(argv) {
  const args = {
    apiUrl: process.env.API_URL || 'http://127.0.0.1:8787',
    token: process.env.API_TOKEN || '',
    model: process.env.MODEL || '',
    rubric: process.env.RUBRIC || '',
    text: process.env.TEXT || DEFAULT_TEXT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--api-url' && next) {
      args.apiUrl = next;
      i += 1;
      continue;
    }

    if (arg === '--token' && next) {
      args.token = next;
      i += 1;
      continue;
    }

    if (arg === '--model' && next) {
      args.model = next;
      i += 1;
      continue;
    }

    if (arg === '--rubric' && next) {
      args.rubric = next;
      i += 1;
      continue;
    }

    if (arg === '--text' && next) {
      args.text = next;
      i += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Uso:
  node scripts/demo/ollama-correct.mjs [opciones]

Opciones:
  --api-url <url>    URL base del backend (default: http://127.0.0.1:8787)
  --token <token>    Bearer token (si aplica)
  --model <name>     Modelo a usar (opcional)
  --rubric <texto>   Rubrica custom (opcional)
  --text <texto>     Texto del estudiante

Ejemplo:
  node scripts/demo/ollama-correct.mjs \\
    --api-url http://127.0.0.1:8787 \\
    --model qwen2.5:7b-instruct \\
    --text "Explico Umwelt, pero con tesis debil..."
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = `${args.apiUrl.replace(/\/$/, '')}/api/correct`;
  const headers = {
    'Content-Type': 'application/json',
  };

  if (args.token) {
    headers.Authorization = `Bearer ${args.token}`;
  }

  const payload = {
    texto: args.text,
  };

  if (args.model) payload.model = args.model;
  if (args.rubric) payload.rubrica = args.rubric;

  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const elapsedMs = Date.now() - started;
  let data;
  try {
    data = await response.json();
  } catch {
    const text = await response.text();
    data = { raw: text };
  }

  console.log(`Status: ${response.status}`);
  console.log(`Tiempo: ${elapsedMs}ms`);
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Demo error:', error);
  process.exit(1);
});
