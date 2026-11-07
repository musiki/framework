# Estado de las alertas de dependencias · noviembre 2026

Partida: 48 vulnerabilidades, 6 críticas. Después de esta pasada: 44, 4 críticas.
Lo que se cerró no se cerró actualizando sino sacando lo que no se usa.

## Cerrado

### better-auth · account takeover (dependabot #283)

`better-auth@1.6.18` estaba en `dependencies` y **no se importaba en ninguna parte**
del código. La autenticación real corre por `auth-astro` + `@auth/core` con Google
(ver `auth.config.ts`, `src/middleware.ts`, `src/pages/api/auth/[...auth].ts`).

Se desinstaló. Mejor que actualizar: la superficie desaparece en vez de achicarse.

### RCE por AVIF en Astro (dependabot #190 y #192)

El proyecto corre `output: 'server'` con el adapter de node, así que Astro expone el
endpoint `/_image` en runtime y lo respalda `sharp`. Ese es el vector. Pero **nadie
usa `astro:assets`, `<Image>` ni `getImage()`** en todo el código.

Se configuró `image: { service: passthroughImageService() }` en `astro.config.mjs`:
las imágenes se sirven tal cual y el endpoint queda sin procesador. Cierra el vector
sin tocar la versión de Astro.

Si en algún momento hace falta `<Image>`, hay que sacar esa línea **y subir Astro
primero**, no al revés.

### DOMPurify (dependabot #263)

`3.4.16` → `3.4.17`. Parche, sin cambios de API.

## Abierto, con criterio

### @auth/core y auth-astro · crítico

`@auth/core@0.37.4` está en el rango vulnerable (`<=0.41.2`) y la corrección está en
`0.41.3`. No se puede subir solo: `auth-astro@4.2.0` —que ya es la última— declara
`peerDependencies: { "@auth/core": "^0.37.3" }`, o sea `>=0.37.3 <0.38.0`.

Tres caminos, en orden de preferencia:

1. Esperar a que `auth-astro` amplíe el peer. Es un paquete chico y puede tardar.
2. Forzar `0.41.x` con `overrides` en `package.json` y probar el login de Google a
   fondo. Entre 0.37 y 0.41 hubo cambios de API, así que no es un bump transparente.
3. Sacar `auth-astro` y hablar con `@auth/core` directo. `[...auth].ts` ya importa
   `Auth` de `@auth/core`, así que la distancia es menor de lo que parece.

Mientras tanto, lo que mitiga: el login es sólo Google OAuth, no hay magic links ni
email-OTP propios, que es donde pegan varias de las fallas listadas.

### astro · crítico

`6.2.1`, rango vulnerable `<=7.3.1`, corregido en `7.4.7`. Es un salto mayor, 6 → 7.
Las fallas que quedan abiertas son XSS por nombres de atributo sin escapar en spread
props y en directivas `transition:*` de islas hidratadas. Relevante sólo donde se
hace spread de atributos con datos de usuario.

No es un `npm update`: es una migración con su propia sesión y su propio testeo.

### tar · crítico, pero devDependency

Lo trae el CLI `supabase`, que sigue en `devDependencies` porque lo usan
`scripts/db-backup.sh` y `scripts/apply-user-settings-schema.sh`. Sacarlo rompería
los backups. Un `tar` vulnerable en una herramienta de línea de comandos que corrés
vos no es lo mismo que uno en el runtime público.

Pendiente menor: `@supabase/supabase-js` sigue en `dependencies` y ya no se usa en
el código (AGENTS.md lo da por removido). Se puede sacar, pero es limpieza, no
seguridad.

## Verificación de esta pasada

- `npm test`: 1161 pasan, 1 salteado, 0 fallan
- `node --check astro.config.mjs`: OK
- `npm audit`: 6 críticas → 4
