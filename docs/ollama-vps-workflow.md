# Workflow Local -> VPS (Ubuntu 23) para API de corrección

Este flujo mantiene tu frontend Astro en Vercel y tu capa de IA en VPS con Ollama.

## 1. Arquitectura recomendada

- Vercel (Astro): UI + rutas públicas.
- VPS Ubuntu 23: `ollama serve` + API Fastify (`services/ollama-api`).
- Ollama solo accesible por `localhost:11434` en el VPS.
- Fastify expuesto por `nginx` en `api.tu-dominio.com`.

## 2. Setup inicial del VPS

```bash
# Ubuntu 23
sudo apt update
sudo apt install -y curl ca-certificates gnupg nginx

# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama

# Modelo base
ollama pull llama3.2
```

Verifica:

```bash
curl -s http://127.0.0.1:11434/api/tags
```

## 3. Deploy desde local

Desde tu máquina de desarrollo:

```bash
cd /Users/zztt/projects/26-musiki/framework
VPS_HOST=<IP_O_HOSTNAME> VPS_USER=ubuntu scripts/vps/deploy-ollama-api.sh
```

Si el servicio debe correr con otro usuario/grupo:

```bash
VPS_HOST=<host> VPS_USER=deploy APP_USER=app APP_GROUP=app scripts/vps/deploy-ollama-api.sh
```

El primer deploy crea `.env` en el VPS (`/opt/ollama-api/.env`).

Edita variables de producción:

```env
API_TOKEN=<token_largo_random>
ALLOWED_ORIGINS=https://tu-campus.vercel.app
OLLAMA_MODEL=llama3.2
```

Reinicia servicio:

```bash
ssh ubuntu@<IP_O_HOSTNAME> 'sudo systemctl restart ollama-correction-api'
```

## 4. Exponer API con Nginx

En VPS:

```bash
sudo cp /opt/ollama-api/ops/nginx/correction-api.conf /etc/nginx/sites-available/correction-api.conf
sudo ln -s /etc/nginx/sites-available/correction-api.conf /etc/nginx/sites-enabled/correction-api.conf
sudo nginx -t
sudo systemctl reload nginx
```

Luego emite TLS con Let's Encrypt (recomendado):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.tu-dominio.com
```

## 5. Consumir desde Astro/Vercel

Variables en Vercel:

```env
CORRECTION_API_URL=https://api.tu-dominio.com
CORRECTION_API_TOKEN=<mismo token del VPS>
```

El repo ya incluye endpoint puente server-side:

- `POST /api/ai/correct` en `/src/pages/api/ai/correct.ts`

Ejemplo de consumo desde frontend (sin exponer token):

```ts
const res = await fetch('/api/ai/correct', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ texto, rubrica }),
});
```

## 6. Operación diaria

Logs:

```bash
ssh ubuntu@<host> 'journalctl -u ollama-correction-api -f'
```

Estado:

```bash
ssh ubuntu@<host> 'systemctl status ollama-correction-api --no-pager'
```

Nuevo deploy:

```bash
VPS_HOST=<host> scripts/vps/deploy-ollama-api.sh
```

## 6.1 Demo rápido

Demo web (desde Astro):

- Ruta: `/demo/ollama`
- Prueba vía endpoint puente `/api/ai/correct`.
- Requiere sesión activa y variables `CORRECTION_API_URL` + `CORRECTION_API_TOKEN`.

Demo CLI:

```bash
node scripts/demo/ollama-correct.mjs \
  --api-url http://127.0.0.1:8787 \
  --model qwen2.5:7b-instruct \
  --text "La música generativa usa reglas y azar..."
```

## 7. Seguridad mínima

- No publicar `11434` al exterior.
- Mantener `API_TOKEN` activo siempre.
- Restringir `ALLOWED_ORIGINS` (no usar `*` en producción).
- Activar firewall (`ufw`) solo con `22`, `80`, `443`.
