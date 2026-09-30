// Concept graph (progressive enhancement; the page already lists every
// concept and relation). Same visual language as the MishMash Lab's
// concept-machine.js: labelled boxes in status colours, edge labels, force
// layout, drag. D3 is bundled (no CDN).
//
// Layout: nodes collide on their (folded) label box; every edge label is a
// small simulated node pulled to its link's midpoint and pushed away from the
// other labels and the concept boxes; labels that still overlap are hidden.
// Zoom is semantic above 1: positions scale, boxes and text keep their size,
// so zooming in makes room for full labels; below 1 everything shrinks
// together, so zooming out never makes boxes collide. Level of detail: folded node labels
// and no edge labels at low zoom; full labels on hover, on selection, at high
// zoom, or with the "show all labels" toggle (which lifts the zoom thresholds;
// edge labels that would sit on top of something are still left out).
//
// Typed relations (relation modeler): every relation is drawn with its type's
// encoding, the same one as the key under the graph (relation-type-ui.ts):
// - line types: slot colour + stroke pattern + an arrowhead per palette slot
//   (none for symmetric types); `double` is two parallel strokes. Lines end on
//   the concept boxes' borders; several relations between the same two
//   concepts sit side by side.
// - area types: a flat hull (straight sides, graph-layout.hullPolygon) around
//   the container and its members, in the slot's tint with a 2px border in the
//   slot colour and the label on a tab across its top edge; nested areas get
//   more padding; members are pulled together by a weak force.
// - inferred relations: thin and faint, labelled only when an end is the
//   selected concept, never votable.
// - agreement: line width from the net agreement (1–4px); contested
//   relations get a broken pattern and a small square at the middle.
// The type filter of the modeler table ('mm:relation-filter') hides every
// element of a type: lines, hit targets, markers, labels, areas.
//
// Accessibility: the SVG is decorative for assistive technology
// (aria-hidden, nothing focusable inside); the canvas element itself is one
// focusable group with keyboard shortcuts and a live status line, and the
// lists below the graph carry the same information. A small card (plain HTML,
// built with textContent, outside the SVG) shows the hovered or selected
// concept's status, a short excerpt of its definition and a link to it; while
// a concept is selected it is also the canvas's aria-describedby target. A
// second card does the same for a relation (hover, click, or E on the
// keyboard to step through the selected concept's relations): its sentence,
// the type, proposer, origin post, totals and — for members — the stance
// buttons with the blind-vote notice; names only after the reveal (the API
// decides), Settle for curators.

import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { select } from 'd3-selection';
import { drag } from 'd3-drag';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import {
  truncateLabel, hiddenByOverlap, fitTransform, linkDistance, levelOfDetail, boundsOf, clamp, placeCard, shouldDock,
  hullPolygon, hullLabelAnchor, areaGroups, areaPadding, agreementWidth, isContested, edgeDash, arrowMarker, relationSentence,
  clipToBox, offsetSegment, pairSlots, cycleIndex, type Box, type AreaGroup, type Point,
} from '../../lib/mm/graph-layout';
import {
  RELATION_FILTER_EVENT, dashArray, sampleSpec, strokeColor, svgAttrs, tintColor, typeLabel, typePath,
  type RelationFilterDetail, type TypeLike,
} from '../../lib/mm/relation-type-ui';
import { ApiFailure, errorText, mmApi, pageStrings } from './api';

// Type filter from the relation modeler table (relation-types.ts): the slugs
// whose relations are shown; null = all. Kept at module level so a state sent
// before the graph is drawn still applies.
let visibleTypes: Set<string> | null = null;
const filterListeners = new Set<() => void>();
document.addEventListener(RELATION_FILTER_EVENT, (event) => {
  const visible = (event as CustomEvent<RelationFilterDetail>).detail?.visible;
  visibleTypes = Array.isArray(visible) ? new Set(visible.map(String)) : null;
  filterListeners.forEach((fn) => fn());
});
const typeHidden = (type: string) => visibleTypes !== null && !visibleTypes.has(type);

type Lang = 'en' | 'nb' | 'nn';
type Node = {
  id: string; label: string; lang?: string; status: string; statusLabel?: string; href: string;
  excerpt?: string; excerptLang?: string | null;
  fold: string; wFull: number; wFold: number; full?: boolean;
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null;
};
type RawLink = {
  id: string | null; source: string; target: string; type: string; label: string; inferred?: boolean;
  agree?: number; disagree?: number; settled?: boolean; revealAt?: string | null;
};
type Link = {
  id: string | null; source: Node; target: Node; type: string; label: string; inferred: boolean;
  agree: number; disagree: number; settled: boolean; revealAt: string | null;
  rt: TypeLike | null; area: boolean; slot: number; w: number; tag: Tag;
};
// An edge label (or, when `node` is set, a concept box acting as a fixed obstacle) in the label simulation.
type Tag = { x: number; y: number; mx: number; my: number; r: number; fx?: number | null; fy?: number | null; node?: Node };
/** GET /api/mm/relations/<id> (stances-core getRelationView), as far as the card uses it. */
type RelationView = {
  id: string; createdBy: { name: string | null; deleted: boolean } | null;
  fromPost: { id: string; threadId: string; groupSlug: string | null; channelSlug: string | null } | null;
  settled: boolean; revealAt: string; revealed: boolean; agree: number; disagree: number;
  myStance: 'agree' | 'disagree' | null;
  stances: { name: string | null; deleted: boolean; stance: 'agree' | 'disagree'; afterReveal: boolean }[] | null;
};

const FOLD_CHARS = 18;
const NODE_H = 26;
const NODE_PAD_X = 8;
const EDGE_H = 14;
const SLOT_GAP = 7; // px between side-by-side relations of one pair
const SCALE: [number, number] = [0.2, 4];
const CARD_DELAY = 150; // hover rest before the card opens (ms)
const CARD_GRACE = 250; // time to travel from the node to the card (ms)
const SVG_NS = 'http://www.w3.org/2000/svg';

function strings(): (key: string, vars?: Record<string, string | number>) => string {
  const s = pageStrings();
  return (key, vars) => (s[key] ?? key).replace(/\{(\w+)\}/g, (m, name: string) => (vars && name in vars ? String(vars[name]) : m));
}

