# musiki.org.ar Cutover

Objetivo:

- `musiki.org.ar` y `www.musiki.org.ar` apuntan al proyecto `framework` en Vercel
- `edu.musiki.org.ar` queda intacto en Hostinger
- la wiki histórica sigue disponible en `https://musiki.org.ar/wiki`
- no volver a tocar Google OAuth después de este cambio

## 1. Decisión de DNS

No cambiar nameservers.

Mantener `ns1.dns-parking.com` y `ns2.dns-parking.com` en Hostinger y modificar sólo los records necesarios.

Razón:

- ya existen subdominios activos como `edu.musiki.org.ar`
- cambiar nameservers obliga a recrear toda la zona DNS en otro proveedor
- para este caso alcanza con apuntar apex y `www` a Vercel

## 2. Estado actual a preservar

- `edu.musiki.org.ar` responde desde Hostinger
- `www.musiki.org.ar` es alias de `musiki.org.ar`
- `musiki.org.ar` hoy tiene un `AAAA` activo en Hostinger

No tocar:

- `edu.musiki.org.ar`
- MX
- TXT/SPF/DKIM/DMARC
- cualquier otro subdominio que siga vivo

## 3. Proyecto nuevo en Vercel

En el proyecto `framework`:

1. agregar `musiki.org.ar`
2. agregar `www.musiki.org.ar`
3. copiar las environment variables necesarias desde el proyecto viejo
4. crear el nuevo `VERCEL_DEPLOY_HOOK_URL`

Vercel pide:

- apex domain: `A 76.76.21.21`
- subdomain: `CNAME` al target que indique Vercel

Nota:

- para `www`, usar el target exacto que muestre Vercel en la pantalla de Domains

## 4. Cambios en Hostinger

Abrir:

- `Domains`
- `musiki.org.ar`
- `DNS / Nameservers`

Aplicar:

1. eliminar el `AAAA` del root `@` si entra en conflicto con el apex de Vercel
2. crear o editar `A` para `@` con valor `76.76.21.21`
3. cambiar `www` a `CNAME` con el target exacto de Vercel
4. dejar `edu` sin cambios

Si existe un record viejo conflictivo para `www`, borrarlo antes de crear el nuevo.

## 5. Subdominio origen para la wiki

Crear en Hostinger un subdominio técnico para la wiki vieja:

- `wiki-origin.musiki.org.ar`

Ese subdominio debe seguir sirviendo el MediaWiki histórico desde Hostinger.

La idea es:

- Vercel atiende `musiki.org.ar`
- Hostinger sigue atendiendo la wiki vieja detrás de `wiki-origin.musiki.org.ar`
- Vercel hace reverse proxy de `/wiki` hacia ese origen

## 6. Ajuste de MediaWiki

Para que la wiki funcione correctamente bajo `/wiki`, conviene configurarla como wiki montada en ese path.

En `LocalSettings.php`, revisar al menos:

```php
$wgServer = "https://musiki.org.ar";
$wgScriptPath = "/wiki";
$wgArticlePath = "/wiki/$1";
```

Si la instalación usa valores derivados de `index.php`, revisar también:

```php
$wgScript = "$wgScriptPath/index.php";
```

Objetivo:

- los links internos generados por MediaWiki deben salir bajo `/wiki`
- los assets y endpoints auxiliares deben colgar también de `/wiki`

## 7. Rewrite a activar en framework

Cuando `wiki-origin.musiki.org.ar` ya responda bien y MediaWiki ya esté configurada para `/wiki`, agregar este archivo en la raíz del repo `framework`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/wiki",
      "destination": "https://wiki-origin.musiki.org.ar/wiki"
    },
    {
      "source": "/wiki/:path*",
      "destination": "https://wiki-origin.musiki.org.ar/wiki/:path*"
    }
  ]
}
```

No activarlo antes de que el origen y MediaWiki estén listos.

## 8. Google OAuth

Si el sitio definitivo queda en `https://musiki.org.ar`, éste debería ser el valor estable de:

- `BETTER_AUTH_URL`

Y el callback autorizado en Google debería quedar en:

- `https://musiki.org.ar/api/auth/callback/google`

Eso evita volver a tocar OAuth en futuras migraciones internas de infraestructura.

## 9. Orden recomendado

1. crear el proyecto nuevo `framework` en Vercel
2. agregar `musiki.org.ar` y `www`
3. copiar env vars
4. crear el nuevo deploy hook
5. crear `wiki-origin.musiki.org.ar` en Hostinger
6. ajustar `LocalSettings.php` de MediaWiki
7. cambiar `A @` y `CNAME www` en Hostinger
8. verificar que `edu.musiki.org.ar` siga intacto
9. recién después activar el rewrite `/wiki`
10. probar login, dashboard, contenido de `i1` y wiki

## 10. Smoke test

- `https://musiki.org.ar/` abre `framework`
- `https://www.musiki.org.ar/` resuelve al mismo sitio
- `https://edu.musiki.org.ar/` sigue respondiendo Moodle
- `https://musiki.org.ar/wiki` abre la wiki histórica
- `https://musiki.org.ar/api/auth/callback/google` queda autorizado en Google
