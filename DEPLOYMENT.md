# Deployment Guide - Vercel & Supabase

This project uses **Supabase** for the database and **Vercel** for hosting.

## 1. Supabase Setup

1.  Create a new project at database.new.
2.  Go to the **SQL Editor** in Supabase and run the schema creation script (see `db/schema.sql` or project docs).
3.  Go to **Project Settings > API**.
4.  Copy the **Project URL** and the **service_role** key (Secret).

> ⚠️ **Important:** We use the `service_role` key because the Astro dashboard performs admin actions server-side. Do not expose this key in client-side code.

## 2. Vercel Configuration

1.  Go to your project in Vercel.
2.  Navigate to **Settings → Environment Variables**.
3.  Add the following variables:

    ```env
    # Authentication (Google OAuth)
    GOOGLE_CLIENT_ID=your-google-client-id
    GOOGLE_CLIENT_SECRET=your-google-client-secret
    AUTH_SECRET=your-32-char-random-secret

    # Database (Supabase)
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_KEY=your-service-role-key
    ```

## 3. Deployment

Simply push to your main branch on GitHub/GitLab, and Vercel will automatically redeploy.

```bash
git add .
git commit -m "Update database logic to Supabase"
git push origin main
```

## 4. Post-Deployment Setup

1.  Log in to your deployed site.
2.  Navigate to `/admin/setup`.
3.  Click **"Promote to Teacher"** to grant yourself admin privileges.
4.  Go to `/dashboard` to view the admin panel.

## Troubleshooting

## Variables de Entorno Necesarias

Tu archivo `.env` debe tener:

```env
# Google OAuth (ya lo tienes)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
AUTH_SECRET="..."

# Supabase
SUPABASE_URL="..."
SUPABASE_KEY="..."
```

## Comandos Útiles

```bash
# Build local (development)
npm run build:local

# Build para Vercel (con remote DB)
npm run build

# Push schema changes a producción
astro db push --remote

# Ver contenido de DB remota
turso db shell cymp-production
```

## Checklist Pre-Deployment

- [ ] Base de datos creada en Turso
- [ ] Token generado
- [ ] Variables de entorno configuradas en Vercel
- [ ] Script de build actualizado en package.json
- [ ] Schema pushed a Turso
- [ ] Seed ejecutado en DB remota (si es necesario)

## Costos

- ✅ **Turso FREE tier**: 
  - 9GB almacenamiento
  - 1 billón de row reads
  - Perfecto para empezar

## Más Info

- [Astro DB Docs](https://docs.astro.build/en/guides/astro-db/)
- [Turso Docs](https://docs.turso.tech/)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)



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
