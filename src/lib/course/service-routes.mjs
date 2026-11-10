// Servicios que ocupan una ruta de la materia (hoy, amigx-criticx en s123).
// Si una nota de concepto comparte el slug con un servicio, las dos existen: el
// servicio se queda con la URL —es la que recibieron los alumnos— y muestra la
// nota plegada en #concepto.
import config from '../../../scripts/content/service-routes.json' with { type: 'json' };

export const FOLDED_CONCEPT_ANCHOR = 'concepto';

/** @typedef {{ id: string, label?: string, courseId: string, slugs: string[], views: string[], conceptSlug?: string }} ServiceRoute */

/** @type {ServiceRoute[]} */
export const SERVICE_ROUTES = config.services;

const clean = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Qué servicio y qué vista corresponden a un tramo de ruta: `amigx-criticx`,
 * `amigx-criticx-devoluciones`, `85-amigx-criticx`... `courseId` vacío busca
 * en todas las materias (las rutas de primer nivel, sin materia).
 * @returns {{ service: ServiceRoute, view: string } | null}
 */
export function matchServiceRoute(segment, courseId = '') {
  const s = clean(segment);
  if (!s) return null;
  for (const service of SERVICE_ROUTES) {
    if (courseId && clean(courseId) !== clean(service.courseId)) continue;
    for (const slug of service.slugs) {
      if (s === slug) return { service, view: '' };
      const view = service.views.find((v) => s === `${slug}-${v}`);
      if (view) return { service, view };
    }
  }
  return null;
}

/** El servicio que muestra plegada la nota de concepto con este slug, si hay. */
export function serviceForConceptSlug(slug) {
  const s = clean(slug);
  return s ? SERVICE_ROUTES.find((r) => r.conceptSlug && clean(r.conceptSlug) === s) || null : null;
}

/** Href de un [[enlace]] a una nota: con #concepto si la nota vive plegada en un servicio. */
export function noteLinkHref(slug) {
  return serviceForConceptSlug(slug) ? `/${slug}#${FOLDED_CONCEPT_ANCHOR}` : `/${slug}`;
}
