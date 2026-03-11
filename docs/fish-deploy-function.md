# 🐟 Fish Deploy Function - `scym`

## Ubicación
`~/.config/fish/functions/scym.fish`

## ¿Qué hace?

Esta función automatiza todo el proceso de deployment:

1. ✅ **Carga variables** del `.env`
2. ✅ **Verifica Turso** configuración
3. ✅ **Push schema** a base de datos remota
4. ✅ **Sincroniza contenido** desde Obsidian
5. ✅ **Deploya** a Vercel producción

## Uso

```bash
scym
```

¡Eso es todo! 🎉

## Primera Vez (Setup Inicial)

Antes de usar `scym` por primera vez:

```bash
# 1. Configura Turso
bash scripts/setup-turso.sh

# 2. Agrega las variables a tu .env
# ASTRO_DB_REMOTE_URL="libsql://..."
# ASTRO_STUDIO_APP_TOKEN="..."

# 3. Ahora sí, usa scym
scym
```

## Output Esperado

```
🚀 CYMP Deploy Script

📝 Loading environment variables...
✅ Turso configured

📤 Pushing DB schema to Turso...
✅ Schema pushed successfully

🔄 Syncing content...
✅ Sync OK: /path/to/source -> /path/to/dest

🚢 Deploying to Vercel...
[Vercel deployment output...]

🎉 Deployment complete!
```

## Si Turso no está configurado

El script te preguntará:

```
⚠️  Turso variables not set. Run: bash .../setup-turso.sh

Continue without DB push? (y/N):
```

- Presiona `n` para cancelar y configurar Turso primero
- Presiona `y` para continuar sin push de schema (no recomendado)

## Troubleshooting

### Error: "Failed to push schema to Turso"
```bash
# Verifica que las variables estén en .env
cat .env | grep ASTRO

# Prueba manualmente
astro db push --remote
```

### Error: "Sync failed"
```bash
# Verifica que los directorios existan
ls "/Users/zztt/My Drive/Obsidian/cym/06-out"
ls "/Users/zztt/My Drive/Obsidian/samples/framework/src/content"
```

### Error en Vercel
```bash
# Asegúrate de estar logueado
vercel login

# Verifica que el proyecto esté linkeado
cd "/Users/zztt/My Drive/Obsidian/samples/framework"
vercel
```

## Recargar Función

Si modificas `scym.fish`:

```bash
source ~/.config/fish/functions/scym.fish
```

O simplemente abre una nueva terminal de Fish.

## Ventajas vs Script Bash

✅ **Todo en uno**: Un solo comando
✅ **Interactivo**: Te avisa si falta algo
✅ **Safe**: Valida antes de deployar
✅ **Fish native**: Sintaxis limpia
✅ **Error handling**: Se detiene si algo falla

---

Para más detalles sobre deployment: `QUICK-START-DEPLOY.md`
