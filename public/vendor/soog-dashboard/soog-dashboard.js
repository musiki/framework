/*!
 * soog-dashboard 0.1.0
 * SOOG_DASHBOARD_VERSION = '0.1.0'
 *
 * <soog-dashboard> — framework-free custom element showing the SOOG / MOAIE
 * dashboard (instrument chips, MOAIE radar, interface-profile radar,
 * instrument details, table view), fed live from a same-origin JSON endpoint
 * shaped `{ generatedAt, instruments: PublicInstrument[] }`.
 *
 * Ported from the first dataviewjs block of the Obsidian `soog-dashboard.md`
 * (palette, axis/profile labels, radar options, DEFAULT_N = 4). No build step:
 * plain ESM, safe to vendor as a single file.
 *
 * Attributes
 *   src      same-origin path ("/..." but not "//..."), default /api/public/instruments
 *   title    heading (moved to data-soog-title on connect to avoid the native tooltip)
 *   initial  number of preselected scored instruments, default 4
 *   mode     "full" (default) | "compact"
 *   labels   JSON object overriding UI strings (see DEFAULT_LABELS)
 */

export const SOOG_DASHBOARD_VERSION = '0.1.0';
export const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
export const DEFAULT_SRC = '/api/public/instruments';
export const DEFAULT_N = 4;

export const AXIS = ['M', 'O', 'A', 'I', 'E'];
export const PROFILE_KEYS = ['affordance', 'liveness', 'playability', 'learnability', 'situatedness', 'mediality', 'mapping', 'sensorimotor_scheme', 'ergonomics', 'expressivity'];
export const PALETTE = ['#1D9E75', '#3266ad', '#A32D2D', '#7F77DD', '#EF9F27', '#2AACBB', '#D4602A', '#B2983E', '#8A8A9A', '#1C3C78', '#C0518A', '#5BA646'];

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
  link: 'Website',
  fictional: 'fictional',
  instruments: 'instruments',
  scored: 'scored',
  openDashboard: 'Open dashboard',
  close: 'Close',
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

