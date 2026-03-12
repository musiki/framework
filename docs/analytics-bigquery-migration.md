# Musiki Analytics + BigQuery

Estado al 2026-03-12 para `musiki.org.ar`.

## GA4

- Stream URL: `http://musiki.org.ar`
- Stream ID: `2234233079`
- Measurement ID: `G-0NXGW5G7NX`

En el sitio nuevo, GA4 se carga desde [BaseHead.astro](/Users/zztt/projects/26-musiki/framework/src/components/BaseHead.astro) y:

- trackea `page_view` en carga inicial
- trackea navegacion cliente de Astro
- no envia datos desde `localhost`

## BigQuery

Configuracion recomendada para este proyecto:

- Data location: `US`
- Event data export: `Daily`
- Streaming export: `Off` por ahora
- User data export: `Daily`
- Excluded events: ninguno

Notas:

- `Daily` es suficiente para analisis editorial, migracion de URLs y priorizacion de redirects.
- `Streaming` se puede activar despues si hace falta casi tiempo real, pero no es necesario para la migracion.
- El export a BigQuery empieza a guardar desde el momento de activacion; no reconstruye automaticamente historico viejo.

## BigQuery queries

Reemplazar:

- `YOUR_PROJECT_ID`
- `PROPERTY_ID`

El dataset esperado es:

- `YOUR_PROJECT_ID.analytics_PROPERTY_ID`

### Top paginas por URL completa

```sql
SELECT
  event_date,
  page_location,
  page_title,
  COUNT(*) AS page_views
FROM `YOUR_PROJECT_ID.analytics_PROPERTY_ID.events_*`
WHERE event_name = 'page_view'
GROUP BY event_date, page_location, page_title
ORDER BY page_views DESC;
```

### Top paths consolidados

```sql
SELECT
  REGEXP_REPLACE(
    (
      SELECT ep.value.string_value
      FROM UNNEST(event_params) ep
      WHERE ep.key = 'page_location'
    ),
    r'^https?://[^/]+',
    ''
  ) AS page_path,
  COUNT(*) AS page_views
FROM `YOUR_PROJECT_ID.analytics_PROPERTY_ID.events_*`
WHERE event_name = 'page_view'
GROUP BY page_path
ORDER BY page_views DESC;
```

### Landing pages

```sql
SELECT
  REGEXP_REPLACE(
    (
      SELECT ep.value.string_value
      FROM UNNEST(event_params) ep
      WHERE ep.key = 'page_location'
    ),
    r'^https?://[^/]+',
    ''
  ) AS landing_path,
  COUNT(*) AS sessions
FROM `YOUR_PROJECT_ID.analytics_PROPERTY_ID.events_*`
WHERE event_name = 'session_start'
GROUP BY landing_path
ORDER BY sessions DESC;
```

## Uso para migracion MediaWiki -> Musiki

Objetivo:

- preservar trafico historico util
- priorizar redirects
- evitar perder paginas con entrada organica o enlaces externos

Tabla de trabajo recomendada:

```text
old_url
new_url
status
page_views
sessions
priority
notes
```

Lectura sugerida de prioridad:

- `alta`: mucha entrada directa, mucho trafico, mucha relevancia editorial
- `media`: trafico moderado o valor SEO claro
- `baja`: poco trafico o pagina secundaria

## Siguiente paso operativo

1. Esperar a que aparezca el dataset `analytics_<property_id>` en BigQuery.
2. Ejecutar las queries de `top paths` y `landing pages`.
3. Exportar resultado a CSV o tabla derivada.
4. Cruzar eso con el inventario de URLs viejas de MediaWiki.
5. Construir el mapa `old_url -> new_url` antes del cutover final.

## Fuentes oficiales

- GA4 BigQuery export setup: [Google Analytics Help](https://support.google.com/analytics/answer/9823238?hl=en)
- GA4 BigQuery export schema: [Google Analytics Help](https://support.google.com/analytics/answer/7029846)
- Google Analytics Data API quickstart: [Google Developers](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart)
- Search Console bulk export to BigQuery: [Google Search Central Blog](https://developers.google.com/search/blog/2023/02/bulk-data-export)
- Search Console Search Analytics API: [Google Developers](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- Universal Analytics end of availability: [Google Developers](https://developers.google.com/analytics/devguides/migration/api/reporting-ua-to-ga4)