function draw(holder: HTMLElement): void {
  let data: { nodes: Node[]; links: RawLink[]; types?: TypeLike[] };
  try {
    data = JSON.parse(holder.dataset.graph ?? '');
  } catch {
    return;
  }
  if (!data?.nodes?.length) return;

  const wrap = holder.closest<HTMLElement>('[data-mm-graph-wrap]');
  if (wrap) wrap.hidden = false;
  const status = wrap?.querySelector<HTMLElement>('[data-mm-graph-status]') ?? null;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const lang: Lang = holder.dataset.lang === 'nb' || holder.dataset.lang === 'nn' ? holder.dataset.lang : 'en';
  const canStance = holder.dataset.canStance === 'true';
  const canSettle = holder.dataset.canSettle === 'true';
  const S = strings();
  const dateFmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nb-NO', { dateStyle: 'long' });
  const fmtDate = (iso: string | null | undefined) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? dateFmt.format(d) : '';
  };

  const svg = select(holder)
    .append('svg')
    .attr('focusable', 'false')
    .attr('aria-hidden', 'true');
  const svgEl = svg.node() as SVGSVGElement;
  let width = holder.clientWidth || 800;
  let height = svgEl.clientHeight || (width < 640 ? 420 : 520);
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  const small = width < 640;

  // --- data + measured label boxes (once) ---------------------------------
  const measure = textMeasurer(svgEl);
  const nodes: Node[] = data.nodes.map((n) => {
    const fold = truncateLabel(n.label, FOLD_CHARS);
    return { ...n, fold, wFull: measure(n.label, 'cm-node-probe') + NODE_PAD_X * 2, wFold: measure(fold, 'cm-node-probe') + NODE_PAD_X * 2 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const types = new Map((data.types ?? []).map((rt) => [rt.slug, rt]));
  const links: Link[] = (data.links ?? [])
    .filter((l) => byId.has(String(l.source)) && byId.has(String(l.target)) && l.source !== l.target)
    .map((l) => {
      const rt = types.get(l.type) ?? null;
      const area = rt?.render === 'area';
      const w = measure(l.label, 'cm-edge-label') + 6;
      return {
        id: l.id ?? null, source: byId.get(String(l.source))!, target: byId.get(String(l.target))!, type: String(l.type), label: l.label,
        inferred: l.inferred === true, agree: Number(l.agree) || 0, disagree: Number(l.disagree) || 0, settled: l.settled === true,
        revealAt: l.revealAt ?? null, rt, area, slot: 0, w, tag: { x: 0, y: 0, mx: 0, my: 0, r: (w + EDGE_H) / 4 + 2 },
      };
    });
  const lineLinks = links.filter((l) => !l.area);
  pairSlots(lineLinks.map((l) => ({ source: l.source.id, target: l.target.id }))).forEach((slot, i) => { lineLinks[i].slot = slot; });
  const labelled = lineLinks.filter((l) => !l.inferred); // edge labels in the label simulation
  const areaTypes = new Set([...types.values()].filter((rt) => rt.render === 'area').map((rt) => rt.slug));
  const groups: AreaGroup[] = areaGroups(links.map((l) => ({ source: l.source.id, target: l.target.id, type: l.type, inferred: l.inferred })), areaTypes);
  const neighbours = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const l of links) {
    if (l.inferred) continue;
    neighbours.get(l.source.id)!.add(l.target.id);
    neighbours.get(l.target.id)!.add(l.source.id);
  }
  const order = [...nodes].sort((a, b) => a.label.localeCompare(b.label));

  // --- elements -----------------------------------------------------------
  // Arrowheads: one marker per palette slot in use.
  const defs = svg.append('defs');
  const markerIds = new Map<string, string>();
  for (const rt of types.values()) {
    const m = arrowMarker(rt);
    if (!m || markerIds.has(m.id)) continue;
    const id = `${holder.id || 'mm-g'}-${m.id}`;
    markerIds.set(m.id, id);
    defs.append('marker').attr('id', id).attr('viewBox', m.viewBox).attr('refX', 10).attr('refY', 5)
      .attr('markerWidth', m.size).attr('markerHeight', m.size).attr('markerUnits', 'userSpaceOnUse').attr('orient', 'auto')
      .append('path').attr('d', m.path).style('fill', m.color);
  }
  const markerOf = (rt: TypeLike | null) => {
    const m = rt ? arrowMarker(rt) : null;
    return m ? `url(#${markerIds.get(m.id)})` : null;
  };

  // Areas (under everything): hull, inner hull for `double`, label tab.
  const areaLayer = svg.append('g').attr('class', 'cm-areas');
  const areaG = areaLayer.selectAll<SVGGElement, AreaGroup>('g').data(groups).join('g')
    .attr('class', 'cm-area').attr('data-type', (g) => g.type);
  const areaTypeOf = (g: AreaGroup) => types.get(g.type)!;
  const areaText = (g: AreaGroup) => `${byId.get(g.container)?.label ?? g.container} · ${typeLabel(areaTypeOf(g), lang).text}`;
  const areaTextW = new Map(groups.map((g) => [g.key, measure(areaText(g), 'cm-area-label')]));
  areaG.append('path').attr('class', 'cm-hull')
    .style('fill', (g) => tintColor(areaTypeOf(g).color)).style('stroke', (g) => strokeColor(areaTypeOf(g).color))
    .attr('stroke-dasharray', (g) => dashArray(areaTypeOf(g).stroke));
  areaG.filter((g) => areaTypeOf(g).stroke === 'double').append('path').attr('class', 'cm-hull cm-hull-inner')
    .style('fill', 'none').style('stroke', (g) => strokeColor(areaTypeOf(g).color));
  areaG.append('rect').attr('class', 'cm-area-tab')
    .style('fill', (g) => tintColor(areaTypeOf(g).color)).style('stroke', (g) => strokeColor(areaTypeOf(g).color));
  areaG.append('text').attr('class', 'cm-area-label').attr('text-anchor', 'middle').attr('dy', '0.35em')
    .attr('lang', (g) => typeLabel(areaTypeOf(g), lang).lang).text(areaText);

  // Relations: a wide transparent hit line (also the highlight band), the
  // visible line(s), the contested square. Area relations have a hit line only.
  const edgeLayer = svg.append('g').attr('class', 'cm-edges');
  const edge = edgeLayer.selectAll<SVGGElement, Link>('g').data(links).join('g')
    .attr('class', (d) => `cm-edge${d.inferred ? ' cm-inferred' : ''}${d.area ? ' cm-area-rel' : ''}`)
    .attr('data-type', (d) => d.type);
  edge.append('line').attr('class', 'cm-hit');
  const lines = edge.filter((d) => !d.area);
  lines.append('line').attr('class', 'cm-line cm-line-main');
  lines.append('line').attr('class', 'cm-line cm-line-a');
  lines.append('line').attr('class', 'cm-line cm-line-b');
  lines.append('rect').attr('class', 'cm-contest').attr('width', 6).attr('height', 6);

  const edgeLabel = svg.append('g').selectAll('text').data(lineLinks).join('text')
    .attr('class', (d) => `cm-edge-label${d.inferred ? ' cm-inferred' : ''}`)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .text((d) => d.label);
  const nodeLayer = svg.append('g');
  const node = nodeLayer.selectAll<SVGAElement, Node>('a').data(nodes).join('a')
    .attr('class', (d) => `cm-node mm-st-${d.status}`)
    .attr('href', (d) => d.href)
    .attr('tabindex', '-1');
  node.append('rect').attr('y', -NODE_H / 2).attr('height', NODE_H);
  node.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').attr('lang', (d) => d.lang ?? null);

  /** Colour, pattern, width, arrow and contested marker of every line (again after a vote). */
  const styleEdges = () => {
    lines.each(function (d) {
      const g = select(this);
      const color = strokeColor(d.rt?.color ?? 'ink');
      const pattern = d.rt?.stroke ?? 'solid';
      const contested = !d.inferred && isContested(d.agree, d.disagree);
      const w = d.inferred ? 1 : agreementWidth(d.agree, d.disagree);
      const dash = d.inferred ? dashArray(pattern) : edgeDash(pattern, contested);
      const double = pattern === 'double';
      g.classed('is-contested', contested);
      // The main line carries the arrow; for `double` it is only the arrow's carrier (the two strokes are drawn beside it).
      g.select('.cm-line-main').style('stroke', color).attr('stroke-width', w).attr('stroke-dasharray', dash)
        .attr('stroke-opacity', double ? 0 : null).attr('marker-end', markerOf(d.rt));
      g.selectAll('.cm-line-a, .cm-line-b').style('stroke', color).attr('stroke-width', Math.max(1, w * 0.6))
        .attr('stroke-dasharray', dash).attr('display', double ? null : 'none');
      g.select('.cm-contest').style('stroke', color).attr('display', contested ? null : 'none');
      g.select('.cm-hit').attr('stroke-width', Math.max(12, w + 10));
    });
  };
  styleEdges();

  // --- concept card ---------------------------------------------------------
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const card = el('div', 'mm-graph-card');
  card.id = `${holder.id || 'mm-g-canvas'}-card`;
  card.hidden = true;
  const cardTitle = el('p', 'mm-graph-card-title');
  const cardStatus = el('p', 'mm-graph-card-status');
  const cardText = el('p', 'mm-graph-card-text');
  const cardLink = el('a', 'mm-graph-card-link');
  cardLink.textContent = holder.dataset.openLabel ?? 'Open concept';
  card.append(cardTitle, cardStatus, cardText, cardLink);
  holder.append(card);
  const baseDescribedBy = holder.getAttribute('aria-describedby');
  let cardId: string | null = null;
  let cardSize = { w: 0, h: 0 };
  let overCard = false;
  let showTimer = 0;
  let hideTimer = 0;

  // --- relation card (built with textContent / createElement only) ----------
  const rel = el('div', 'mm-graph-card mm-graph-relcard');
  rel.id = `${holder.id || 'mm-g-canvas'}-relcard`;
  rel.hidden = true;
  rel.setAttribute('role', 'group');
  rel.setAttribute('aria-label', S('rel.card'));
  const relClose = el('button', 'mm-textbutton mm-graph-card-close', S('rel.close'));
  relClose.type = 'button';
  const relTitle = el('p', 'mm-graph-card-title');
  const relType = el('p', 'mm-graph-relcard-type');
  const relBody = el('div', 'mm-graph-relcard-body');
  const relLive = el('p', 'mm-graph-relcard-live');
  relLive.setAttribute('role', 'status');
  rel.append(relClose, relTitle, relType, relBody, relLive);
  holder.append(rel);
  let relLink: Link | null = null;
  let relPinned = false;
  let relSize = { w: 0, h: 0 };
  let overRel = false;
  let relToken = 0;
  let relBusy = false;
  const views = new Map<string, RelationView>();

  // --- state --------------------------------------------------------------
  let t: ZoomTransform = zoomIdentity;
  let showAll = false;
  let focusId: string | null = null;
  let hoverId: string | null = null;
  let hoverEdge: Link | null = null;
  let edgeIdx = -1; // position in the selected concept's relations (E)
  let auto = true; // keep fitting the view until the reader zooms or pans

  // --- simulations --------------------------------------------------------
  // Layout from asserted relations only (inferred ones would pull everything together).
  const simLinks = links.filter((l) => !l.inferred);
  const sim = forceSimulation<Node>(nodes)
    .force('link', forceLink<Node, Link>(simLinks).id((d) => d.id)
      .distance((l) => linkDistance(l.source.wFold ?? 60, l.target.wFold ?? 60, l.area ? 0 : l.w) * (small ? 0.8 : 1)))
    .force('charge', forceManyBody().strength(small ? -260 : -420))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(small ? 0.04 : 0.08))
    .force('collide', forceCollide<Node>((d) => d.wFold / 2 + 10).strength(1).iterations(3))
    .force('areas', (alpha: number) => {
      // Weak pull of an area's concepts towards their common centre.
      for (const g of groups) {
        const ns = [g.container, ...g.members].map((id) => byId.get(id)!).filter(Boolean);
        if (ns.length < 2) continue;
        const cx = ns.reduce((a, n) => a + (n.x ?? 0), 0) / ns.length;
        const cy = ns.reduce((a, n) => a + (n.y ?? 0), 0) / ns.length;
        for (const n of ns) {
          n.vx = (n.vx ?? 0) + (cx - (n.x ?? 0)) * 0.04 * alpha;
          n.vy = (n.vy ?? 0) + (cy - (n.y ?? 0)) * 0.04 * alpha;
        }
      }
    })
    .stop();

  const obstacles: Tag[] = nodes.map((n) => ({ x: 0, y: 0, mx: 0, my: 0, r: NODE_H / 2 + 6, node: n }));
  const tags: Tag[] = [...labelled.map((l) => l.tag), ...obstacles];
  const tagSim = forceSimulation<Tag>(tags)
    .force('x', forceX<Tag>((d) => d.mx).strength(0.3))
    .force('y', forceY<Tag>((d) => d.my).strength(0.3))
    .force('collide', forceCollide<Tag>((d) => d.r).strength(0.9).iterations(2))
    .stop();

  /** Re-anchor the edge labels on their midpoints and relax them `ticks` times. */
  const relaxTags = (ticks: number, reset = false) => {
    for (const l of lineLinks) {
      const g = l.tag;
      g.mx = ((l.source.x ?? 0) + (l.target.x ?? 0)) / 2;
      g.my = ((l.source.y ?? 0) + (l.target.y ?? 0)) / 2;
      if (reset || l.inferred) { g.x = g.mx; g.y = g.my; }
    }
    for (const o of obstacles) { o.fx = o.node!.x ?? 0; o.fy = o.node!.y ?? 0; }
    tagSim.alpha(reset ? 1 : 0.3);
    for (let i = 0; i < ticks; i++) tagSim.tick();
  };

  // --- rendering (screen space; the zoom transform maps world -> screen) ---
  const isLit = (l: Link, id: string | null) => id !== null && (l.source.id === id || l.target.id === id);
  /** Screen box of a concept at the current zoom and label state. */
  const boxOf = (d: Node, s: number): Box => ({ x: t.applyX(d.x ?? 0), y: t.applyY(d.y ?? 0), w: (d.full ? d.wFull : d.wFold) * s, h: NODE_H * s });
  /** Screen segment of a relation: from border to border, moved sideways by its slot. */
  const segmentOf = (l: Link, s: number): [Point, Point] => {
    const a = boxOf(l.source, s), b = boxOf(l.target, s);
    const p = clipToBox(b, a, 2), q = clipToBox(a, b, 3);
    return l.slot ? offsetSegment(p, q, l.slot * SLOT_GAP) : [p, q];
  };
  const midOf = (l: Link, s: number): Point => {
    const [p, q] = segmentOf(l, s);
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  };
  const render = () => {
    const lod = levelOfDetail(t.k, showAll);
    const s = Math.min(1, t.k); // glyph scale
    node.each(function (d) {
      const full = lod.fullLabels || d.id === focusId || d.id === hoverId;
      if (d.full !== full) {
        d.full = full;
        const w = full ? d.wFull : d.wFold;
        const g = select(this);
        g.select('text').text(full ? d.label : d.fold);
        g.select('rect').attr('x', -w / 2).attr('width', w);
      }
    }).attr('transform', (d) => `translate(${t.applyX(d.x ?? 0)},${t.applyY(d.y ?? 0)}) scale(${s})`);

    // Areas.
    areaG.each(function (g) {
      const sel = select(this);
      if (typeHidden(g.type)) { sel.attr('display', 'none'); return; }
      sel.attr('display', null);
      const boxes = [g.container, ...g.members].map((id) => byId.get(id)).filter((n): n is Node => !!n).map((n) => boxOf(n, s));
      const pad = areaPadding(g.level) * s;
      const poly = hullPolygon(boxes, pad);
      const d = (p: [number, number][] | null) => (p ? `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z` : null);
      sel.select('.cm-hull:not(.cm-hull-inner)').attr('d', d(poly));
      sel.select('.cm-hull-inner').attr('d', d(hullPolygon(boxes, Math.max(1, pad - 4))));
      const at = hullLabelAnchor(poly);
      const tw = (areaTextW.get(g.key) ?? 40) + 10;
      sel.select('.cm-area-tab').attr('display', at ? null : 'none')
        .attr('transform', at ? `translate(${at.x},${at.y}) scale(${s})` : null)
        .attr('x', -tw / 2).attr('y', -8).attr('width', tw).attr('height', 16);
      sel.select('.cm-area-label').attr('display', at ? null : 'none')
        .attr('transform', at ? `translate(${at.x},${at.y}) scale(${s})` : null);
    });

    // Relations.
    edge.each(function (l) {
      const g = select(this);
      if (typeHidden(l.type)) { g.attr('display', 'none'); return; }
      g.attr('display', null);
      const [p, q] = l.area
        ? [clipToBox(boxOf(l.target, s), boxOf(l.source, s)), clipToBox(boxOf(l.source, s), boxOf(l.target, s))]
        : segmentOf(l, s);
      const set = (sel: string, a: Point, b: Point) => g.select(sel).attr('x1', a.x).attr('y1', a.y).attr('x2', b.x).attr('y2', b.y);
      set('.cm-hit', p, q);
      if (l.area) return;
      set('.cm-line-main', p, q);
      if (l.rt?.stroke === 'double') {
        const w = l.inferred ? 1 : agreementWidth(l.agree, l.disagree);
        const off = Math.max(1, w * 0.6) / 2 + 1;
        const [a1, b1] = offsetSegment(p, q, off);
        const [a2, b2] = offsetSegment(p, q, -off);
        set('.cm-line-a', a1, b1);
        set('.cm-line-b', a2, b2);
      }
      g.select('.cm-contest').attr('x', (p.x + q.x) / 2 - 3).attr('y', (p.y + q.y) / 2 - 3);
    });

    // Edge labels: the offset found by the label simulation is kept in screen pixels.
    const nodeBoxes: Box[] = nodes.map((d) => boxOf(d, s));
    const shown: number[] = [];
    const forced = new Set<number>();
    const boxes: Box[] = [];
    lineLinks.forEach((l, i) => {
      if (typeHidden(l.type)) return;
      // Inferred relations are labelled only when one of their ends is the selected concept.
      const lit = l.inferred ? isLit(l, focusId) : isLit(l, focusId) || isLit(l, hoverId) || l === relLink;
      if (!lit && (l.inferred || !lod.edgeLabels)) return;
      if (lit) forced.add(shown.length);
      shown.push(i);
      const off = l.slot ? offsetSegment({ x: 0, y: 0 }, { x: t.applyX(l.target.x ?? 0) - t.applyX(l.source.x ?? 0), y: t.applyY(l.target.y ?? 0) - t.applyY(l.source.y ?? 0) }, l.slot * SLOT_GAP)[0] : { x: 0, y: 0 };
      boxes.push({ x: t.applyX(l.tag.mx) + (l.tag.x - l.tag.mx) * s + off.x, y: t.applyY(l.tag.my) + (l.tag.y - l.tag.my) * s + off.y, w: l.w * s, h: EDGE_H * s });
    });
    const hidden = hiddenByOverlap(boxes, nodeBoxes, forced);
    const at = new Map<number, Box>();
    shown.forEach((i, j) => { if (!hidden.has(j)) at.set(i, boxes[j]); });
    edgeLabel
      .attr('display', (_d, i) => (at.has(i) ? null : 'none'))
      .attr('transform', (_d, i) => {
        const b = at.get(i);
        return b ? `translate(${b.x},${b.y}) scale(${s})` : null;
      });
    positionCard();
    positionRel();
  };

  const positionCard = () => {
    const d = cardId ? byId.get(cardId) : null;
    if (!d || card.hidden) return;
    const dock = shouldDock(width);
    card.classList.toggle('is-docked', dock);
    if (dock) {
      card.style.left = card.style.top = '';
      card.style.visibility = '';
      return;
    }
    const sx = t.applyX(d.x ?? 0), sy = t.applyY(d.y ?? 0);
    const s = Math.min(1, t.k);
    // A node panned out of the frame takes its card with it.
    card.style.visibility = sx < 0 || sx > width || sy < 0 || sy > height ? 'hidden' : '';
    const p = placeCard({ x: sx, y: sy, w: (d.full ? d.wFull : d.wFold) * s, h: NODE_H * s }, cardSize, { w: width, h: height });
    card.style.left = `${Math.round(p.x)}px`;
    card.style.top = `${Math.round(p.y)}px`;
  };
  const positionRel = () => {
    if (!relLink || rel.hidden) return;
    const dock = shouldDock(width);
    rel.classList.toggle('is-docked', dock);
    if (dock) {
      rel.style.left = rel.style.top = '';
      rel.style.visibility = '';
      return;
    }
    const m = midOf(relLink, Math.min(1, t.k));
    rel.style.visibility = m.x < 0 || m.x > width || m.y < 0 || m.y > height ? 'hidden' : '';
    const p = placeCard({ x: m.x, y: m.y, w: 16, h: 16 }, relSize, { w: width, h: height });
    rel.style.left = `${Math.round(p.x)}px`;
    rel.style.top = `${Math.round(p.y)}px`;
  };
  const describe = () => {
    const ids = [baseDescribedBy];
    if (relLink && relPinned && !rel.hidden) ids.push(rel.id);
    else if (cardId !== null && cardId === focusId && !card.hidden) ids.push(card.id);
    const v = ids.filter(Boolean).join(' ');
    if (v) holder.setAttribute('aria-describedby', v); else holder.removeAttribute('aria-describedby');
  };
  /** Shows the card for a concept (null closes it). Text only, never markup. A pinned relation card keeps the place. */
  const showCard = (id: string | null) => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    const d = id && !(relLink && relPinned) ? byId.get(id) : null;
    if (!d) {
      cardId = null;
      card.hidden = true;
    } else if (cardId !== d.id || card.hidden) {
      closeRel(false);
      cardId = d.id;
      card.className = `mm-graph-card mm-st-${d.status}`;
      cardTitle.textContent = d.label;
      cardTitle.lang = d.lang ?? '';
      cardStatus.textContent = d.statusLabel ?? d.status;
      cardText.textContent = d.excerpt || holder.dataset.noDefinition || '';
      cardText.classList.toggle('is-empty', !d.excerpt);
      if (d.excerpt && d.excerptLang) cardText.lang = d.excerptLang; else cardText.removeAttribute('lang');
      cardLink.href = d.href;
      card.hidden = false;
      card.classList.toggle('is-docked', shouldDock(width)); // measure in its final shape
      cardSize = { w: card.offsetWidth, h: card.offsetHeight };
      positionCard();
    }
    describe();
  };
  /** Hover opens the card after a short rest; leaving lets it linger (so the link can be reached) and falls back to the selection. */
  const cardHoverIn = (id: string) => {
    window.clearTimeout(hideTimer);
    window.clearTimeout(showTimer);
    if (cardId === id && !card.hidden) return;
    showTimer = window.setTimeout(() => { if (!pressed && hoverId === id) showCard(id); }, CARD_DELAY);
  };
  const cardHoverOut = () => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (overCard || overRel || hoverId !== null || hoverEdge !== null) return;
      if (relLink && !relPinned) closeRel(false);
      if (!relLink) showCard(focusId);
    }, CARD_GRACE);
  };
  card.addEventListener('pointerenter', () => { overCard = true; window.clearTimeout(hideTimer); });
  card.addEventListener('pointerleave', () => { overCard = false; cardHoverOut(); });
  rel.addEventListener('pointerenter', () => { overRel = true; window.clearTimeout(hideTimer); });
  rel.addEventListener('pointerleave', () => { overRel = false; cardHoverOut(); });

  // --- relation card content -------------------------------------------------
  const nodeLabel = (id: string) => byId.get(id)?.label ?? id;
  const say = (text: string) => { relLive.textContent = text; };
  const sample = (rt: TypeLike) => {
    const spec = sampleSpec(rt);
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${spec.width} ${spec.height}`);
    s.setAttribute('width', String(spec.width));
    s.setAttribute('height', String(spec.height));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'mm-rt-sample');
    for (const shape of spec.shapes) {
      const e = document.createElementNS(SVG_NS, shape.tag);
      for (const [k, v] of Object.entries(svgAttrs(shape))) e.setAttribute(k, v);
      s.append(e);
    }
    return s;
  };
  const postHref = (p: NonNullable<RelationView['fromPost']>) => {
    if (!p.groupSlug) return null;
    const board = `/f/${encodeURIComponent(p.groupSlug)}${p.channelSlug ? `/${encodeURIComponent(p.channelSlug)}` : ''}`;
    return `${board}/t/${encodeURIComponent(p.threadId)}#post-${encodeURIComponent(p.id)}`;
  };
  const button = (text: string, act: string, onClick: () => void, pressed?: boolean) => {
    const b = el('button', 'mm-button mm-button-small', text);
    b.type = 'button';
    b.dataset.act = act;
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.disabled = relBusy;
    b.addEventListener('click', onClick);
    return b;
  };

  /** (Re)builds the relation card for `l` from the graph data and, when loaded, its view. */
  const fillRel = (l: Link) => {
    const active = document.activeElement as HTMLElement | null;
    const keep = active && rel.contains(active) ? active.dataset.act ?? null : null;
    const rt = l.rt;
    const sentence = rt
      ? relationSentence({ source: l.source.id, target: l.target.id }, rt, nodeLabel, focusId, lang)
      : { subject: nodeLabel(l.source.id), verb: { text: l.label, lang: 'en' as const }, object: nodeLabel(l.target.id), inverse: false };
    const subjectNode = byId.get(sentence.inverse ? l.target.id : l.source.id);
    const objectNode = byId.get(sentence.inverse ? l.source.id : l.target.id);
    const subj = el('span', '', sentence.subject);
    if (subjectNode?.lang) subj.lang = subjectNode.lang;
    const verb = el('span', 'mm-graph-relcard-verb', sentence.verb.text);
    verb.lang = sentence.verb.lang;
    const obj = el('span', '', sentence.object);
    if (objectNode?.lang) obj.lang = objectNode.lang;
    relTitle.replaceChildren(subj, ' ', verb, ' ', obj);

    relType.replaceChildren();
    if (rt) {
      const a = el('a', '', S('rel.typeLink', { label: typeLabel(rt, lang).text }));
      a.href = typePath(rt.slug);
      relType.append(sample(rt), a);
    }

    const view = l.id ? views.get(l.id) ?? null : null;
    const parts: HTMLElement[] = [];
    const flags = el('p', 'mm-graph-relcard-flags');
    if (!l.inferred && isContested(l.agree, l.disagree)) flags.append(el('span', 'mm-badge mm-badge-quiet', S('rel.contested')));
    if (l.settled) flags.append(el('span', 'mm-badge mm-badge-quiet', S('rel.settled')));
    if (flags.childNodes.length) parts.push(flags);

    if (l.inferred) {
      parts.push(el('p', 'mm-graph-relcard-note', S('rel.inferred', { label: rt ? typeLabel(rt, lang).text : l.label })));
      relBody.replaceChildren(...parts);
      relSize = { w: rel.offsetWidth, h: rel.offsetHeight };
      positionRel();
      return;
    }
    parts.push(el('p', 'mm-graph-relcard-totals', S('rel.totals', { agree: l.agree, disagree: l.disagree })));
    if (!view) {
      parts.push(el('p', 'mm-muted', S('rel.loading')));
    } else {
      const who = view.createdBy?.deleted ? S('rel.formerMember') : view.createdBy?.name || S('rel.unnamed');
      parts.push(el('p', 'mm-graph-relcard-meta', S('rel.proposedBy', { name: who })));
      const href = view.fromPost ? postHref(view.fromPost) : null;
      if (href) {
        const a = el('a', 'mm-graph-card-link', S('rel.fromPost'));
        a.href = href;
        parts.push(a);
      }
    }
    const revealDate = fmtDate(view?.revealAt ?? l.revealAt);
    const revealed = view ? view.revealed : !!l.revealAt && new Date(l.revealAt).getTime() <= Date.now();

    if (canStance && l.id) {
      const box = el('div', 'mm-graph-relcard-stance');
      const mine = view?.myStance ?? null;
      box.append(el('p', 'mm-graph-relcard-mine', view
        ? (mine === 'agree' ? S('rel.stanceAgree') : mine === 'disagree' ? S('rel.stanceDisagree') : S('rel.noStance'))
        : S('rel.yourStance')));
      const row = el('p', 'mm-graph-relcard-buttons');
      const disabled = !view || relBusy;
      const agree = button(S('rel.agree'), 'agree', () => vote(l, mine === 'agree' ? null : 'agree'), mine === 'agree');
      const disagree = button(S('rel.disagree'), 'disagree', () => vote(l, mine === 'disagree' ? null : 'disagree'), mine === 'disagree');
      agree.disabled = disagree.disabled = disabled;
      row.append(agree, disagree);
      if (mine) {
        const w = button(S('rel.withdraw'), 'withdraw', () => vote(l, null));
        w.classList.add('mm-button-quiet');
        w.disabled = disabled;
        row.append(w);
      }
      box.append(row);
      if (!revealed && revealDate) box.append(el('p', 'mm-help', S('rel.blind', { date: revealDate })));
      parts.push(box);
    } else if (!revealed && revealDate) {
      parts.push(el('p', 'mm-help', S('rel.hiddenUntil', { date: revealDate })));
      parts.push(el('p', 'mm-help', S('rel.membersOnly')));
    } else if (!canStance) {
      parts.push(el('p', 'mm-help', S('rel.membersOnly')));
    }

    if (view && view.revealed) {
      if (Array.isArray(view.stances)) {
        parts.push(el('p', 'mm-graph-relcard-names-title', S('rel.namesTitle', { date: fmtDate(view.revealAt) })));
        if (!view.stances.length) parts.push(el('p', 'mm-muted', S('rel.noNames')));
        else {
          const ul = el('ul', 'mm-graph-relcard-names');
          for (const st of view.stances) {
            const name = st.deleted ? S('rel.formerMember') : st.name || S('rel.unnamed');
            const li = el('li', `is-${st.stance}`, S(st.stance === 'agree' ? 'rel.nameAgrees' : 'rel.nameDisagrees', { name }));
            if (st.afterReveal) li.append(el('span', 'mm-muted', ` (${S('rel.afterReveal')})`));
            ul.append(li);
          }
          parts.push(ul);
        }
      } else if (!canStance) {
        parts.push(el('p', 'mm-help', S('rel.revealedPublic', { date: fmtDate(view.revealAt) })));
      }
    }

    if (canSettle && l.id && !l.settled) {
      const box = el('div', 'mm-graph-relcard-settle');
      const b = button(S('rel.settle'), 'settle', () => settle(l));
      b.classList.add('mm-button-quiet');
      b.disabled = !view || relBusy;
      box.append(b, el('p', 'mm-help', S('rel.settleHelp')));
      parts.push(box);
    }
    relBody.replaceChildren(...parts);
    if (keep) {
      const again = rel.querySelector<HTMLElement>(`[data-act="${keep}"]`) ?? rel.querySelector<HTMLElement>('[data-act="agree"]') ?? relClose;
      again.focus({ preventScroll: true });
    }
    relSize = { w: rel.offsetWidth, h: rel.offsetHeight };
    positionRel();
  };

  const loadView = async (l: Link) => {
    if (!l.id) return;
    const token = ++relToken;
    try {
      const r = await mmApi<{ relation: RelationView }>(`/api/mm/relations/${encodeURIComponent(l.id)}`);
      if (!r?.relation) return;
      views.set(l.id, r.relation);
      syncTotals(l, r.relation);
    } catch (err) {
      if (token === relToken && relLink === l) say(errorText(err));
    }
    if (token === relToken && relLink === l) fillRel(l);
  };
  const syncTotals = (l: Link, v: RelationView) => {
    const changed = l.agree !== v.agree || l.disagree !== v.disagree || l.settled !== v.settled;
    l.agree = v.agree;
    l.disagree = v.disagree;
    l.settled = v.settled;
    l.revealAt = v.revealAt ?? l.revealAt;
    if (changed) { styleEdges(); render(); }
  };
  const vote = async (l: Link, stance: 'agree' | 'disagree' | null) => {
    if (!l.id || relBusy) return;
    relBusy = true;
    fillRel(l);
    try {
      const r = await mmApi<{ relation?: RelationView }>(`/api/mm/relations/${encodeURIComponent(l.id)}/stance`, { method: 'POST', body: { stance } });
      if (r?.relation) {
        views.set(l.id, r.relation);
        syncTotals(l, r.relation);
      }
      say(stance === null ? S('rel.withdrawn') : S('rel.saved'));
    } catch (err) {
      say(err instanceof ApiFailure && err.status === 429 ? S('rel.slowDown') : errorText(err));
    } finally {
      relBusy = false;
      if (relLink === l) fillRel(l);
    }
  };
  const settle = async (l: Link) => {
    if (!l.id || relBusy) return;
    relBusy = true;
    fillRel(l);
    try {
      await mmApi(`/api/mm/relations/${encodeURIComponent(l.id)}/settle`, { method: 'POST' });
      l.settled = true;
      relBusy = false;
      await loadView(l);
      say(S('rel.settledNow'));
      if (relLink === l) rel.querySelector<HTMLElement>('[data-act="agree"]')?.focus({ preventScroll: true });
    } catch (err) {
      say(err instanceof ApiFailure && err.status === 429 ? S('rel.slowDown') : errorText(err));
    } finally {
      relBusy = false;
      if (relLink === l) fillRel(l);
    }
  };

  /** Opens the relation card for `l` (pinned: stays until closed; otherwise follows the hover). */
  const openRel = (l: Link, pinned: boolean) => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    const same = relLink === l && !rel.hidden;
    relLink = l;
    relPinned = pinned || (same && relPinned);
    edge.classed('is-sel', (d) => d === l);
    card.hidden = true;
    cardId = null;
    if (!same) {
      say('');
      rel.hidden = false;
      rel.classList.toggle('is-docked', shouldDock(width));
      fillRel(l);
      void loadView(l);
    }
    describe();
    render();
  };
  function closeRel(restore = true) {
    if (!relLink) return;
    relLink = null;
    relPinned = false;
    relToken++;
    rel.hidden = true;
    edge.classed('is-sel', false);
    if (restore) showCard(focusId);
    describe();
  }
  relClose.addEventListener('click', () => {
    closeRel();
    holder.focus({ preventScroll: true });
    render();
  });

  const paintFocus = () => {
    const near = focusId ? neighbours.get(focusId)! : null;
    svg.classed('has-focus', focusId !== null);
    node.classed('is-focus', (d) => d.id === focusId).classed('is-on', (d) => d.id === focusId || !!near?.has(d.id));
    edge.classed('is-on', (d) => isLit(d, focusId)).classed('is-hover', (d) => isLit(d, hoverId) || d === hoverEdge);
    areaG.classed('is-on', (g) => focusId !== null && (g.container === focusId || g.members.includes(focusId)));
    edgeLabel.classed('is-on', (d) => isLit(d, focusId) || (!d.inferred && isLit(d, hoverId)) || d === hoverEdge);
  };

  // --- zoom / pan ---------------------------------------------------------
  const zoomer = zoom<SVGSVGElement, unknown>()
    .scaleExtent(SCALE)
    .clickDistance(4)
    // Plain wheel scrolls the page unless the graph has focus; pinch (ctrl+wheel) always zooms.
    .filter((e: Event) => {
      const ev = e as WheelEvent;
      if (ev.type === 'wheel') return ev.ctrlKey || holder.matches(':focus-within');
      // One finger scrolls the page (touch-action: pan-y); two fingers pan and zoom the graph.
      if (ev.type.startsWith('touch')) return (e as TouchEvent).touches.length > 1;
      return !ev.ctrlKey && !(ev as MouseEvent).button;
    })
    .on('zoom', (e) => {
      if (e.sourceEvent) auto = false;
      t = e.transform;
      render();
    });
  svg.call(zoomer).on('dblclick.zoom', null);

  let raf = 0;
  const moveTo = (target: { k: number; x: number; y: number }, animate = true) => {
    cancelAnimationFrame(raf);
    const to = zoomIdentity.translate(target.x, target.y).scale(target.k);
    if (reduceMotion || !animate) { svg.call(zoomer.transform, to); return; }
    const from = t;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 220);
      const e = p * (2 - p);
      const mix = (a: number, b: number) => a + (b - a) * e;
      svg.call(zoomer.transform, zoomIdentity.translate(mix(from.x, to.x), mix(from.y, to.y)).scale(mix(from.k, to.k)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const points = () => nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }));
  const fitTarget = () => {
    const widest = Math.max(...nodes.map((n) => (showAll ? n.wFull : n.wFold)));
    const pad = groups.length ? areaPadding(Math.max(...groups.map((g) => g.level))) : 0;
    const margin = (s: number) => ({ x: Math.min((widest / 2 + pad) * s + 12, width / 3), y: (NODE_H / 2 + pad) * s + 14 });
    const first = fitTransform(points(), width, height, margin(1), SCALE);
    // Boxes shrink with the view below 1, which leaves more room: fit again with the smaller margin.
    return first.k < 1 ? fitTransform(points(), width, height, margin(first.k), SCALE) : first;
  };
  const zoomBy = (factor: number) => {
    auto = false;
    const k = clamp(t.k * factor, SCALE[0], SCALE[1]);
    const cx = width / 2, cy = height / 2;
    moveTo({ k, x: cx - ((cx - t.x) * k) / t.k, y: cy - ((cy - t.y) * k) / t.k });
  };
  const fit = (animate = true) => moveTo(fitTarget(), animate);
  const reset = () => {
    auto = false;
    const b = boundsOf(points().map((p) => ({ ...p, w: 0, h: 0 })))!;
    moveTo({ k: 1, x: width / 2 - (b.x0 + b.x1) / 2, y: height / 2 - (b.y0 + b.y1) / 2 });
  };

  // --- selection ----------------------------------------------------------
  // Bringing a box to the front re-appends it, and a browser drops the click
  // of an element that was re-appended around its mousedown. So a hovered box
  // is only raised after a short rest, and never while a button is down.
  const toFront = (elm: Element) => {
    if (elm.nextSibling) elm.parentNode?.appendChild(elm);
  };
  let raiseTimer = 0;
  let pressed = false;
  svgEl.addEventListener('pointerdown', () => { pressed = true; window.clearTimeout(raiseTimer); window.clearTimeout(showTimer); }, true);
  window.addEventListener('pointerup', () => { pressed = false; });
  window.addEventListener('pointercancel', () => { pressed = false; });
  const setFocus = (id: string | null, reveal = false) => {
    if (id !== focusId) edgeIdx = -1;
    focusId = id;
    closeRel(false);
    const d = id ? byId.get(id) : null;
    if (d) node.filter((n) => n.id === id).each(function () { toFront(this); });
    paintFocus();
    render();
    showCard(id);
    // Docked at the bottom: keep the selected concept above the card.
    if (d && !card.hidden && shouldDock(width)) {
      const room = height - cardSize.h;
      const sx = t.applyX(d.x ?? 0), sy = t.applyY(d.y ?? 0);
      const offX = sx < 0 || sx > width;
      if (sy > room - NODE_H || sy < NODE_H || offX) {
        auto = false;
        moveTo({ k: t.k, x: offX ? t.x + width / 2 - sx : t.x, y: t.y + room / 2 - sy });
      }
    }
    if (status) {
      status.textContent = d
        ? (holder.dataset.selectedTemplate ?? '{label}').replace(/\{label\}|\{relations\}/g, (m) => (m === '{label}' ? d.label : String(neighbours.get(d.id)!.size)))
        : '';
    }
    if (d && reveal && !shouldDock(width)) {
      const sx = t.applyX(d.x ?? 0), sy = t.applyY(d.y ?? 0);
      const mx = Math.min(d.wFull / 2 + 8, width / 2), my = NODE_H;
      if (sx < mx || sx > width - mx || sy < my || sy > height - my) {
        auto = false;
        moveTo({ k: t.k, x: t.x + width / 2 - sx, y: t.y + height / 2 - sy });
      }
    }
  };

  /** The selected concept's shown relations, in a stable reading order. */
  const relationsOfFocus = () => {
    if (!focusId) return [];
    const other = (l: Link) => nodeLabel(l.source.id === focusId ? l.target.id : l.source.id);
    return links
      .filter((l) => isLit(l, focusId) && !typeHidden(l.type))
      .sort((a, b) => Number(a.inferred) - Number(b.inferred) || other(a).localeCompare(other(b)) || a.type.localeCompare(b.type));
  };
  const stepEdge = (dir: 1 | -1) => {
    const list = relationsOfFocus();
    if (!list.length) {
      if (status) status.textContent = S('rel.noRelations');
      return;
    }
    edgeIdx = cycleIndex(list.length, relLink ? list.indexOf(relLink) : edgeIdx, dir);
    const l = list[edgeIdx];
    openRel(l, true);
    // Keep the relation in view.
    const m = midOf(l, Math.min(1, t.k));
    if (!shouldDock(width) && (m.x < 20 || m.x > width - 20 || m.y < 20 || m.y > height - 20)) {
      auto = false;
      moveTo({ k: t.k, x: t.x + width / 2 - m.x, y: t.y + height / 2 - m.y });
    }
    if (status) {
      const sn = l.rt ? relationSentence({ source: l.source.id, target: l.target.id }, l.rt, nodeLabel, focusId, lang) : null;
      const sentence = sn ? `${sn.subject} ${sn.verb.text} ${sn.object}` : `${nodeLabel(l.source.id)} ${l.label} ${nodeLabel(l.target.id)}`;
      status.textContent = S('rel.selected', { sentence, n: edgeIdx + 1, total: list.length });
    }
  };

  node
    .on('click', (event: MouseEvent, d) => {
      holder.focus({ preventScroll: true });
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // open in a new tab/window as usual
      if (focusId === d.id && !relLink) return; // second click follows the link
      event.preventDefault();
      setFocus(d.id);
    })
    .on('pointerenter', function (event: PointerEvent, d) {
      if (event.pointerType === 'touch') return;
      hoverId = d.id;
      window.clearTimeout(raiseTimer);
      raiseTimer = window.setTimeout(() => { if (!pressed && hoverId === d.id) toFront(this); }, 150);
      if (!(relLink && relPinned)) cardHoverIn(d.id);
      paintFocus();
      render();
    })
    .on('pointerleave', () => {
      window.clearTimeout(raiseTimer);
      if (hoverId === null) return;
      hoverId = null;
      cardHoverOut();
      paintFocus();
      render();
    });
  edge
    .on('click', (event: MouseEvent, d) => {
      holder.focus({ preventScroll: true });
      event.stopPropagation();
      openRel(d, true);
    })
    .on('pointerenter', (event: PointerEvent, d) => {
      if (event.pointerType === 'touch') return;
      hoverEdge = d;
      paintFocus();
      if (!(relLink && relPinned)) {
        window.clearTimeout(showTimer);
        window.clearTimeout(hideTimer);
        showTimer = window.setTimeout(() => { if (!pressed && hoverEdge === d) openRel(d, false); }, CARD_DELAY);
      }
      render();
    })
    .on('pointerleave', () => {
      if (hoverEdge === null) return;
      hoverEdge = null;
      cardHoverOut();
      paintFocus();
      render();
    });
  svg.on('click', (event: MouseEvent) => {
    if (event.target !== svgEl) return;
    if (relLink) { closeRel(); render(); return; }
    if (focusId) setFocus(null);
  });

  holder.tabIndex = 0;
  // Nothing inside the aria-hidden SVG keeps focus: a clicked concept hands it to the canvas.
  holder.addEventListener('focusin', (event) => {
    const target = event.target as globalThis.Node;
    if (event.target !== holder && !card.contains(target) && !rel.contains(target)) holder.focus({ preventScroll: true });
  });
  holder.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target !== holder) {
      // Inside a card only Escape is ours (Enter/Space act on links and buttons natively).
      if (event.key !== 'Escape') return;
      if (relLink) closeRel();
      else if (cardId) { hoverId = null; setFocus(null); }
      else return;
      holder.focus({ preventScroll: true });
      render();
      event.preventDefault();
      return;
    }
    const step = (dir: number) => {
      const i = order.findIndex((n) => n.id === focusId);
      setFocus(order[i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length].id, true);
    };
    switch (event.key) {
      case '+': case '=': zoomBy(1.4); break;
      case '-': case '_': case '−': zoomBy(1 / 1.4); break;
      case '0': reset(); break;
      case 'ArrowRight': case 'ArrowDown': step(1); break;
      case 'ArrowLeft': case 'ArrowUp': step(-1); break;
      case 'e': case 'E':
        if (!focusId) return;
        stepEdge(event.shiftKey ? -1 : 1);
        break;
      case 'Escape':
        if (relLink) { closeRel(); render(); break; }
        if (!focusId && !cardId) return;
        hoverId = null;
        setFocus(null);
        break;
      case 'Enter': {
        const d = focusId ? byId.get(focusId) : null;
        if (!d) return;
        window.location.assign(d.href);
        break;
      }
      default: return;
    }
    event.preventDefault();
  });

  wrap?.querySelectorAll<HTMLButtonElement>('[data-mm-graph-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.mmGraphAct) {
        case 'in': zoomBy(1.4); break;
        case 'out': zoomBy(1 / 1.4); break;
        case 'fit': auto = false; fit(); break;
        case 'reset': reset(); break;
        case 'labels':
          showAll = !showAll;
          btn.setAttribute('aria-pressed', String(showAll));
          render();
          break;
      }
    });
  });

  // --- run ----------------------------------------------------------------
  if (reduceMotion) {
    for (let i = 0; i < 300; i++) sim.tick();
    relaxTags(120, true);
    fit(false);
  } else {
    for (let i = 0; i < 40; i++) sim.tick(); // skip the initial explosion
    relaxTags(40, true);
    sim.on('tick', () => {
      relaxTags(2);
      if (auto) fit(false); else render();
    }).on('end', () => {
      relaxTags(80);
      if (auto) fit(false); else render();
    }).restart();
  }
  paintFocus();

  // The type filter hides every element of a type (render() reads typeHidden); an open card of a hidden type closes.
  const applyTypeFilter = () => {
    if (relLink && typeHidden(relLink.type)) closeRel();
    if (hoverEdge && typeHidden(hoverEdge.type)) hoverEdge = null;
    render();
  };
  filterListeners.add(applyTypeFilter);
  applyTypeFilter();

  node.call(
    drag<HTMLAnchorElement | SVGAElement, Node>()
      .clickDistance(4)
      .subject((_event, d) => ({ x: t.applyX(d.x ?? 0), y: t.applyY(d.y ?? 0) }))
      .on('start', (event, d) => {
        auto = false;
        if (reduceMotion) return;
        if (!event.active) sim.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        const x = t.invertX(event.x), y = t.invertY(event.y);
        if (reduceMotion) {
          d.x = x; d.y = y;
          relaxTags(30);
          render();
        } else {
          d.fx = x; d.fy = y;
        }
      })
      .on('end', (event, d) => {
        if (reduceMotion) return;
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }),
  );

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const w = holder.clientWidth, h = svgEl.clientHeight;
      if (!w || !h || (w === width && h === height)) return;
      width = w; height = h;
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      if (!card.hidden) cardSize = { w: card.offsetWidth, h: card.offsetHeight };
      if (!rel.hidden) relSize = { w: rel.offsetWidth, h: rel.offsetHeight };
      if (auto) fit(false); else render();
    }).observe(holder);
  }
}

/** Text width in the font of a graph class, measured on a canvas (no layout thrash). */
function textMeasurer(svg: SVGSVGElement): (text: string, cls: string) => number {
  const ctx = document.createElement('canvas').getContext('2d');
  const fonts = new Map<string, string>();
  return (text, cls) => {
    let font = fonts.get(cls);
    if (font === undefined) {
      const probe = document.createElementNS(SVG_NS, 'text');
      probe.setAttribute('class', cls);
      svg.appendChild(probe);
      const cs = getComputedStyle(probe);
      font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      probe.remove();
      fonts.set(cls, font);
    }
    if (!ctx) return text.length * 7;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

// Label boxes are measured once, so wait for the brand fonts.
const start = () => document.querySelectorAll<HTMLElement>('[data-mm-graph]').forEach(draw);
if (document.fonts?.ready) document.fonts.ready.then(start, start);
else start();
