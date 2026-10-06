/*!
 * soog-dashboard 0.2.0
 * SOOG_DASHBOARD_VERSION = '0.2.0'
 *
 * <soog-dashboard> — framework-free custom element showing the SOOG / MOAIE
 * dashboard, fed live from a same-origin JSON endpoint shaped
 * `{ generatedAt, instruments: PublicInstrument[] }`.
 *
 * Full mode: a searchable instrument sidebar (thumbnail, title, year · family,
 * compare checkbox) next to two tabs — "Compare" (MOAIE radar, interface
 * profile radar, legend, table, unscored list) and "Detail" (large image with
 * a zoomable lightbox, metadata, tags, MOAIE texts + radar, connections and
 * click-to-load videos). Compact mode: small radar + "Open dashboard" dialog.
 *
 * No build step: plain ESM, safe to vendor as a single file. Chart.js 4.4.4
 * is the only external code and is loaded on demand from jsDelivr.
 *
 * Attributes
 *   src      same-origin path ("/..." but not "//..."), default /api/public/instruments
 *   title    heading (moved to data-soog-title on connect to avoid the native tooltip)
 *   initial  number of preselected scored instruments, default 4
 *   mode     "full" (default) | "compact"
 *   labels   JSON object overriding UI strings (see DEFAULT_LABELS)
 */

export const SOOG_DASHBOARD_VERSION = '0.2.0';
export const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
export const DEFAULT_SRC = '/api/public/instruments';
export const DEFAULT_N = 4;

export const AXIS = ['M', 'O', 'A', 'I', 'E'];
export const PROFILE_KEYS = ['affordance', 'liveness', 'playability', 'learnability', 'situatedness', 'mediality', 'mapping', 'sensorimotor_scheme', 'ergonomics', 'expressivity'];
export const PALETTE = ['#1D9E75', '#3266ad', '#A32D2D', '#7F77DD', '#EF9F27', '#2AACBB', '#D4602A', '#B2983E', '#8A8A9A', '#1C3C78', '#C0518A', '#5BA646'];

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

export const DEFAULT_LABELS = {
  title: 'MOAIE dashboard',
  subtitle: 'Speculative Organology · live instrument registry',
  loading: 'Loading instruments…',
  errorSrc: 'Invalid source: "src" must be a same-origin path starting with "/".',
  errorLoad: 'Could not load the instruments.',
  errorChart: 'Charts unavailable (Chart.js could not be loaded). Showing the table instead.',
  errorChartShort: 'Charts unavailable (Chart.js could not be loaded).',
  empty: 'No instruments yet.',
  statInstruments: 'Instruments',
  statScored: 'Scored (MOAIE)',
  statFictional: 'Fictional',
  selectHeading: 'Select instruments to compare',
  selectAll: 'Select all',
  clear: 'Clear',
  unscoredHeading: 'Not yet scored',
  compareHeading: 'MOAIE vector · interface profile — selected instruments',
  moaieHeading: 'MOAIE vector — M O A I E',
  profileHeading: 'Interface profile — 10 dimensions',
  moaieAria: 'MOAIE radar — five axes M O A I E, 0 to 1, one series per selected instrument.',
  profileAria: 'Interface profile radar — 10 dimensions, one series per selected instrument.',
  detailAria: 'MOAIE radar of this instrument — five axes M O A I E, 0 to 1.',
  noProfile: 'No interface profile for the selected instruments.',
  noSelection: 'No instruments selected.',
  table: 'Table',
  tableCaption: 'MOAIE vectors of the selected instruments',
  instrument: 'Instrument',
  detailsHeading: 'Details',
  year: 'Year',
  family: 'Family',
  layer: 'Layer',
  sachsHornbostel: 'Sachs–Hornbostel',
  authors: 'Authors',
  person: 'Maker',
  recursive: 'Recursive',
  yes: 'yes',
  no: 'no',
  connect: 'Connections',
  hyper: 'Hyper',
  link: 'Website',
  fictional: 'fictional',
  instruments: 'instruments',
  scored: 'scored',
  notScored: 'not scored',
  openDashboard: 'Open dashboard',
  close: 'Close',
  // sidebar / tabs / detail
  search: 'Search instruments…',
  listHint: 'Arrow keys move, Enter opens the detail, Space adds to the comparison.',
  addToCompare: 'Add to comparison',
  compareTab: 'Compare',
  detailTab: 'Detail',
  videos: 'Videos',
  playVideo: 'Play video',
  tags: 'Tags',
  openImage: 'Open image',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  noResults: 'No instruments match the search.',
  selectInstrument: 'Select an instrument in the list to see its details.',
  axisNames: { M: 'Material', O: 'Object', A: 'Agent', I: 'Interaction', E: 'Environment' },
  profileLabels: ['Affordance', 'Liveness', 'Playability', 'Learnability', 'Situatedness', 'Mediality', 'Mapping', 'Sensorimotor', 'Ergonomics', 'Expressivity'],
};

/**
 * Same-origin absolute path only. Lexically: starts with a single "/" (not
 * "//", not "/\\") and contains no control characters or whitespace (the URL
 * parser strips tab/CR/LF, so "/\t/evil.com" would otherwise become
 * "//evil.com"). Then, when a base URL is known (browser: location.href),
 * the resolved URL must have the same origin as the base.
 */
