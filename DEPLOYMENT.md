# Deployment Guide - Musiki Framework (VPS)

This project is deployed on a **VPS** (`musiki.org.ar`) using **PM2** for process management and **Caddy** as a reverse proxy.

## 1. Infrastructure Overview

- **Host**: `musiki.org.ar`
- **Application Server**: Node.js (Astro SSR) managed by PM2.
- **Database**: Supabase (Remote).
- **Reverse Proxy**: Caddy.
- **Deployment User**: `deploy`

## 2. Process Management (PM2)

The application is managed via `ecosystem.config.cjs`. There are three main processes:

1.  **musiki-framework**: The production Astro server (Port 4321).
2.  **musiki-framework-dev**: A development instance (Port 4325).
3.  **musiki-content-bus**: Manages content synchronization (Port 4322).

### Common PM2 Commands (on Server)
```bash
pm2 list
pm2 reload ecosystem.config.cjs --only musiki-framework
pm2 logs musiki-framework
```

## 3. Deployment Workflow

Deployment is automated via a local script that pushes changes and triggers a pull/build on the server.

### Automated Deploy (Recommended)
Run this from your local machine:
```bash
bash scripts/vps/deploy-framework.sh
```
This script performs the following steps:
1. SSH into the VPS.
2. `git pull` the latest `main` branch.
3. `npm ci` (install dependencies).
4. `npm run build` (build production assets).
5. `pm2 reload` the framework process.

### Manual Deploy (Emergency)
If the script fails, you can manually deploy:
1. `git push origin main`
2. `ssh deploy@musiki.org.ar`
3. `cd /opt/musiki/framework`
4. `git pull`
5. `npm run build`
6. `pm2 reload musiki-framework`

## 4. Environment Variables

Variables are managed in a `.env` file on the VPS. Key variables include:

- `SUPABASE_URL` & `SUPABASE_KEY`
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`
- `AUTH_SECRET`
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `CORRECTION_API_URL` (Ollama VPS)

## 5. Maintenance Commands

```bash
# Force a clean build of content and site
npm run build:content
npm run build

# Push local database schema changes to Supabase
astro db push --remote
```

## 6. Pre-deployment Checklist

- [ ] Ensure all local changes are committed.
- [ ] Run `bash scripts/preflight.sh` to verify build integrity.
- [ ] Verify that `main` branch is pushed to origin.
