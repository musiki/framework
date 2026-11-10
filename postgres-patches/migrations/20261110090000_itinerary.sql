BEGIN;

-- Itinerario de una cohorte.
--
-- El recorrido de la cursada (qué se ve y en qué orden) lo arma el docente en
-- Progreso y vive acá, no en el repo de la materia: Obsidian genera el contenido,
-- musiki ordena la clase (docs/plans/2026-11-07-itinerario-taxonomia-y-progreso.md,
-- sección 18).
--
-- Una fila por cohorte. Las paradas van en jsonb porque la UI las edita como una
-- lista que se reordena entera: cada guardado reemplaza la lista, y "version"
-- evita que dos pestañas se pisen (el que guarda con una versión vieja recibe 409).
-- Duplicar el itinerario a la cohorte siguiente es copiar una fila.
--
-- Forma de cada parada: { "id", "title", "kind", "notes": [slug, ...] }.
-- La valida src/lib/itinerary/itinerary.mjs antes de escribir.

CREATE TABLE IF NOT EXISTS public."Itinerary" (
  "cohortId"  bigint      PRIMARY KEY REFERENCES public."Cohort" ("id") ON DELETE CASCADE,
  "courseId"  text        NOT NULL,
  "stops"     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "version"   integer     NOT NULL DEFAULT 1,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" uuid        REFERENCES public."User" ("id") ON DELETE SET NULL,
  CONSTRAINT "Itinerary_stops_is_array" CHECK (jsonb_typeof("stops") = 'array')
);

CREATE INDEX IF NOT EXISTS "Itinerary_courseId_idx" ON public."Itinerary" ("courseId");

COMMIT;
