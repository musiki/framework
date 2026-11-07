# Handoff a Claude Code en terminal — 2026-11-07

Este archivo es un prompt para pegar en Claude Code corriendo en terminal, en
`~/projects/26-musiki/framework`. Existe porque la sesión anterior corría en un
sandbox sin ruta al VPS ni acceso a `~/.ssh`, y cada error de servidor costaba
un ida y vuelta completo con el humano copiando output a mano.

Todo lo que sigue, desde la línea de corte, se pega tal cual.

---

Trabajo en `~/projects/26-musiki/framework` y `~/projects/26-musiki/s123`.
Vos tenés mi red y mis claves SSH: hacé el ssh, el deploy y las migraciones
vos mismo, y leé los errores de primera mano. No me pases comandos para que
los corra yo salvo que algo necesite una decisión mía.

## Entorno

- Mi shell es fish, acá y en el VPS. Los scripts son bash: sobre ssh usá
  `bash -lc`. Los scripts tienen que tener bit de ejecución o fish los rechaza.
- VPS: `zz@46.225.154.68`, el framework en `/opt/musiki/framework`.
- Postgres corre en Docker, en un contenedor llamado `authentik-postgresql`.
  El nombre es herencia: hace meses migramos de Authentik a Logto y el
  contenedor quedó con el nombre viejo. Ahí viven varias bases; la del LMS es
  `musiki26`, usuario `app`. Logto vive aparte, en `/opt/logto`.
- La app se reinicia con `docker restart devmusiki-app`.
- En el VPS corre Node v22.22.2 y `package.json` declara `engines: {node: 24.x}`.
  Cada `npm ci` escupe EBADENGINE. Local tengo 24.16.0.
- Los deploys van por `./scripts/vps/deploy-framework.sh`, que hace ssh y
  corre `scripts/vps-update.sh` allá: pull, npm ci, migraciones, build,
  restart. Si las migraciones fallan corta antes del build a propósito, así
  producción sigue sirviendo la build vieja, coherente con el esquema viejo.
- Las migraciones van por `./scripts/db-migrate.sh`, que es un wrapper ssh
  sobre `scripts/vps/db-migrate.sh`. El registro de qué está aplicado está en
  la tabla `SchemaMigration` de `musiki26`.

## Estado roto, en orden de urgencia

### 1. La tabla Cohort no existe pero el registro dice que sí

`postgres-patches/migrations/20261107120000_cohorts.sql` figura como aplicada
en `SchemaMigration` y nunca corrió. Pasó porque `--baseline` marcaba *todas*
las pendientes sin pedir hasta dónde, incluida la nueva. Ya está arreglado en
el script —ahora exige el corte— y se agregó `--unmark`, pero la base sigue
mal. Verificable:

```sql
SELECT to_regclass('public."Cohort"');  -- da NULL
```

Reparación:

```
./scripts/db-migrate.sh --unmark 20261107120000_cohorts.sql
./scripts/db-migrate.sh --status     # tiene que decir 36 aplicadas · 1 pendiente
./scripts/db-migrate.sh --dry-run
./scripts/db-migrate.sh
```

Si `--status` sigue diciendo `37 · 0` después del unmark, pará y averiguá por
qué el DELETE no tocó la fila. Hubo ya dos bugs en este script y los dos
produjeron silencio en vez de error.

Después, confirmá contra la base:

```sql
SELECT "courseId", "label", "isActive" FROM "Cohort" ORDER BY 1;
SELECT COUNT(*) FROM "Enrollment" WHERE "cohortId" IS NULL;  -- tiene que dar 0
```

Hay un commit sin pushear en framework: `f705f32`. Pushealo antes de deployar,
porque el VPS pullea de GitHub.

### 2. El build muere por frontmatter

Las dos notas de 2027 en s123 tenían `tags: edu/s123` pelado y
`src/content.config.ts` declara `tags: z.array(z.string())`. Un escalar ahí no
rompe la nota: rompe el build entero, y recién en el VPS. Ya está corregido en
el vault y en `tools/compilar-temas.py`, y el validador global
(`scripts/content/validar-notas.py`) lo detecta y lo arregla con `--arreglar`.

Lo que falta: el commit `28522c2` de s123 no llegó a GitHub. El push fue
rechazado porque el bot del CI había commiteado `ab26383` encima. Resolvelo:

```
cd ~/projects/26-musiki/s123
git pull --rebase origin main && git push origin main
```

Después deployá el framework y confirmá que el build llega al final. El
síntoma a buscar es `InvalidContentEntryDataError`.

### 3. Node 24 en el VPS

El EBADENGINE de cada `npm ci` no es cosmético: tengo pendiente migrar Astro 6
a 7, y arrancar eso con tres versiones de Node divergentes —mi shell, mi
runtime, el servidor— vuelve impredecible cualquier diagnóstico. Averiguá cómo
está instalado Node allá (nvm, apt, fnm, la imagen de Docker) antes de tocar
nada, y planteame la vía menos invasiva. No lo cambies sin decírmelo: si el
contenedor de la app trae su propio Node, el problema puede estar en otro lado.

## Después de eso, en este orden

1. **Astro 6 → 7.** `astro ^6.2.1`, `@astrojs/node ^10.0.6`, React 19.2.6, SSR
   con adapter node standalone. Leé la guía de upgrade oficial antes de tocar
   `astro.config.mjs`. Ojo: ahí hay un `passthroughImageService()` puesto a
   propósito para cerrar el RCE de AVIF, y nada usa `astro:assets`. No lo
   saques. Probá con el dev server local antes de deployar.
2. **Rotar la contraseña de la base.** Está en texto plano en
   `scripts/db-tunnel.sh` y en el historial de git. El script ya no se usa
   —las migraciones corren por `docker exec` dentro del VPS, sin túnel— así
   que proponeme borrarlo además de rotar.
3. **Dependabot.** GitHub reporta 197 vulnerabilidades en la rama default, 3
   críticas. Ya cerramos tres el mes pasado: saqué `better-auth` (no se usaba,
   alerta de account takeover), puse `passthroughImageService()` por el AVIF, y
   parchée dompurify. Mirá qué queda y distinguí lo que afecta runtime de lo
   que es sólo cadena de build.

## Cómo quiero que trabajes

- Español. Argentinismos bienvenidos.
- Commiteá a mi nombre: Luciano Azzigotti, lucianoazzigotti@gmail.com.
- Los mensajes de commit explican por qué, no qué. Si arreglás un error
  propio, decilo en el mensaje.
- Sé crítico. Si algo de lo que pido está mal planteado, decilo antes de
  hacerlo. Las dos veces que esta semana algo salió mal fue porque un script
  eligió un default cómodo donde hacía falta una decisión explícita, y el
  resultado fue un estado equivocado sin un solo error en pantalla. Preferí
  que algo falle ruidoso antes que siga en silencio.
- No me digas que verificaste algo que no verificaste contra la base o contra
  el servidor real.