export function isSameOriginPath(src, base) {
  if (typeof src !== 'string' || !/^\/(?![\/\\])/.test(src)) return false;
  if (/[\u0000-\u001F\u007F\s]/.test(src)) return false;
  const href = base || (globalThis.location && globalThis.location.href);
  if (!href) return true; // no location (plain Node): lexical checks only
  try {
    const b = new URL(href);
    return new URL(src, b).origin === b.origin;
  } catch {
    return false;
  }
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function isHttps(u) { return typeof u === 'string' && /^https:\/\//i.test(u); }
function str(x) { return x == null ? '' : String(x); }
function strList(x) { return Array.isArray(x) ? x.map((v) => str(v).trim()).filter(Boolean) : []; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** Lower-case, accent-free text for search (NFD + strip combining marks). */
export function normalizeText(s) {
  return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Searchable haystack of a record: title, family, person, authors, year, tags. */
export function searchText(r) {
  return normalizeText([r.title, r.family, r.person, ...(r.authors || []), r.year, ...(r.tags || [])].join(' \u0001 '));
}

/** Every whitespace-separated term of `query` must occur in the record. */
export function matchesQuery(r, query) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = r._search != null ? r._search : searchText(r);
  return terms.every((t) => hay.includes(t));
}

const YT_ID = /^[A-Za-z0-9_-]{6,32}$/;
const VIMEO_ID = /^\d{1,15}$/;
/** Normalise one video entry; unknown providers or malformed ids are dropped. */
export function toVideo(v) {
  if (!v || typeof v !== 'object') return null;
  const provider = str(v.provider).toLowerCase();
  const id = str(v.id).trim();
  if (provider === 'youtube' ? !YT_ID.test(id) : provider === 'vimeo' ? !VIMEO_ID.test(id) : true) return null;
  return { provider, id, url: isHttps(v.url) ? v.url : '' };
}
/** Privacy-friendly embed URL, only requested after a click. */
export function videoEmbedUrl(v) {
  return v.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1`
    : `https://player.vimeo.com/video/${encodeURIComponent(v.id)}?autoplay=1&dnt=1`;
}

/** Normalise one PublicInstrument from the endpoint into the internal record. */
export function toRecord(inst, index) {
  const m = inst && typeof inst.moaie === 'object' && inst.moaie ? inst.moaie : {};
  const v = Array.isArray(m.vector) && m.vector.length === 5 && m.vector.every((x) => typeof x === 'number' && Number.isFinite(x)) ? m.vector.slice() : null;
  const scored = !!v && !m.empty;
  const p = inst && inst.profile && typeof inst.profile === 'object' ? inst.profile : null;
  const r = {
    key: str(inst && inst.id) || `i${index}`,
    title: str(inst && inst.title) || '—',
    year: inst && inst.year != null && inst.year !== '' ? str(inst.year) : '',
    family: str(inst && inst.family),
    layer: str(inst && inst.layer),
    sh: str(inst && inst.sachsHornbostel),
    authors: strList(inst && inst.authors),
    person: str(inst && inst.person),
    url: isHttps(inst && inst.url) ? inst.url : '',
    img: isHttps(inst && inst.img) ? inst.img : '',
    fictional: !!(inst && inst.fictional),
    recursive: !!m.recursive,
    text: m.text && typeof m.text === 'object' ? m.text : {},
    vector: scored ? v : null,
    scored,
    profile: p ? PROFILE_KEYS.map((k) => num(p[k])) : null,
    connect: strList(inst && inst.connect),
    hyper: strList(inst && inst.hyper),
    tags: strList(inst && inst.tags),
    videos: Array.isArray(inst && inst.videos) ? inst.videos.map(toVideo).filter(Boolean) : [],
  };
  r._search = searchText(r);
  return r;
}

// ── Chart.js: loaded once per page (shared module-level promise) ─────────
let chartPromise = null;
export function loadChart(win = globalThis.window) {
  if (win && win.Chart) return Promise.resolve(win.Chart);
  if (chartPromise) return chartPromise;
  chartPromise = new Promise((resolve, reject) => {
    const doc = win.document;
    let s = doc.querySelector('script[data-soog-chartjs]') || doc.querySelector(`script[src="${CHART_JS_URL}"]`);
    const done = () => (win.Chart ? resolve(win.Chart) : reject(new Error('Chart.js missing')));
    if (!s) {
      s = doc.createElement('script');
      s.src = CHART_JS_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-soog-chartjs', '');
      doc.head.appendChild(s);
    }
    s.addEventListener('load', done, { once: true });
    s.addEventListener('error', () => reject(new Error('Chart.js failed to load')), { once: true });
  });
  // A failed load stays rejected for the page: no new <script> per redraw/click.
  chartPromise.catch(() => {});
  return chartPromise;
}

const STYLE = `
:host {
  --_fg: var(--soog-fg, var(--so-fg, var(--c-text, var(--c-fg, currentColor))));
  --_bg: var(--soog-bg, var(--so-bg, var(--c-bg, Canvas)));
  --_border: var(--soog-border, var(--so-border, var(--c-border, color-mix(in srgb, currentColor 18%, transparent))));
  --_surface: var(--soog-surface, var(--so-surface, color-mix(in srgb, currentColor 4%, transparent)));
  --_accent: var(--soog-accent, var(--so-accent, var(--c-accent, #1D9E75)));
  --_button: color-mix(in srgb, currentColor 6%, transparent);
  --_hover: color-mix(in srgb, currentColor 8%, transparent);
  --_muted: color-mix(in srgb, currentColor 72%, transparent);
  --_faint: color-mix(in srgb, currentColor 60%, transparent);
  --_focus: color-mix(in srgb, currentColor 75%, transparent);
  display: block;
  container-type: inline-size;
  color: var(--_fg);
  font: inherit;
  line-height: 1.45;
  box-sizing: border-box;
}
:host([data-scheme="dark"]) { color-scheme: dark; }
:host([data-scheme="light"]) { color-scheme: light; }
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.root { max-width: 1320px; margin: 0 auto; padding: .5rem 0; }
.root.compact { max-width: 960px; }
h2 { font-size: 1.15em; font-weight: 600; margin: 0 0 .2rem; color: inherit; }
.sub { font-size: .8em; color: var(--_muted); margin-bottom: 1rem; }
.section { margin: 1.25rem 0; }
.label { font-size: .7em; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--_muted); margin: 0 0 .6rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.card { background: var(--_surface); border: 1px solid var(--_border); border-radius: 8px; padding: .55rem .85rem; }
.card-val { font-size: 1.4em; font-weight: 500; }
.card-lbl { font-size: .75em; color: var(--_muted); margin-top: 2px; }
button, input { font: inherit; color: inherit; }
.btn { background: var(--_button); border: 1px solid var(--_border); border-radius: 8px; padding: 4px 12px; font-size: .8em; cursor: pointer; color: var(--_muted); transition: color .15s, border-color .15s, background .15s; }
.btn:hover, .btn[aria-pressed="true"] { color: var(--_fg); border-color: color-mix(in srgb, currentColor 34%, transparent); }
:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
.controls { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; margin-bottom: .6rem; }
.controls .grow { flex: 1; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ── two-column layout ── */
.layout { display: grid; grid-template-columns: minmax(240px, 280px) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.side { position: sticky; top: 0; display: flex; flex-direction: column; max-height: var(--soog-sidebar-height, 85vh); min-height: 0; border: 1px solid var(--_border); border-radius: 10px; background: var(--_surface); overflow: hidden; }
.search-wrap { padding: 8px; border-bottom: 1px solid var(--_border); background: var(--_bg); }
.search { width: 100%; padding: 7px 10px; border: 1px solid var(--_border); border-radius: 7px; background: var(--_bg); font-size: .85em; }
.search::placeholder { color: var(--_faint); opacity: 1; }
.list-toggle { display: none; width: 100%; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding: 5px 8px; border: 1px solid var(--_border); border-radius: 7px; background: var(--_button); font-size: .8em; color: var(--_muted); cursor: pointer; }
.list-toggle .chev { transition: transform .15s; }
.list-toggle[aria-expanded="false"] .chev { transform: rotate(-90deg); }
.list { list-style: none; margin: 0; padding: 4px; overflow-y: auto; flex: 1; min-height: 0; overscroll-behavior: contain; }
.item { display: flex; align-items: center; gap: 2px; border-radius: 7px; }
.item:hover { background: var(--_hover); }
.row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; padding: 5px 6px; border-radius: 7px; cursor: pointer; border-left: 3px solid transparent; }
.row[aria-current="true"] { background: var(--_hover); border-left-color: var(--_accent); }
.row[aria-current="true"] .name { font-weight: 600; }
.thumb { width: 44px; height: 44px; flex: none; border-radius: 6px; overflow: hidden; background: var(--_button); border: 1px solid var(--_border); display: grid; place-items: center; color: var(--_faint); font-size: 1.1em; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.txt { min-width: 0; display: flex; flex-direction: column; }
.name { font-size: .85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { font-size: .72em; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fict { font-style: italic; }
.cmp { flex: none; display: flex; align-items: center; gap: 5px; padding: 8px 8px; cursor: pointer; }
.cmp input { width: 16px; height: 16px; margin: 0; accent-color: var(--_accent); cursor: pointer; }
.cmp input:disabled { cursor: not-allowed; opacity: .45; }
.swatch-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--_border); background: transparent; }
.list .note { padding: .75rem; }

/* ── tabs ── */
.tablist { display: flex; gap: 2px; border-bottom: 1px solid var(--_border); margin-bottom: 1rem; }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 7px 14px; font-size: .85em; color: var(--_muted); cursor: pointer; }
.tab:hover { color: var(--_fg); }
.tab[aria-selected="true"] { color: var(--_fg); font-weight: 600; border-bottom-color: var(--_accent); }

.unscored { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; padding: 0; margin: 0; }
.unscored li, .tag { border: 1px dashed var(--_border); border-radius: 4px; padding: 1px 7px; font-size: .75em; color: var(--_muted); }
.tag { border-style: solid; background: var(--_button); display: inline-block; margin: 2px 4px 2px 0; }
.tag.chip { border-radius: 999px; padding: 1px 9px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start; }
.chart-title { font-size: .7em; font-weight: 600; letter-spacing: .04em; color: var(--_faint); margin-bottom: .5rem; text-transform: uppercase; }
.radar { position: relative; height: 280px; }
.radar.profile { height: 360px; }
.radar.small { height: 190px; }
.radar.detail { height: 220px; }
.note { font-size: .8em; color: var(--_muted); }
.legend { margin-top: .75rem; }
.legend-row { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; font-size: .8em; color: var(--_muted); line-height: 1.5; }
.swatch { width: 10px; height: 10px; border-radius: 2px; margin-top: 5px; flex: none; }
.legend-row strong { color: var(--_fg); font-weight: 500; }
.legend-vec { font-size: .9em; font-variant-numeric: tabular-nums; }
.table-wrap { overflow-x: auto; margin-top: .75rem; }
table { border-collapse: collapse; width: 100%; font-size: .8em; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-size: .9em; color: var(--_muted); margin-bottom: .4rem; }
th, td { border-bottom: 1px solid var(--_border); padding: 4px 8px; text-align: right; }
th:first-child, td:first-child { text-align: left; }
thead th { font-weight: 600; color: var(--_muted); }

/* ── detail ── */
.detail h3 { margin: 0 0 .75rem; font-size: 1.25em; font-weight: 600; }
.detail h4 { font-size: .7em; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--_muted); margin: 1.25rem 0 .5rem; }
.badge { font-size: .55em; font-weight: 500; border: 1px dashed var(--_border); border-radius: 4px; padding: 0 5px; margin-left: 8px; color: var(--_muted); vertical-align: 4px; }
.detail-top { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
.detail-top.noimg { grid-template-columns: 1fr; }
.img-btn { display: block; width: 100%; padding: 0; border: 1px solid var(--_border); border-radius: 8px; overflow: hidden; background: var(--_button); cursor: zoom-in; position: relative; }
.img-btn img { display: block; width: 100%; height: auto; max-height: 460px; object-fit: contain; }
.img-btn .hint { position: absolute; right: 6px; bottom: 6px; font-size: .7em; padding: 2px 7px; border-radius: 4px; background: rgba(0,0,0,.66); color: #fff; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 0; font-size: .82em; }
dt { color: var(--_muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.tags { margin-top: .75rem; }
.detail-moaie { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 260px); gap: 1.25rem; align-items: start; }
.detail-moaie.novec { grid-template-columns: 1fr; }
.moaie-text { font-size: .85em; }
.moaie-text p { margin: .25rem 0 .5rem; }
.moaie-text b { font-weight: 600; }
a { color: inherit; text-underline-offset: 2px; }
.videos { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.video { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #111; border: 1px solid var(--_border); }
.video-tile { all: unset; box-sizing: border-box; position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; color: #fff; background: #1b1b1f center / cover no-repeat; }
.video-tile:focus-visible { outline: 2px solid var(--_focus); outline-offset: -4px; }
.video-tile { background: linear-gradient(135deg, #24242a, #121216); }
.video-tile .cap { position: absolute; left: 10px; right: 10px; top: 8px; font-size: .78em; line-height: 1.3; color: rgba(255,255,255,.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.video-tile .play { position: relative; width: 56px; height: 40px; border-radius: 10px; background: rgba(0,0,0,.72); display: grid; place-items: center; font-size: 18px; }
.video-tile:hover .play { background: rgba(0,0,0,.88); }
.video-tile .prov { position: absolute; left: 8px; bottom: 6px; font-size: .72em; padding: 1px 6px; border-radius: 4px; background: rgba(0,0,0,.66); }
.video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

.msg { border: 1px solid var(--_border); background: var(--_surface); color: var(--_muted); border-radius: 8px; padding: .75rem 1rem; font-size: .85em; }
.msg.error { border-color: color-mix(in srgb, #A32D2D 55%, transparent); }

/* ── lightbox ── */
.lightbox { position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: rgba(8, 8, 10, .94); color: #fff; z-index: 2147483000; overflow: hidden; }
.lightbox::backdrop { background: rgba(0, 0, 0, .6); }
.lb-bar { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 2; }
.lb-btn { min-width: 40px; height: 40px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.35); background: rgba(20,20,24,.75); color: #fff; font-size: 18px; line-height: 1; cursor: pointer; }
.lb-btn:hover:not(:disabled) { background: rgba(60,60,66,.9); }
.lb-btn:disabled { opacity: .4; cursor: default; }
.lb-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.lb-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; cursor: zoom-in; }
.lb-stage.zoomed { cursor: grab; }
.lb-stage.panning { cursor: grabbing; }
.lb-img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center center; user-select: none; -webkit-user-drag: none; transition: transform .12s ease-out; }
.lb-stage.panning .lb-img { transition: none; }
.lb-caption { position: absolute; left: 12px; bottom: 10px; right: 12px; font-size: .85em; color: rgba(255,255,255,.9); text-shadow: 0 1px 2px #000; pointer-events: none; }

.compact h2 { font-size: .95em; }
.compact .count { font-size: .78em; color: var(--_muted); margin: .4rem 0 .6rem; }
.compact .legend-row { font-size: .75em; margin: 3px 0; }
.compact .open { width: 100%; padding: 6px 10px; }
dialog.full-dialog { color: var(--_fg); background: var(--_bg); border: 1px solid var(--_border); border-radius: 10px; padding: 0; width: min(1240px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; }
dialog.full-dialog::backdrop { background: rgba(0, 0, 0, .45); }
.dialog-bar { position: sticky; top: 0; display: flex; justify-content: flex-end; padding: .5rem .75rem 0; background: var(--_bg); z-index: 1; }
.dialog-body { padding: 0 1.25rem 1rem; }

@container (max-width: 960px) {
  .compare { grid-template-columns: 1fr; }
  .detail-top { grid-template-columns: 1fr; }
  .img-btn img { max-height: 360px; }
}
@container (max-width: 699px) {
  .layout { grid-template-columns: 1fr; gap: 1rem; }
  .side { position: static; max-height: none; }
  .list-toggle { display: flex; }
  .side.collapsed .list { display: none; }
  .list { max-height: var(--soog-list-height, 260px); }
  .detail-moaie { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

const Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class SoogDashboard extends Base {
  static get observedAttributes() { return ['src', 'title', 'initial', 'mode', 'labels']; }

  constructor() {
    super();
    this._charts = [];
    this._registry = [];
    this._selected = new Set();
    this._focusKey = null;
    this._activeKey = null;
    this._query = '';
    this._tab = 'compare';
    this._showTable = false;
    this._chartFailed = false;
    this._listCollapsed = false;
    this._gen = 0;
    /** Optional preloaded payload (used by compact mode for its dialog instance). */
    this.preloadedData = null;
    this.ready = Promise.resolve();
  }

  // ── attributes ───────────────────────────────────────────────────────
  get labels() {
    let extra = {};
    const raw = this.getAttribute('labels');
    if (raw) { try { const o = JSON.parse(raw); if (o && typeof o === 'object') extra = o; } catch { /* ignore invalid JSON */ } }
    return { ...DEFAULT_LABELS, ...extra };
  }
  get mode() { return this.getAttribute('mode') === 'compact' ? 'compact' : 'full'; }
  get initial() {
    const n = parseInt(this.getAttribute('initial') ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_N;
  }
  get heading() { return this.getAttribute('data-soog-title') || this.labels.title; }

  /** Public read-only view of the state (handy for hosts and tests). */
  get state() {
    return { query: this._query, tab: this._tab, selectedKey: this._focusKey, compare: [...this._selected] };
  }

  attributeChangedCallback(name, oldV, newV) {
    if (name === 'title' && newV != null) {
      // keep the heading but drop the native tooltip over the whole element
      this.setAttribute('data-soog-title', newV);
      this.removeAttribute('title');
      return;
    }
    if (name === 'title') return;
    if (this.isConnected && this._connected && oldV !== newV) this._scheduleLoad();
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._connected = true;
    this._syncScheme();
    this._watchTheme();
    this._scheduleLoad(true);
  }

  disconnectedCallback() {
    this._connected = false;
    this._destroyCharts();
    this._closeLightbox(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    if (this._mq && this._mqHandler) { this._mq.removeEventListener?.('change', this._mqHandler); this._mq = null; }
  }

  _scheduleLoad(now) {
    if (now) { this.ready = this._load(); return; }
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => { this._pending = false; if (this._connected) this.ready = this._load(); });
  }

  // ── theme ────────────────────────────────────────────────────────────
  _win() { return this.ownerDocument.defaultView || globalThis.window; }
  _reducedMotion() {
    const mq = this._win().matchMedia?.('(prefers-reduced-motion: reduce)');
    return !!(mq && mq.matches);
  }
  _syncScheme() {
    const html = this.ownerDocument.documentElement;
    const theme = (html.getAttribute('data-theme') || '').toLowerCase();
    let dark;
    if (html.classList.contains('dark') || theme === 'dark') dark = true;
    else if (html.classList.contains('light') || theme === 'light') dark = false;
    else { const mq = this._win().matchMedia?.('(prefers-color-scheme: dark)'); dark = !!(mq && mq.matches); }
    const scheme = dark ? 'dark' : 'light';
    if (this.getAttribute('data-scheme') !== scheme) { this.setAttribute('data-scheme', scheme); return true; }
    return false;
  }
  _watchTheme() {
    const win = this._win();
    const onChange = () => { if (this._syncScheme() && this._registry.length) this._renderCharts(); };
    if (win.MutationObserver && !this._mo) {
      this._mo = new win.MutationObserver(onChange);
      this._mo.observe(this.ownerDocument.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    if (win.matchMedia && !this._mq) {
      this._mq = win.matchMedia('(prefers-color-scheme: dark)');
      this._mqHandler = onChange;
      this._mq.addEventListener?.('change', onChange);
    }
  }
  _theme() {
    const cs = this._win().getComputedStyle(this);
    const text = cs.color || '#2c2c2a';
    const m = text.match(/rgba?\(([^)]+)\)/);
    const muted = m ? `rgba(${m[1].split(',').slice(0, 3).join(',')},0.7)` : '#6b6b66';
    return { text, muted, grid: 'rgba(128,128,128,.22)' };
  }

  // ── DOM helpers (textContent only) ───────────────────────────────────
  _el(tag, cls, text) {
    const e = this.ownerDocument.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  _button(cls, text, role) {
    const b = this._el('button', cls, text);
    b.type = 'button';
    if (role) b.dataset.role = role;
    return b;
  }
  _reset() {
    this._destroyCharts();
    this._closeLightbox(false);
    const sr = this.shadowRoot;
    while (sr.firstChild) sr.removeChild(sr.firstChild);
    const style = this._el('style');
    style.textContent = STYLE;
    sr.appendChild(style);
    const root = this._el('div', `root ${this.mode}`);
    root.setAttribute('part', 'root');
    sr.appendChild(root);
    this._root = root;
    return root;
  }
  _message(root, text, error) {
    const m = this._el('div', error ? 'msg error' : 'msg', text);
    m.setAttribute('role', error ? 'alert' : 'status');
    root.appendChild(m);
    return m;
  }
  _active() { return this.shadowRoot ? this.shadowRoot.activeElement : null; }

  // ── data ─────────────────────────────────────────────────────────────
  async _load() {
    const gen = ++this._gen;
    // A previous load's chart failure must not stick around after a reload.
    this._chartFailed = false;
    this._parts = null;
    const L = this.labels;
    const root = this._reset();
    const src = this.getAttribute('src') ?? DEFAULT_SRC;
    const win = this._win();
    if (!isSameOriginPath(src, win && win.location ? win.location.href : undefined)) {
      root.appendChild(this._el('h2', null, this.heading));
      this._message(root, L.errorSrc, true);
      return;
    }
    let data = this.preloadedData;
    if (!data) {
      const status = this._message(root, L.loading, false);
      try {
        const res = await globalThis.fetch(src, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        if (!data || !Array.isArray(data.instruments)) throw new Error('unexpected payload');
      } catch (e) {
        if (gen !== this._gen) return;
        status.remove();
        root.appendChild(this._el('h2', null, this.heading));
        this._message(root, `${L.errorLoad} (${e && e.message ? e.message : 'error'})`, true);
        return;
      }
      if (gen !== this._gen) return;
      status.remove();
    }
    this._data = data;
    this._registry = data.instruments.map(toRecord);
    // duplicate ids would collide in the row map / selection set: suffix them
    const seen = new Set();
    for (const r of this._registry) {
      let k = r.key;
      for (let n = 2; seen.has(k); n++) k = `${r.key}~${n}`;
      r.key = k;
      seen.add(k);
    }
    // stable colour per instrument: its index in the full registry
    this._registry.forEach((r, i) => { r.color = PALETTE[i % PALETTE.length]; });
    const scored = this._registry.filter((r) => r.scored);
    this._selected = new Set(scored.slice(0, this.initial).map((r) => r.key));
    if (!this._registry.some((r) => r.key === this._focusKey)) this._focusKey = null;
    if (this.mode === 'compact') this._renderCompact(root); else this._renderFull(root);
    await this._renderCharts();
  }

  _record(key) { return this._registry.find((x) => x.key === key) || null; }
  _selectedRecords() { return this._registry.filter((r) => this._selected.has(r.key)); }
  _visibleRecords() { return this._registry.filter((r) => matchesQuery(r, this._query)); }

  // ── full mode ────────────────────────────────────────────────────────
  _renderFull(root) {
    const L = this.labels;
    const reg = this._registry;
    root.appendChild(this._el('h2', null, this.heading));
    root.appendChild(this._el('div', 'sub', L.subtitle));
    if (!reg.length) { this._message(root, L.empty, false); return; }

    const layout = this._el('div', 'layout');
    const side = this._renderSidebar();
    const main = this._el('div', 'main');

    // tabs
    const tablist = this._el('div', 'tablist');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', this.heading);
    const mkTab = (name, text) => {
      const t = this._button('tab', text, `tab-${name}`);
      t.id = `soog-tab-${name}`;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', `soog-panel-${name}`);
      t.addEventListener('click', () => this._setTab(name));
      return t;
    };
    const tabCompare = mkTab('compare', L.compareTab);
    const tabDetail = mkTab('detail', L.detailTab);
    tablist.append(tabCompare, tabDetail);
    tablist.addEventListener('keydown', (e) => {
      const order = ['compare', 'detail'];
      let i = order.indexOf(this._tab);
      if (e.key === 'ArrowRight') i = (i + 1) % order.length;
      else if (e.key === 'ArrowLeft') i = (i + order.length - 1) % order.length;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = order.length - 1;
      else return;
      e.preventDefault();
      this._setTab(order[i], true);
    });
    const mkPanel = (name) => {
      const p = this._el('section', 'panel');
      p.id = `soog-panel-${name}`;
      p.dataset.role = `panel-${name}`;
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', `soog-tab-${name}`);
      p.tabIndex = 0;
      return p;
    };
    const panelCompare = mkPanel('compare');
    const panelDetail = mkPanel('detail');
    main.append(tablist, panelCompare, panelDetail);
    layout.append(side, main);
    root.appendChild(layout);

    this._parts = { side, tabCompare, tabDetail, panelCompare, panelDetail };
    this._renderComparePanel(panelCompare);
    const detBody = this._el('div', 'detail');
    detBody.dataset.role = 'details';
    panelDetail.appendChild(detBody);
    this._parts.detBody = detBody;

    this._applyFilter();
    this._syncList();
    this._renderLegend();
    this._renderTable();
    this._renderDetails();
    this._setTab(this._tab, false, true);
  }

  _renderSidebar() {
    const L = this.labels;
    const side = this._el('aside', this._listCollapsed ? 'side collapsed' : 'side');
    side.setAttribute('aria-label', L.statInstruments);
    const sw = this._el('div', 'search-wrap');
    const input = this._el('input', 'search');
    input.type = 'search';
    input.placeholder = L.search;
    input.setAttribute('aria-label', L.search);
    input.setAttribute('aria-controls', 'soog-list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.dataset.role = 'search';
    input.value = this._query;
    input.addEventListener('input', () => this.setQuery(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this._focusRow(this._activeKey || (this._visibleRecords()[0] || {}).key); }
      // Esc clears the query without also closing a host overlay listening on window
      else if ((e.key === 'Escape' || e.key === 'Esc') && input.value) { e.preventDefault(); e.stopPropagation(); this.setQuery(''); }
    });
    const toggle = this._button('list-toggle', null, 'list-toggle');
    toggle.setAttribute('aria-controls', 'soog-list');
    toggle.setAttribute('aria-expanded', String(!this._listCollapsed));
    const tl = this._el('span');
    const chev = this._el('span', 'chev', '▾');
    chev.setAttribute('aria-hidden', 'true');
    toggle.append(tl, chev);
    toggle.addEventListener('click', () => {
      this._listCollapsed = !this._listCollapsed;
      side.classList.toggle('collapsed', this._listCollapsed);
      toggle.setAttribute('aria-expanded', String(!this._listCollapsed));
    });
    const live = this._el('div', 'sr-only');
    live.setAttribute('role', 'status');
    live.dataset.role = 'result-count';
    sw.append(input, toggle, live);

    const hint = this._el('p', 'sr-only', L.listHint);
    hint.id = 'soog-list-hint';
    const list = this._el('ul', 'list');
    list.id = 'soog-list';
    list.dataset.role = 'list';
    list.setAttribute('aria-label', L.statInstruments);
    list.setAttribute('aria-describedby', 'soog-list-hint');
    this._rowEls = new Map();
    for (const r of this._registry) list.appendChild(this._renderRow(r));
    const none = this._el('li', 'note', L.noResults);
    none.dataset.role = 'no-results';
    none.hidden = true;
    list.appendChild(none);
    list.addEventListener('keydown', (e) => this._onListKey(e));
    side.append(sw, hint, list);
    this._side = { input, toggle, toggleLabel: tl, live, list, none };
    return side;
  }

  _renderRow(r) {
    const L = this.labels;
    const li = this._el('li', 'item');
    li.dataset.key = r.key;
    const row = this._el('div', 'row');
    row.setAttribute('role', 'button');
    row.tabIndex = -1;
    row.dataset.role = 'row';
    const thumb = this._el('span', 'thumb');
    thumb.setAttribute('aria-hidden', 'true');
    const glyph = () => { thumb.replaceChildren(); thumb.textContent = '◇'; };
    if (r.img) {
      const img = this._el('img');
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.addEventListener('error', glyph, { once: true });
      img.src = r.img;
      thumb.appendChild(img);
    } else glyph();
    const txt = this._el('span', 'txt');
    const name = this._el('span', r.fictional ? 'name fict' : 'name', r.title);
    const metaBits = [r.year, r.family].filter(Boolean);
    if (!r.scored) metaBits.push(L.notScored);
    const meta = this._el('span', 'meta', metaBits.join(' · '));
    txt.append(name, meta);
    row.append(thumb, txt);
    row.addEventListener('click', () => this.select(r.key));

    const cmp = this._el('label', 'cmp');
    const cb = this._el('input');
    cb.type = 'checkbox';
    cb.tabIndex = -1;
    cb.dataset.role = 'compare';
    cb.setAttribute('aria-label', `${L.addToCompare}: ${r.title}`);
    cb.title = r.scored ? L.addToCompare : `${L.notScored}`;
    cb.disabled = !r.scored;
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => this.toggleCompare(r.key, cb.checked));
    const dot = this._el('span', 'swatch-dot');
    dot.setAttribute('aria-hidden', 'true');
    cmp.append(cb, dot);
    li.append(row, cmp);
    this._rowEls.set(r.key, { li, row, cb, dot });
    return li;
  }

  _onListKey(e) {
    if (e.target.dataset.role !== 'row') return;
    const vis = this._visibleRecords().map((r) => r.key);
    const key = e.target.closest('.item').dataset.key;
    let i = vis.indexOf(key);
    switch (e.key) {
      case 'ArrowDown': i = Math.min(vis.length - 1, i + 1); break;
      case 'ArrowUp':
        if (i <= 0) { e.preventDefault(); this._side.input.focus(); return; }
        i -= 1; break;
      case 'Home': i = 0; break;
      case 'End': i = vis.length - 1; break;
      case 'Enter': e.preventDefault(); this.select(key); return;
      case ' ': case 'Spacebar': {
        e.preventDefault();
        if (this._record(key) && this._record(key).scored) this.toggleCompare(key);
        return;
      }
      default: return;
    }
    e.preventDefault();
    if (vis[i]) this._focusRow(vis[i]);
  }

  _focusRow(key) {
    if (!key || !this._rowEls || !this._rowEls.has(key)) return;
    this._activeKey = key;
    this._syncRoving();
    this._rowEls.get(key).row.focus();
  }

  _syncRoving() {
    if (!this._rowEls) return;
    const vis = new Set(this._visibleRecords().map((r) => r.key));
    if (!vis.has(this._activeKey)) this._activeKey = vis.has(this._focusKey) ? this._focusKey : ([...vis][0] || null);
    for (const [key, { row }] of this._rowEls) row.tabIndex = key === this._activeKey ? 0 : -1;
  }

  /** Live filter (title, family, person, authors, year, tags; accent-insensitive). */
  setQuery(q) {
    this._query = str(q);
    if (this._side && this._side.input.value !== this._query) this._side.input.value = this._query;
    this._applyFilter();
  }

  _applyFilter() {
    if (!this._rowEls) return;
    const L = this.labels;
    let n = 0;
    for (const r of this._registry) {
      const ok = matchesQuery(r, this._query);
      this._rowEls.get(r.key).li.hidden = !ok;
      if (ok) n++;
    }
    this._side.none.hidden = n > 0;
    this._side.live.textContent = n ? `${n} ${L.instruments}` : L.noResults;
    this._side.toggleLabel.textContent = `${L.statInstruments} (${n})`;
    this._syncRoving();
  }

  _syncList() {
    if (!this._rowEls) return;
    for (const [key, { row, cb, dot }] of this._rowEls) {
      const on = this._selected.has(key);
      cb.checked = on;
      const r = this._record(key);
      dot.style.background = on && r ? r.color : 'transparent';
      if (key === this._focusKey) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    }
  }

  _setTab(name, focus, initial) {
    const p = this._parts;
    if (!p || !p.tabCompare) return;
    this._tab = name === 'detail' ? 'detail' : 'compare';
    const isC = this._tab === 'compare';
    for (const [tab, panel, on] of [[p.tabCompare, p.panelCompare, isC], [p.tabDetail, p.panelDetail, !isC]]) {
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    if (focus) (isC ? p.tabCompare : p.tabDetail).focus();
    // charts drawn in a hidden panel have no size: redraw on show
    if (!initial) this._renderCharts(this._tab);
  }

  /** Select an instrument (sidebar row) and open the Detail tab. */
  select(key, { openDetail = true } = {}) {
    if (!this._record(key)) return;
    this._focusKey = key;
    if (matchesQuery(this._record(key), this._query)) this._activeKey = key;
    this._syncRoving();
    this._syncList();
    this._renderDetails();
    if (openDetail && this._parts && this._parts.tabDetail) this._setTab('detail');
    else if (this._tab === 'detail') this._renderCharts('detail');
    else this._destroyCharts('detail'); // canvas replaced; drawn when the Detail tab is shown
  }

  /** Add/remove an instrument to/from the comparison (scored only). */
  toggleCompare(key, force) {
    const r = this._record(key);
    if (!r || !r.scored) return;
    const on = force == null ? !this._selected.has(key) : !!force;
    if (on) this._selected.add(key); else this._selected.delete(key);
    this._update();
  }

  _renderComparePanel(panel) {
    const L = this.labels;
    const reg = this._registry;
    const scored = reg.filter((r) => r.scored);
    const unscored = reg.filter((r) => !r.scored);

    const cards = this._el('div', 'cards');
    for (const [val, lbl, role] of [[reg.length, L.statInstruments, 'stat-instruments'], [scored.length, L.statScored, 'stat-scored'], [reg.filter((r) => r.fictional).length, L.statFictional, 'stat-fictional']]) {
      const c = this._el('div', 'card');
      const v = this._el('div', 'card-val', String(val));
      v.dataset.role = role;
      c.append(v, this._el('div', 'card-lbl', lbl));
      cards.appendChild(c);
    }
    panel.appendChild(cards);

    const cmp = this._el('section', 'section');
    const head = this._el('div', 'controls');
    const lab = this._el('h3', 'label grow', L.compareHeading);
    lab.style.margin = '0';
    const all = this._button('btn', L.selectAll, 'select-all');
    const none = this._button('btn', L.clear, 'clear');
    const tbtn = this._button('btn', L.table, 'table-toggle');
    tbtn.setAttribute('aria-pressed', String(this._showTable));
    head.append(lab, all, none, tbtn);
    cmp.appendChild(head);
    all.addEventListener('click', () => { scored.forEach((r) => this._selected.add(r.key)); this._update(); });
    none.addEventListener('click', () => { this._selected.clear(); this._update(); });

    const row = this._el('div', 'compare');
    const left = this._el('div');
    left.appendChild(this._el('div', 'chart-title', L.moaieHeading));
    const w1 = this._el('div', 'radar');
    const c1 = this._canvas(L.moaieAria, 'moaie-radar');
    w1.appendChild(c1);
    left.appendChild(w1);
    const right = this._el('div');
    right.appendChild(this._el('div', 'chart-title', L.profileHeading));
    const w2 = this._el('div', 'radar profile');
    const c2 = this._canvas(L.profileAria, 'profile-radar');
    w2.appendChild(c2);
    const pnote = this._el('p', 'note', L.noProfile);
    pnote.hidden = true;
    right.append(w2, pnote);
    row.append(left, right);
    cmp.appendChild(row);

    const tableWrap = this._el('div', 'table-wrap');
    tableWrap.id = 'soog-table';
    tableWrap.hidden = !this._showTable;
    tbtn.setAttribute('aria-controls', 'soog-table');
    tbtn.addEventListener('click', () => {
      this._showTable = !this._showTable;
      tbtn.setAttribute('aria-pressed', String(this._showTable));
      tableWrap.hidden = !this._showTable;
    });
    cmp.appendChild(tableWrap);
    const legend = this._el('div', 'legend');
    cmp.appendChild(legend);
    panel.appendChild(cmp);

    if (unscored.length) {
      const us = this._el('section', 'section');
      us.dataset.role = 'unscored';
      us.appendChild(this._el('h3', 'label', `${L.unscoredHeading} (${unscored.length})`));
      const ul = this._el('ul', 'unscored');
      for (const r of unscored) ul.appendChild(this._el('li', null, r.title));
      us.appendChild(ul);
      panel.appendChild(us);
    }
    Object.assign(this._parts, { c1, c2, w2, pnote, tableWrap, tbtn, legend });
  }

  _canvas(aria, role) {
    const c = this._el('canvas');
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', aria);
    c.dataset.role = role;
    return c;
  }

  _update() {
    this._syncList();
    this._renderLegend();
    this._renderTable();
    this._renderCharts('compare');
  }

  _renderLegend() {
    const legend = this._parts && this._parts.legend;
    if (!legend) return;
    const L = this.labels;
    legend.replaceChildren();
    const sel = this._selectedRecords();
    if (!sel.length) { legend.appendChild(this._el('div', 'note', L.noSelection)); return; }
    sel.forEach((r) => legend.appendChild(this._legendRow(r, this.mode !== 'compact')));
  }

  _legendRow(r, verbose) {
    const L = this.labels;
    const rowEl = this._el('div', 'legend-row');
    const sw = this._el('span', 'swatch');
    sw.style.background = r.color;
    sw.setAttribute('aria-hidden', 'true');
    const box = this._el('div');
    box.appendChild(this._el('strong', null, r.title));
    const meta = [r.year, r.person].filter(Boolean).join(' · ');
    if (meta) box.appendChild(this._el('span', 'note', ` · ${meta}`));
    if (verbose) {
      box.appendChild(this._el('br'));
      const bits = [`[${r.vector.map((x) => x.toFixed(2)).join(', ')}]`];
      if (r.layer) bits.push(r.layer);
      bits.push(`${L.recursive.toLowerCase()} ${r.recursive ? L.yes : L.no}`);
      if (r.family) bits.push(r.family);
      if (r.sh) bits.push(`SH ${r.sh}`);
      box.appendChild(this._el('span', 'legend-vec', bits.join(' · ')));
    }
    rowEl.append(sw, box);
    return rowEl;
  }

  _renderTable() {
    const wrap = this._parts && this._parts.tableWrap;
    if (!wrap) return;
    const L = this.labels;
    wrap.replaceChildren();
    const t = this._el('table');
    t.appendChild(this._el('caption', null, L.tableCaption));
    const thead = this._el('thead');
    const hr = this._el('tr');
    const th0 = this._el('th', null, L.instrument);
    th0.scope = 'col';
    hr.appendChild(th0);
    for (const a of AXIS) {
      const th = this._el('th', null, a);
      th.scope = 'col';
      th.setAttribute('abbr', (L.axisNames && L.axisNames[a]) || a);
      th.title = (L.axisNames && L.axisNames[a]) || a;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    t.appendChild(thead);
    const tb = this._el('tbody');
    const sel = this._selectedRecords();
    for (const r of sel) {
      const tr = this._el('tr');
      const th = this._el('th', null, r.title);
      th.scope = 'row';
      th.style.fontWeight = '500';
      tr.appendChild(th);
      for (const x of r.vector) tr.appendChild(this._el('td', null, x.toFixed(2)));
      tb.appendChild(tr);
    }
    if (!sel.length) {
      const tr = this._el('tr');
      const td = this._el('td', null, L.noSelection);
      td.colSpan = 6;
      tr.appendChild(td);
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
  }

  // ── detail ───────────────────────────────────────────────────────────
  _renderDetails() {
    const body = this._parts && this._parts.detBody;
    if (!body) return;
    const L = this.labels;
    body.replaceChildren();
    this._parts.c3 = null;
    const r = this._record(this._focusKey);
    if (!r) { body.appendChild(this._el('p', 'note', L.selectInstrument)); return; }

    const h = this._el('h3', null, r.title);
    if (r.fictional) h.appendChild(this._el('span', 'badge', L.fictional));
    body.appendChild(h);

    const top = this._el('div', r.img ? 'detail-top' : 'detail-top noimg');
    if (r.img) {
      const btn = this._button('img-btn', null, 'open-image');
      btn.setAttribute('aria-label', `${L.openImage}: ${r.title}`);
      btn.setAttribute('aria-haspopup', 'dialog');
      const img = this._el('img');
      img.alt = r.title;
      img.setAttribute('decoding', 'async');
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.addEventListener('error', () => { btn.remove(); top.className = 'detail-top noimg'; }, { once: true });
      img.src = r.img;
      const hint = this._el('span', 'hint', '⤢');
      hint.setAttribute('aria-hidden', 'true');
      btn.append(img, hint);
      btn.addEventListener('click', () => this.openLightbox(btn));
      top.appendChild(btn);
    }
    const info = this._el('div', 'info');
    const dl = this._el('dl');
    const add = (k, v) => { if (!v) return; dl.append(this._el('dt', null, k), this._el('dd', null, v)); };
    add(L.year, r.year);
    add(L.family, r.family);
    add(L.layer, r.layer);
    add(L.sachsHornbostel, r.sh);
    add(L.person, r.person);
    add(L.authors, r.authors.join(', '));
    add('MOAIE', r.vector ? `[${r.vector.map((x) => x.toFixed(2)).join(', ')}]` : L.notScored);
    add(L.recursive, r.recursive ? L.yes : L.no);
    if (r.url) {
      const a = this._el('a', null, r.url.replace(/^https:\/\//i, '').replace(/\/$/, ''));
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const dd = this._el('dd');
      dd.appendChild(a);
      dl.append(this._el('dt', null, L.link), dd);
    }
    info.appendChild(dl);
    if (r.tags.length) {
      const tg = this._el('div', 'tags');
      tg.dataset.role = 'tags';
      tg.setAttribute('aria-label', L.tags);
      tg.setAttribute('role', 'group');
      for (const t of r.tags) tg.appendChild(this._el('span', 'tag chip', t));
      info.appendChild(tg);
    }
    top.appendChild(info);
    body.appendChild(top);

    const texts = AXIS.filter((k) => typeof r.text[k] === 'string' && r.text[k].trim());
    if (texts.length || r.vector) {
      body.appendChild(this._el('h4', null, 'MOAIE'));
      const mo = this._el('div', r.vector ? 'detail-moaie' : 'detail-moaie novec');
      const tx = this._el('div', 'moaie-text');
      for (const k of texts) {
        const p = this._el('p');
        p.appendChild(this._el('b', null, `${k} · ${(L.axisNames && L.axisNames[k]) || k}: `));
        p.appendChild(this.ownerDocument.createTextNode(r.text[k]));
        tx.appendChild(p);
      }
      mo.appendChild(tx);
      if (r.vector) {
        const w = this._el('div', 'radar detail');
        const c3 = this._canvas(L.detailAria, 'detail-radar');
        w.appendChild(c3);
        mo.appendChild(w);
        this._parts.c3 = c3;
        this._parts.w3 = w;
      }
      body.appendChild(mo);
    }

    for (const [label, list, role] of [[L.connect, r.connect, 'connect'], [L.hyper, r.hyper, 'hyper']]) {
      if (!list.length) continue;
      body.appendChild(this._el('h4', null, label));
      const box = this._el('div');
      box.dataset.role = role;
      for (const n of list) box.appendChild(this._el('span', 'tag', n));
      body.appendChild(box);
    }

    if (r.videos.length) {
      body.appendChild(this._el('h4', null, L.videos));
      const grid = this._el('div', 'videos');
      grid.dataset.role = 'videos';
      r.videos.forEach((v, i) => grid.appendChild(this._videoTile(r, v, i)));
      body.appendChild(grid);
    }
  }

  _videoTile(r, v, i) {
    const L = this.labels;
    const prov = v.provider === 'youtube' ? 'YouTube' : 'Vimeo';
    const box = this._el('div', 'video');
    const tile = this._button('video-tile', null, 'video-tile');
    tile.dataset.provider = v.provider;
    tile.setAttribute('aria-label', `${L.playVideo}: ${r.title}${r.videos.length > 1 ? ` (${i + 1})` : ''} — ${prov}`);
    // Neutral local tile for every provider: no third-party request before the click.
    const cap = this._el('span', 'cap', r.videos.length > 1 ? `${r.title} · ${i + 1}` : r.title);
    cap.setAttribute('aria-hidden', 'true');
    tile.appendChild(cap);
    const play = this._el('span', 'play', '▶');
    play.setAttribute('aria-hidden', 'true');
    const label = this._el('span', 'prov', prov);
    label.setAttribute('aria-hidden', 'true');
    tile.append(play, label);
    tile.addEventListener('click', () => {
      const f = this._el('iframe');
      f.src = videoEmbedUrl(v);
      f.title = `${r.title} — ${prov}`;
      f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
      f.dataset.role = 'video-frame';
      tile.replaceWith(f);
      try { f.focus(); } catch { /* ignore */ }
    });
    box.appendChild(tile);
    return box;
  }

  // ── lightbox ─────────────────────────────────────────────────────────
  /** Full-screen image viewer with zoom/pan; focus is trapped and restored. */
  openLightbox(opener) {
    const r = this._record(this._focusKey);
    if (!r || !r.img || this._lb) return;
    const L = this.labels;
    const dlg = this._el('dialog', 'lightbox');
    dlg.dataset.role = 'lightbox';
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', r.title);
    const bar = this._el('div', 'lb-bar');
    const zOut = this._button('lb-btn', '−', 'zoom-out');
    zOut.setAttribute('aria-label', L.zoomOut);
    zOut.title = L.zoomOut;
    const zIn = this._button('lb-btn', '+', 'zoom-in');
    zIn.setAttribute('aria-label', L.zoomIn);
    zIn.title = L.zoomIn;
    const close = this._button('lb-btn', '×', 'lightbox-close');
    close.setAttribute('aria-label', L.close);
    close.title = L.close;
    bar.append(zOut, zIn, close);
    const stage = this._el('div', 'lb-stage');
    const img = this._el('img', 'lb-img');
    img.alt = r.title;
    img.draggable = false;
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.src = r.img;
    stage.appendChild(img);
    const cap = this._el('div', 'lb-caption', r.title);
    cap.setAttribute('aria-hidden', 'true');
    dlg.append(stage, bar, cap);
    this._root.appendChild(dlg);

    const z = { s: 1, x: 0, y: 0 };
    const lb = { dlg, img, stage, zIn, zOut, close, z, opener: opener || this._active(), pointers: new Map() };
    this._lb = lb;

    const apply = () => {
      const w = stage.clientWidth || 0;
      const h = stage.clientHeight || 0;
      const iw = img.offsetWidth || w;
      const ih = img.offsetHeight || h;
      const mx = Math.max(0, (iw * z.s - w) / 2);
      const my = Math.max(0, (ih * z.s - h) / 2);
      if (z.s <= ZOOM_MIN) { z.x = 0; z.y = 0; } else { z.x = clamp(z.x, -mx, mx); z.y = clamp(z.y, -my, my); }
      img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
      dlg.dataset.scale = String(Math.round(z.s * 100) / 100);
      stage.classList.toggle('zoomed', z.s > ZOOM_MIN);
      zOut.disabled = z.s <= ZOOM_MIN;
      zIn.disabled = z.s >= ZOOM_MAX;
    };
    // zoom so that the stage point (px, py) — relative to the stage centre — stays put
    const zoomAt = (ns, px = 0, py = 0) => {
      ns = clamp(ns, ZOOM_MIN, ZOOM_MAX);
      const k = ns / z.s;
      z.x = px - (px - z.x) * k;
      z.y = py - (py - z.y) * k;
      z.s = ns;
      apply();
    };
    const rel = (cx, cy) => {
      const b = stage.getBoundingClientRect();
      return [cx - (b.left + b.width / 2), cy - (b.top + b.height / 2)];
    };
    lb.zoomAt = zoomAt;

    zIn.addEventListener('click', () => zoomAt(z.s * 1.5));
    zOut.addEventListener('click', () => zoomAt(z.s / 1.5));
    close.addEventListener('click', () => this._closeLightbox(true));
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = rel(e.clientX, e.clientY);
      zoomAt(z.s * Math.exp(-clamp(e.deltaY, -100, 100) * 0.0035), px, py);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
      const [px, py] = rel(e.clientX, e.clientY);
      if (z.s > ZOOM_MIN) zoomAt(ZOOM_MIN); else zoomAt(2.5, px, py);
    });
    // click on the dark area (not the image) at 1× closes
    stage.addEventListener('click', (e) => { if (e.target === stage && z.s <= ZOOM_MIN && !lb.moved) this._closeLightbox(true); });
    // pointer: one finger/mouse pans when zoomed, two fingers pinch
    const P = lb.pointers;
    let pinch = null;
    let last = null;
    stage.addEventListener('pointerdown', (e) => {
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      lb.moved = false;
      if (P.size === 2) {
        const [a, b] = [...P.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: z.s };
      } else last = { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!P.has(e.pointerId)) return;
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (P.size >= 2 && pinch) {
        const [a, b] = [...P.values()];
        const [px, py] = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), px, py);
        lb.moved = true;
      } else if (last && z.s > ZOOM_MIN) {
        z.x += e.clientX - last.x;
        z.y += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        stage.classList.add('panning');
        lb.moved = true;
        apply();
      }
    });
    const up = (e) => {
      P.delete(e.pointerId);
      if (P.size < 2) pinch = null;
      if (P.size === 1) { const [p] = [...P.values()]; last = { x: p.x, y: p.y }; } else last = null;
      if (!P.size) stage.classList.remove('panning');
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        // keep host overlays (e.g. a full-screen pod closing on Esc) open
        e.preventDefault();
        e.stopPropagation();
        this._closeLightbox(true);
      } else if (e.key === 'Tab') {
        const f = [zOut, zIn, close].filter((b) => !b.disabled);
        const i = f.indexOf(this._active());
        e.preventDefault();
        const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === -1 || i === f.length - 1 ? 0 : i + 1);
        f[n].focus();
      } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(z.s * 1.5); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(z.s / 1.5); }
      else if (e.key === '0') { e.preventDefault(); zoomAt(ZOOM_MIN); }
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); this._closeLightbox(true); });
    // closed some other way (e.g. Android back without a cancel event): clean up so it can reopen
    dlg.addEventListener('close', () => { if (this._lb === lb) this._closeLightbox(false); });

    if (typeof dlg.showModal === 'function') {
      try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    } else dlg.setAttribute('open', '');
    img.addEventListener('load', apply);
    apply();
    close.focus();
  }

  _closeLightbox(restore) {
    const lb = this._lb;
    if (!lb) return;
    this._lb = null;
    try { if (typeof lb.dlg.close === 'function' && lb.dlg.open) lb.dlg.close(); } catch { /* ignore */ }
    lb.dlg.remove();
    if (restore && lb.opener && lb.opener.isConnected && typeof lb.opener.focus === 'function') lb.opener.focus();
  }

  // ── compact mode ─────────────────────────────────────────────────────
  _renderCompact(root) {
    const L = this.labels;
    const reg = this._registry;
    const scored = reg.filter((r) => r.scored);
    root.appendChild(this._el('h2', null, this.heading));
    // With no scored instruments there is nothing to plot: show the message.
    if (!scored.length) { this._parts = null; this._message(root, L.empty, false); return; }
    const w = this._el('div', 'radar small');
    const c1 = this._canvas(L.moaieAria, 'moaie-radar');
    w.appendChild(c1);
    root.appendChild(w);
    const count = this._el('div', 'count', `${reg.length} ${L.instruments} · ${scored.length} ${L.scored}`);
    count.dataset.role = 'count';
    root.appendChild(count);
    const legend = this._el('div', 'legend');
    this._selectedRecords().forEach((r) => legend.appendChild(this._legendRow(r, false)));
    root.appendChild(legend);

    const btn = this._button('btn open', L.openDashboard, 'open');
    btn.setAttribute('aria-haspopup', 'dialog');
    root.appendChild(btn);

    const dlg = this._el('dialog', 'full-dialog');
    dlg.setAttribute('aria-label', this.heading);
    const bar = this._el('div', 'dialog-bar');
    const close = this._button('btn', L.close, 'close');
    bar.appendChild(close);
    const body = this._el('div', 'dialog-body');
    dlg.append(bar, body);
    root.appendChild(dlg);

    close.addEventListener('click', () => this._closeDialog(dlg));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this._closeDialog(dlg); });
    dlg.addEventListener('close', () => { btn.focus(); });
    btn.addEventListener('click', () => {
      if (!body.firstChild) {
        const full = this.ownerDocument.createElement('soog-dashboard');
        for (const a of ['src', 'initial', 'labels', 'data-soog-title']) { const v = this.getAttribute(a); if (v != null) full.setAttribute(a, v); }
        full.setAttribute('mode', 'full');
        full.preloadedData = this._data;
        body.appendChild(full);
      }
      if (typeof dlg.showModal === 'function') {
        try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
      } else dlg.setAttribute('open', '');
      close.focus();
    });
    this._parts = { c1, dialog: dlg, open: btn };
  }

  _closeDialog(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else { dlg.removeAttribute('open'); dlg.dispatchEvent(new Event('close')); }
  }

  // ── charts ───────────────────────────────────────────────────────────
  /** Destroy charts of one scope ('compare' | 'detail') or all of them. */
  _destroyCharts(scope = 'all') {
    const keep = [];
    for (const c of this._charts) {
      if (scope !== 'all' && c.__soogScope !== scope) { keep.push(c); continue; }
      try { c.destroy(); } catch { /* ignore */ }
    }
    this._charts = keep;
  }
  _addChart(Chart, canvas, config, scope) {
    const c = new Chart(canvas, config);
    c.__soogScope = scope;
    this._charts.push(c);
  }

  _radarOpts(t, legend, small) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: this._reducedMotion() ? false : { duration: 250 },
      plugins: {
        legend: legend ? { display: true, position: 'bottom', labels: { font: { size: 11 }, color: t.text, boxWidth: 12, padding: 14 } } : { display: false },
      },
      scales: {
        r: {
          min: 0, max: 1,
          ticks: { stepSize: 0.25, font: { size: 9 }, backdropColor: 'transparent', color: t.muted, display: !small, callback: (v) => String(Math.round(v * 100) / 100) },
          grid: { color: t.grid },
          angleLines: { color: t.grid },
          pointLabels: { font: { size: small ? 11 : 12, weight: '500' }, color: t.text },
        },
      },
    };
  }

  _ds(r) {
    const c = r.color;
    return { label: r.title, fill: true, backgroundColor: rgba(c, 0.12), borderColor: c, borderWidth: 1.5, pointBackgroundColor: c, pointRadius: 2.5 };
  }

  /**
   * scope 'all' (load, theme change), 'compare' (compare set changed / tab
   * shown) or 'detail' (selected instrument changed / tab shown): only the
   * charts of that scope are rebuilt.
   */
  async _renderCharts(scope = 'all') {
    const parts = this._parts;
    if (!parts || !parts.c1) return;
    let Chart;
    try {
      Chart = await loadChart(this._win());
    } catch {
      if (parts !== this._parts) return;
      if (parts.w3) parts.w3.hidden = true;
      if (!this._chartFailed) {
        this._chartFailed = true;
        // message where the radars would be; hide the empty canvases
        const anchor = parts.c1.closest('.compare') || parts.c1.parentElement;
        const msg = this._el('div', 'msg error', parts.tableWrap ? this.labels.errorChart : this.labels.errorChartShort);
        msg.setAttribute('role', 'alert');
        msg.dataset.role = 'chart-error';
        anchor.parentNode.insertBefore(msg, anchor);
        anchor.hidden = true;
        if (parts.tableWrap && !this._showTable) parts.tbtn.click();
      }
      return;
    }
    if (!this._connected || parts !== this._parts) return;
    this._destroyCharts(scope);
    const t = this._theme();
    if (scope !== 'detail') this._renderCompareCharts(Chart, parts, t);
    if (scope !== 'compare') this._renderDetailChart(Chart, parts, t);
  }

  _renderCompareCharts(Chart, parts, t) {
    const sel = this._selectedRecords();
    const small = this.mode === 'compact';
    this._addChart(Chart, parts.c1, {
      type: 'radar',
      data: { labels: AXIS, datasets: sel.map((r) => ({ ...this._ds(r), data: r.vector })) },
      options: this._radarOpts(t, false, small),
    }, 'compare');
    if (parts.c2) {
      const withP = sel.filter((r) => r.profile);
      parts.w2.hidden = !withP.length;
      parts.pnote.hidden = !!withP.length;
      const L = this.labels;
      const pl = Array.isArray(L.profileLabels) && L.profileLabels.length === 10 ? L.profileLabels : DEFAULT_LABELS.profileLabels;
      if (withP.length) {
        this._addChart(Chart, parts.c2, {
          type: 'radar',
          data: { labels: pl, datasets: withP.map((r) => ({ ...this._ds(r), data: r.profile })) },
          options: this._radarOpts(t, true, false),
        }, 'compare');
      }
    }
  }

  _renderDetailChart(Chart, parts, t) {
    const fr = this._record(this._focusKey);
    if (parts.c3 && parts.c3.isConnected && fr && fr.vector) {
      this._addChart(Chart, parts.c3, {
        type: 'radar',
        data: { labels: AXIS, datasets: [{ ...this._ds(fr), data: fr.vector }] },
        options: this._radarOpts(t, false, true),
      }, 'detail');
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('soog-dashboard')) {
  customElements.define('soog-dashboard', SoogDashboard);
}
