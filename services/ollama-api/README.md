# Ollama Correction API (Fastify)

API Node.js/Fastify para corrección de textos con Ollama local.

## Endpoints

- `GET /health`
- `GET /api/models`
- `POST /api/correct`

## Request `POST /api/correct`

```json
{
  "texto": "Texto del estudiante",
  "rubrica": "Opcional. Rúbrica custom",
  "model": "Opcional. Ejemplo: llama3.2"
}
```

## Response (shape)

```json
{
  "ok": true,
  "model": "llama3.2",
  "evaluation": {
    "resumen": "...",
    "tesis": { "clara": true, "explicacion": "..." },
    "fortalezas": ["...", "..."],
    "debilidades": ["...", "..."],
    "sugerencia": "...",
    "raw": "..."
  }
}
```

## Desarrollo local

```bash
cd services/ollama-api
cp .env.example .env
npm install
npm run dev
```

Prueba rápida:

```bash
curl -s http://localhost:8787/health
```

Con token:

```bash
curl -s http://localhost:8787/api/correct \
  -H "Authorization: Bearer change-this-in-production" \
  -H "Content-Type: application/json" \
  -d '{"texto":"La música como sistema complejo..."}'
```

## Deploy al VPS

```bash
VPS_HOST=203.0.113.10 VPS_USER=ubuntu scripts/vps/deploy-ollama-api.sh
```

El script sincroniza código, instala dependencias y reinicia el servicio `systemd`.