/** Normalise one PublicInstrument from the endpoint into the internal record. */
export function toRecord(inst, index) {
  const m = inst && typeof inst.moaie === 'object' && inst.moaie ? inst.moaie : {};
  const v = Array.isArray(m.vector) && m.vector.length === 5 && m.vector.every((x) => typeof x === 'number' && Number.isFinite(x)) ? m.vector.slice() : null;
  const scored = !!v && !m.empty;
  const p = inst && inst.profile && typeof inst.profile === 'object' ? inst.profile : null;
  return {
    key: str(inst && inst.id) || `i${index}`,
    title: str(inst && inst.title) || '—',
    year: inst && inst.year != null && inst.year !== '' ? str(inst.year) : '',
    family: str(inst && inst.family),
    layer: str(inst && inst.layer),
    sh: str(inst && inst.sachsHornbostel),
    authors: Array.isArray(inst && inst.authors) ? inst.authors.map(str).filter(Boolean) : [],
    person: str(inst && inst.person),
    url: isHttps(inst && inst.url) ? inst.url : '',
    img: isHttps(inst && inst.img) ? inst.img : '',
    fictional: !!(inst && inst.fictional),
    recursive: !!m.recursive,
    text: m.text && typeof m.text === 'object' ? m.text : {},
    vector: scored ? v : null,
    scored,
    profile: p ? PROFILE_KEYS.map((k) => num(p[k])) : null,
    connect: Array.isArray(inst && inst.connect) ? inst.connect.map(str).filter(Boolean) : [],
  };
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
  --_border: var(--soog-border, var(--so-border, var(--c-border, color-mix(in srgb, currentColor 16%, transparent))));
  --_surface: var(--soog-surface, var(--so-surface, color-mix(in srgb, currentColor 4%, transparent)));
  --_button: color-mix(in srgb, currentColor 6%, transparent);
  --_muted: color-mix(in srgb, currentColor 66%, transparent);
  --_faint: color-mix(in srgb, currentColor 48%, transparent);
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
.root { max-width: 960px; margin: 0 auto; padding: .5rem 0; }
h2 { font-size: 1.15em; font-weight: 600; margin: 0 0 .2rem; color: inherit; }
.sub { font-size: .8em; color: var(--_muted); margin-bottom: 1.5rem; }
.section { margin: 1.5rem 0; }
.label { font-size: .7em; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--_muted); margin: 0 0 .6rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.card { background: var(--_surface); border: 1px solid var(--_border); border-radius: 8px; padding: .65rem .9rem; }
.card-val { font-size: 1.5em; font-weight: 500; }
.card-lbl { font-size: .75em; color: var(--_muted); margin-top: 2px; }
button { font: inherit; color: inherit; }
.btn { background: var(--_button); border: 1px solid var(--_border); border-radius: 8px; padding: 4px 12px; font-size: .8em; cursor: pointer; color: var(--_muted); transition: color .15s, border-color .15s, background .15s; }
.btn:hover, .btn[aria-pressed="true"] { color: var(--_fg); border-color: color-mix(in srgb, currentColor 34%, transparent); }
.btn:focus-visible, .chip:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 70%, transparent); outline-offset: 2px; }
.controls { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: .6rem; }
.chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 5px; }
.chip { display: flex; align-items: center; gap: 7px; padding: 5px 9px; border: 1px solid var(--_border); border-radius: 6px; cursor: pointer; font-size: .78em; color: var(--_muted); background: var(--_button); text-align: left; min-width: 0; transition: color .15s, border-color .15s, background .15s; }
.chip[aria-pressed="true"] { color: var(--_fg); background: var(--_surface); border-color: color-mix(in srgb, currentColor 34%, transparent); }
.chip.fictional { border-style: dashed; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; border: 1px solid var(--_border); }
.chip-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-meta { font-size: .85em; color: var(--_faint); }
.unscored { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; padding: 0; margin: 0; }
.unscored li, .tag { border: 1px dashed var(--_border); border-radius: 4px; padding: 1px 7px; font-size: .75em; color: var(--_muted); }
.tag { border-style: solid; background: var(--_button); display: inline-block; margin: 2px 4px 2px 0; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start; }
.chart-title { font-size: .7em; font-weight: 600; letter-spacing: .04em; color: var(--_faint); margin-bottom: .5rem; text-transform: uppercase; }
.radar { position: relative; height: 280px; }
.radar.profile { height: 360px; }
.radar.small { height: 190px; }
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
.details { display: grid; grid-template-columns: minmax(0, 160px) 1fr; gap: 1rem; align-items: start; background: var(--_surface); border: 1px solid var(--_border); border-radius: 8px; padding: .9rem 1rem; }
.details.noimg { grid-template-columns: 1fr; }
.details img { width: 100%; height: auto; border-radius: 6px; display: block; background: var(--_button); }
.details h3 { margin: 0 0 .35rem; font-size: 1em; font-weight: 600; }
.badge { font-size: .7em; font-weight: 500; border: 1px dashed var(--_border); border-radius: 4px; padding: 0 5px; margin-left: 6px; color: var(--_muted); vertical-align: 2px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; font-size: .8em; }
dt { color: var(--_faint); }
dd { margin: 0; overflow-wrap: anywhere; }
.moaie-text { margin-top: .6rem; font-size: .8em; }
.moaie-text p { margin: .2rem 0; }
.moaie-text b { font-weight: 600; }
a { color: inherit; text-underline-offset: 2px; }
.msg { border: 1px solid var(--_border); background: var(--_surface); color: var(--_muted); border-radius: 8px; padding: .75rem 1rem; font-size: .85em; }
.msg.error { border-color: color-mix(in srgb, #A32D2D 55%, transparent); }
.compact h2 { font-size: .95em; }
.compact .count { font-size: .78em; color: var(--_muted); margin: .4rem 0 .6rem; }
.compact .legend-row { font-size: .75em; margin: 3px 0; }
.compact .open { width: 100%; padding: 6px 10px; }
dialog { color: var(--_fg); background: var(--_bg); border: 1px solid var(--_border); border-radius: 10px; padding: 0; width: min(1040px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; }
dialog::backdrop { background: rgba(0, 0, 0, .45); }
.dialog-bar { position: sticky; top: 0; display: flex; justify-content: flex-end; padding: .5rem .75rem 0; background: var(--_bg); z-index: 1; }
.dialog-body { padding: 0 1.25rem 1rem; }
@container (max-width: 640px) {
  .compare { grid-template-columns: 1fr; }
  .details { grid-template-columns: 1fr; }
  .details img { max-width: 200px; }
  .chips { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
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
    this._showTable = false;
    this._chartFailed = false;
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
    const muted = m ? `rgba(${m[1].split(',').slice(0, 3).join(',')},0.65)` : '#888780';
    return { text, muted, grid: 'rgba(128,128,128,.22)' };
  }

  // ── DOM helpers (textContent only) ───────────────────────────────────
  _el(tag, cls, text) {
    const e = this.ownerDocument.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  _reset() {
    this._destroyCharts();
    const sr = this.shadowRoot;
    while (sr.firstChild) sr.removeChild(sr.firstChild);
    const style = this._el('style');
    style.textContent = STYLE;
    sr.appendChild(style);
    const root = this._el('div', `root ${this.mode}`);
    root.setAttribute('part', 'root');
    sr.appendChild(root);
    return root;
  }
  _message(root, text, error) {
    const m = this._el('div', error ? 'msg error' : 'msg', text);
    m.setAttribute('role', error ? 'alert' : 'status');
    root.appendChild(m);
    return m;
  }

  // ── data ─────────────────────────────────────────────────────────────
  async _load() {
    const gen = ++this._gen;
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
    // stable colour per instrument: its index in the full registry
    this._registry.forEach((r, i) => { r.color = PALETTE[i % PALETTE.length]; });
    const scored = this._registry.filter((r) => r.scored);
    this._selected = new Set(scored.slice(0, this.initial).map((r) => r.key));
    this._focusKey = [...this._selected].pop() || null;
    if (this.mode === 'compact') this._renderCompact(root); else this._renderFull(root);
    await this._renderCharts();
  }

  _selectedRecords() { return this._registry.filter((r) => this._selected.has(r.key)); }
  _colorOf(key) {
    if (!this._selected.has(key)) return null;
    const r = this._registry.find((x) => x.key === key);
    return r ? r.color : null;
  }

  // ── full mode ────────────────────────────────────────────────────────
  _renderFull(root) {
    const L = this.labels;
    const reg = this._registry;
    const scored = reg.filter((r) => r.scored);
    const unscored = reg.filter((r) => !r.scored);

    root.appendChild(this._el('h2', null, this.heading));
    root.appendChild(this._el('div', 'sub', L.subtitle));

    if (!reg.length) { this._message(root, L.empty, false); return; }

    const cards = this._el('div', 'cards');
    for (const [val, lbl, role] of [[reg.length, L.statInstruments, 'stat-instruments'], [scored.length, L.statScored, 'stat-scored'], [reg.filter((r) => r.fictional).length, L.statFictional, 'stat-fictional']]) {
      const c = this._el('div', 'card');
      const v = this._el('div', 'card-val', String(val));
      v.dataset.role = role;
      c.append(v, this._el('div', 'card-lbl', lbl));
      cards.appendChild(c);
    }
    root.appendChild(cards);

    // selection
    const sel = this._el('section', 'section');
    sel.appendChild(this._el('h3', 'label', L.selectHeading));
    const controls = this._el('div', 'controls');
    const all = this._el('button', 'btn', L.selectAll);
    all.type = 'button'; all.dataset.role = 'select-all';
    const none = this._el('button', 'btn', L.clear);
    none.type = 'button'; none.dataset.role = 'clear';
    controls.append(all, none);
    sel.appendChild(controls);
    const chips = this._el('div', 'chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', L.selectHeading);
    this._chipEls = new Map();
    for (const r of scored) {
      const b = this._el('button', r.fictional ? 'chip fictional' : 'chip');
      b.type = 'button';
      b.dataset.key = r.key;
      const dot = this._el('span', 'dot');
      dot.setAttribute('aria-hidden', 'true');
      const name = this._el('span', 'chip-name', r.title);
      b.append(dot, name);
      if (r.year) b.appendChild(this._el('span', 'chip-meta', r.year));
      if (r.fictional) b.setAttribute('aria-description', L.fictional);
      b.addEventListener('click', () => this._toggle(r.key));
      this._chipEls.set(r.key, b);
      chips.appendChild(b);
    }
    sel.appendChild(chips);
    all.addEventListener('click', () => { scored.forEach((r) => this._selected.add(r.key)); this._focusKey = [...this._selected].pop() || null; this._update(); });
    none.addEventListener('click', () => { this._selected.clear(); this._focusKey = null; this._update(); });
    root.appendChild(sel);

    if (unscored.length) {
      const us = this._el('section', 'section');
      us.dataset.role = 'unscored';
      us.appendChild(this._el('h3', 'label', `${L.unscoredHeading} (${unscored.length})`));
      const ul = this._el('ul', 'unscored');
      for (const r of unscored) ul.appendChild(this._el('li', null, r.title));
      us.appendChild(ul);
      root.appendChild(us);
    }

    // compare
    const cmp = this._el('section', 'section');
    const head = this._el('div', 'controls');
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'baseline';
    const lab = this._el('h3', 'label', L.compareHeading);
    lab.style.margin = '0';
    const tbtn = this._el('button', 'btn', L.table);
    tbtn.type = 'button';
    tbtn.dataset.role = 'table-toggle';
    tbtn.setAttribute('aria-pressed', String(this._showTable));
    head.append(lab, tbtn);
    cmp.appendChild(head);

    const row = this._el('div', 'compare');
    const left = this._el('div');
    left.appendChild(this._el('div', 'chart-title', L.moaieHeading));
    const w1 = this._el('div', 'radar');
    const c1 = this._el('canvas');
    c1.setAttribute('role', 'img');
    c1.setAttribute('aria-label', L.moaieAria);
    c1.dataset.role = 'moaie-radar';
    w1.appendChild(c1);
    left.appendChild(w1);
    const right = this._el('div');
    right.appendChild(this._el('div', 'chart-title', L.profileHeading));
    const w2 = this._el('div', 'radar profile');
    const c2 = this._el('canvas');
    c2.setAttribute('role', 'img');
    c2.setAttribute('aria-label', L.profileAria);
    c2.dataset.role = 'profile-radar';
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
    root.appendChild(cmp);

    const det = this._el('section', 'section');
    det.appendChild(this._el('h3', 'label', L.detailsHeading));
    const detBody = this._el('div');
    detBody.dataset.role = 'details';
    detBody.setAttribute('aria-live', 'polite');
    det.appendChild(detBody);
    root.appendChild(det);

    this._parts = { c1, c2, w2, pnote, tableWrap, tbtn, legend, detBody };
    this._syncChips();
    this._renderLegend();
    this._renderTable();
    this._renderDetails();
  }

  _toggle(key) {
    if (this._selected.has(key)) {
      this._selected.delete(key);
      if (this._focusKey === key) this._focusKey = [...this._selected].pop() || null;
    } else {
      this._selected.add(key);
      this._focusKey = key;
    }
    this._update();
  }

  _update() {
    this._syncChips();
    this._renderLegend();
    this._renderTable();
    this._renderDetails();
    this._renderCharts();
  }

  _syncChips() {
    if (!this._chipEls) return;
    for (const [key, b] of this._chipEls) {
      const on = this._selected.has(key);
      b.setAttribute('aria-pressed', String(on));
      const c = this._colorOf(key);
      b.querySelector('.dot').style.background = on && c ? c : 'transparent';
    }
  }

  _renderLegend() {
    const legend = this._parts && this._parts.legend;
    if (!legend) return;
    const L = this.labels;
    legend.replaceChildren();
    const sel = this._selectedRecords();
    if (!sel.length) { legend.appendChild(this._el('div', 'note', L.noSelection)); return; }
    sel.forEach((r, i) => legend.appendChild(this._legendRow(r, i, this.mode !== 'compact')));
  }

  _legendRow(r, i, verbose) {
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

  _renderDetails() {
    const body = this._parts && this._parts.detBody;
    if (!body) return;
    const L = this.labels;
    body.replaceChildren();
    const r = this._registry.find((x) => x.key === this._focusKey);
    if (!r) { body.appendChild(this._el('div', 'note', L.noSelection)); return; }
    const card = this._el('div', r.img ? 'details' : 'details noimg');
    if (r.img) {
      const img = this._el('img');
      img.src = r.img;
      img.alt = r.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => { img.remove(); card.className = 'details noimg'; });
      card.appendChild(img);
    }
    const info = this._el('div');
    const h = this._el('h3', null, r.title);
    const c = this._colorOf(r.key);
    if (c) { h.style.borderLeft = `3px solid ${c}`; h.style.paddingLeft = '8px'; }
    if (r.fictional) h.appendChild(this._el('span', 'badge', L.fictional));
    info.appendChild(h);
    const dl = this._el('dl');
    const add = (k, v) => { if (!v) return; dl.append(this._el('dt', null, k), this._el('dd', null, v)); };
    add(L.year, r.year);
    add(L.person, r.person);
    add(L.authors, r.authors.join(', '));
    add(L.family, r.family);
    add(L.layer, r.layer);
    add(L.sachsHornbostel, r.sh);
    add('MOAIE', r.vector ? `[${r.vector.map((x) => x.toFixed(2)).join(', ')}]` : '');
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
    const texts = AXIS.filter((k) => typeof r.text[k] === 'string' && r.text[k].trim());
    if (texts.length) {
      const tx = this._el('div', 'moaie-text');
      for (const k of texts) {
        const p = this._el('p');
        p.appendChild(this._el('b', null, `${k} · ${(L.axisNames && L.axisNames[k]) || k}: `));
        p.appendChild(this.ownerDocument.createTextNode(r.text[k]));
        tx.appendChild(p);
      }
      info.appendChild(tx);
    }
    if (r.connect.length) {
      const cn = this._el('div', 'moaie-text');
      cn.appendChild(this._el('div', 'chart-title', L.connect));
      for (const n of r.connect) cn.appendChild(this._el('span', 'tag', n));
      info.appendChild(cn);
    }
    card.appendChild(info);
    body.appendChild(card);
  }

  // ── compact mode ─────────────────────────────────────────────────────
  _renderCompact(root) {
    const L = this.labels;
    const reg = this._registry;
    const scored = reg.filter((r) => r.scored);
    root.appendChild(this._el('h2', null, this.heading));
    const w = this._el('div', 'radar small');
    const c1 = this._el('canvas');
    c1.setAttribute('role', 'img');
    c1.setAttribute('aria-label', L.moaieAria);
    c1.dataset.role = 'moaie-radar';
    w.appendChild(c1);
    root.appendChild(w);
    const count = this._el('div', 'count', `${reg.length} ${L.instruments} · ${scored.length} ${L.scored}`);
    count.dataset.role = 'count';
    root.appendChild(count);
    const legend = this._el('div', 'legend');
    this._selectedRecords().forEach((r, i) => legend.appendChild(this._legendRow(r, i, false)));
    root.appendChild(legend);

    const btn = this._el('button', 'btn open', L.openDashboard);
    btn.type = 'button';
    btn.dataset.role = 'open';
    btn.setAttribute('aria-haspopup', 'dialog');
    root.appendChild(btn);

    const dlg = this._el('dialog');
    dlg.setAttribute('aria-label', this.heading);
    const bar = this._el('div', 'dialog-bar');
    const close = this._el('button', 'btn', L.close);
    close.type = 'button';
    close.dataset.role = 'close';
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
  _destroyCharts() {
    for (const c of this._charts) { try { c.destroy(); } catch { /* ignore */ } }
    this._charts = [];
  }

  _radarOpts(t, legend, small) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
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
    return { label: r.title, fill: true, backgroundColor: rgba(c, 0.10), borderColor: c, borderWidth: 1.5, pointBackgroundColor: c, pointRadius: 2.5 };
  }

  async _renderCharts() {
    const parts = this._parts;
    if (!parts || !parts.c1) return;
    let Chart;
    try {
      Chart = await loadChart(this._win());
    } catch {
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
    this._destroyCharts();
    const t = this._theme();
    const sel = this._selectedRecords();
    const small = this.mode === 'compact';
    this._charts.push(new Chart(parts.c1, {
      type: 'radar',
      data: { labels: AXIS, datasets: sel.map((r) => ({ ...this._ds(r), data: r.vector })) },
      options: this._radarOpts(t, false, small),
    }));
    if (parts.c2) {
      const withP = sel.map((r, i) => ({ r, i })).filter((o) => o.r.profile);
      parts.w2.hidden = !withP.length;
      parts.pnote.hidden = !!withP.length;
      const L = this.labels;
      const pl = Array.isArray(L.profileLabels) && L.profileLabels.length === 10 ? L.profileLabels : DEFAULT_LABELS.profileLabels;
      if (withP.length) {
        this._charts.push(new Chart(parts.c2, {
          type: 'radar',
          data: { labels: pl, datasets: withP.map((o) => ({ ...this._ds(o.r), data: o.r.profile })) },
          options: this._radarOpts(t, true, false),
        }));
      }
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('soog-dashboard')) {
  customElements.define('soog-dashboard', SoogDashboard);
}
