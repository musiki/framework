# Musiki Docs

App Starlight para `doc.musiki.org.ar`.

## Desarrollo

```bash
cd docs
npm install
npm run dev
```

La app corre por defecto en `http://localhost:4322`.

## Build

```bash
cd docs
npm run build
```

## Deploy

Publicar `docs/dist` en el host estático apuntado por `doc.musiki.org.ar`.

Para cambiar el dominio canónico:

```bash
DOCS_SITE_URL=https://doc.musiki.org.ar npm run build
```
