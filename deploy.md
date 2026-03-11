# Deploy Checklist (mínimo)

Este checklist está pensado para tu setup actual: Astro en Vercel + Supabase + API de corrección en VPS.

## 1) Ejecutar preflight local

```bash
bash scripts/preflight.sh
```

Nota: este preflight está orientado a deploy y falla si `BETTER_AUTH_URL` apunta a `localhost`.

Opciones útiles:

```bash
# Saltar build (rápido)
bash scripts/preflight.sh --skip-build

# Saltar test de API remota
bash scripts/preflight.sh --skip-api

# Usar un env de producción
bash scripts/preflight.sh --env-file .env.production
```

## 2) Variables en Vercel (Production)

Asegúrate de tener:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SECRET`
- `BETTER_AUTH_URL=https://musikiuntref.vercel.app`
- `SUPABASE_URL`
- `SUPABASE_KEY` (server-side, no cliente)
- `CORRECTION_API_URL=https://ollama-api.zztt.org`
- `CORRECTION_API_TOKEN`
- `CORRECTION_API_TIMEOUT_MS=120000`

## 3) OAuth Google

En Google Cloud Console, verifica que el OAuth Client tenga:

- `https://musikiuntref.vercel.app/api/auth/callback/google`
- `http://localhost:4322/api/auth/callback/google` (dev local)

## 4) VPS (API Ollama) listo

Checks recomendados en VPS:

```bash
systemctl status ollama-correction-api --no-pager
systemctl status ollama --no-pager
curl -sS https://ollama-api.zztt.org/health
```

## 5) Deploy

Push a `main`:

```bash
git add .
git commit -m "deploy: preflight passed"
git push origin main
```

## 6) Post-deploy smoke test

- Login OK
- `/dashboard` carga
- `/admin/setup` carga
- `/demo/ollama` devuelve corrección
- `POST /api/ai/correct` responde 200 en app productiva

## 7) Seguridad

- Rotar secretos si se expusieron en terminal/chat.
- No commitear `.env` ni `.vercel/output`.
