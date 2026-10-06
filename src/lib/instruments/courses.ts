/**
 * musiki courses whose left sidebar shows the compact <soog-dashboard>
 * widget (vendored at /vendor/soog-dashboard/soog-dashboard.js).
 * Canonical course ids only; aliases are resolved by the course page.
 */
export const SOOG_DASHBOARD_COURSES: readonly string[] = Object.freeze(['i1', 'i2']);

export function showsSoogDashboard(courseId: string | null | undefined): boolean {
  if (typeof courseId !== 'string') return false;
  return SOOG_DASHBOARD_COURSES.includes(courseId.trim().toLowerCase());
}

/** Spanish UI strings for the element's `labels` attribute (keys: DEFAULT_LABELS). */
export const SOOG_DASHBOARD_LABELS_ES = Object.freeze({
  title: 'Dashboard MOAIE',
  subtitle: 'Organología especulativa · registro vivo de instrumentos',
  loading: 'Cargando instrumentos…',
  errorSrc: 'Fuente inválida: "src" debe ser una ruta del mismo origen que empiece con "/".',
  errorLoad: 'No se pudieron cargar los instrumentos.',
  errorChart: 'Gráficos no disponibles (no se pudo cargar Chart.js). Se muestra la tabla.',
  errorChartShort: 'Gráficos no disponibles (no se pudo cargar Chart.js).',
  empty: 'Todavía no hay instrumentos.',
  statInstruments: 'Instrumentos',
  statScored: 'Puntuados (MOAIE)',
  statFictional: 'Ficcionales',
  selectHeading: 'Elegí instrumentos para comparar',
  selectAll: 'Seleccionar todos',
  clear: 'Limpiar',
  unscoredHeading: 'Sin puntuar',
  compareHeading: 'Vector MOAIE · perfil de interfaz — instrumentos seleccionados',
  moaieHeading: 'Vector MOAIE — M O A I E',
  profileHeading: 'Perfil de interfaz — 10 dimensiones',
  moaieAria: 'Radar MOAIE — cinco ejes M O A I E, de 0 a 1, una serie por instrumento seleccionado.',
  profileAria: 'Radar del perfil de interfaz — 10 dimensiones, una serie por instrumento seleccionado.',
  noProfile: 'Los instrumentos seleccionados no tienen perfil de interfaz.',
  noSelection: 'Ningún instrumento seleccionado.',
  table: 'Tabla',
  tableCaption: 'Vectores MOAIE de los instrumentos seleccionados',
  instrument: 'Instrumento',
  detailsHeading: 'Detalles',
  year: 'Año',
  family: 'Familia',
  layer: 'Capa',
  sachsHornbostel: 'Sachs–Hornbostel',
  authors: 'Autores',
  person: 'Constructor/a',
  recursive: 'Recursivo',
  yes: 'sí',
  no: 'no',
  connect: 'Conexiones',
  link: 'Sitio web',
  fictional: 'ficcional',
  instruments: 'instrumentos',
  scored: 'puntuados',
  notScored: 'sin puntuar',
  hyper: 'Hiper',
  detailAria: 'Radar MOAIE de este instrumento — cinco ejes M O A I E, de 0 a 1.',
  search: 'Buscar instrumentos…',
  listHint: 'Flechas para moverse, Enter abre el detalle, Espacio agrega a la comparación.',
  addToCompare: 'Agregar a la comparación',
  compareTab: 'Comparar',
  detailTab: 'Detalle',
  videos: 'Videos',
  playVideo: 'Reproducir video',
  tags: 'Etiquetas',
  openImage: 'Abrir imagen',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  noResults: 'Ningún instrumento coincide con la búsqueda.',
  selectInstrument: 'Elegí un instrumento de la lista para ver el detalle.',
  openDashboard: 'Abrir dashboard',
  close: 'Cerrar',
  axisNames: { M: 'Material', O: 'Objeto', A: 'Agente', I: 'Interacción', E: 'Entorno' },
  profileLabels: ['Affordance', 'Liveness', 'Jugabilidad', 'Aprendibilidad', 'Situacionalidad', 'Medialidad', 'Mapeo', 'Sensoriomotor', 'Ergonomía', 'Expresividad'],
});
