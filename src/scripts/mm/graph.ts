// Concept graph (progressive enhancement; the page already lists every
// concept and relation). Same visual language as the MishMash Lab's
// concept-machine.js: labelled boxes in status colours, ink links, dashed
// contrasts, dotted reformulations, edge labels, force layout, drag. D3 is
// bundled (no CDN).
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
// Accessibility: the SVG is decorative for assistive technology
// (aria-hidden, nothing focusable inside); the canvas element itself is one
// focusable group with keyboard shortcuts and a live status line, and the
// lists below the graph carry the same information.

import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { select } from 'd3-selection';
import { drag } from 'd3-drag';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { truncateLabel, hiddenByOverlap, fitTransform, linkDistance, levelOfDetail, boundsOf, clamp, type Box } from '../../lib/mm/graph-layout';

type Node = {
  id: string; label: string; lang?: string; status: string; href: string;
  fold: string; wFull: number; wFold: number; full?: boolean;
  x?: number; y?: number; fx?: number | null; fy?: number | null;
};
type Link = { source: string | Node; target: string | Node; type: string; label: string; w: number; tag: Tag };
// An edge label (or, when `node` is set, a concept box acting as a fixed obstacle) in the label simulation.
type Tag = { x: number; y: number; mx: number; my: number; r: number; fx?: number | null; fy?: number | null; node?: Node };

const FOLD_CHARS = 18;
const NODE_H = 26;
const NODE_PAD_X = 8;
const EDGE_H = 14;
const SCALE: [number, number] = [0.2, 4];

function draw(holder: HTMLElement): void {
  let data: { nodes: Node[]; links: Link[] };
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
  const links: Link[] = data.links
    .filter((l) => byId.has(String(l.source)) && byId.has(String(l.target)))
    .map((l) => {
      const w = measure(l.label, 'cm-edge-label') + 6;
      return { ...l, w, tag: { x: 0, y: 0, mx: 0, my: 0, r: (w + EDGE_H) / 4 + 2 } };
    });
  const end = (v: string | Node) => v as Node;
  const neighbours = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const l of links) {
    neighbours.get(String(l.source))!.add(String(l.target));
    neighbours.get(String(l.target))!.add(String(l.source));
  }
  const order = [...nodes].sort((a, b) => a.label.localeCompare(b.label));

  // --- elements -----------------------------------------------------------
  const link = svg.append('g').selectAll('line').data(links).join('line')
    .attr('class', (d) => `cm-link cm-${d.type}`);
  const edgeLabel = svg.append('g').selectAll('text').data(links).join('text')
    .attr('class', 'cm-edge-label')
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

  // --- state --------------------------------------------------------------
  let t: ZoomTransform = zoomIdentity;
  let showAll = false;
  let focusId: string | null = null;
  let hoverId: string | null = null;
  let auto = true; // keep fitting the view until the reader zooms or pans

  // --- simulations --------------------------------------------------------
  const sim = forceSimulation<Node>(nodes)
    .force('link', forceLink<Node, any>(links).id((d) => d.id)
      .distance((l: Link) => linkDistance(byId.get(String(l.source))?.wFold ?? 60, byId.get(String(l.target))?.wFold ?? 60, l.w) * (small ? 0.8 : 1)))
    .force('charge', forceManyBody().strength(small ? -260 : -420))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(small ? 0.04 : 0.08))
    .force('collide', forceCollide<Node>((d) => d.wFold / 2 + 10).strength(1).iterations(3))
    .stop();

  const obstacles: Tag[] = nodes.map((n) => ({ x: 0, y: 0, mx: 0, my: 0, r: NODE_H / 2 + 6, node: n }));
  const tags: Tag[] = [...links.map((l) => l.tag), ...obstacles];
  const tagSim = forceSimulation<Tag>(tags)
    .force('x', forceX<Tag>((d) => d.mx).strength(0.3))
    .force('y', forceY<Tag>((d) => d.my).strength(0.3))
    .force('collide', forceCollide<Tag>((d) => d.r).strength(0.9).iterations(2))
    .stop();

  /** Re-anchor the edge labels on their midpoints and relax them `ticks` times. */
  const relaxTags = (ticks: number, reset = false) => {
    for (const l of links) {
      const g = l.tag;
      g.mx = ((end(l.source).x ?? 0) + (end(l.target).x ?? 0)) / 2;
      g.my = ((end(l.source).y ?? 0) + (end(l.target).y ?? 0)) / 2;
      if (reset) { g.x = g.mx; g.y = g.my; }
    }
    for (const o of obstacles) { o.fx = o.node!.x ?? 0; o.fy = o.node!.y ?? 0; }
    tagSim.alpha(reset ? 1 : 0.3);
    for (let i = 0; i < ticks; i++) tagSim.tick();
  };

  // --- rendering (screen space; the zoom transform maps world -> screen) ---
  const isLit = (l: Link, id: string | null) => id !== null && (end(l.source).id === id || end(l.target).id === id);
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
    link
      .attr('x1', (d) => t.applyX(end(d.source).x ?? 0)).attr('y1', (d) => t.applyY(end(d.source).y ?? 0))
      .attr('x2', (d) => t.applyX(end(d.target).x ?? 0)).attr('y2', (d) => t.applyY(end(d.target).y ?? 0));

    // Edge labels: the offset found by the label simulation is kept in screen pixels.
    const nodeBoxes: Box[] = nodes.map((d) => ({ x: t.applyX(d.x ?? 0), y: t.applyY(d.y ?? 0), w: (d.full ? d.wFull : d.wFold) * s, h: NODE_H * s }));
    const shown: number[] = [];
    const forced = new Set<number>();
    const boxes: Box[] = [];
    links.forEach((l, i) => {
      const lit = isLit(l, focusId) || isLit(l, hoverId);
      if (!lit && !lod.edgeLabels) return;
      if (lit) forced.add(shown.length);
      shown.push(i);
      boxes.push({ x: t.applyX(l.tag.mx) + (l.tag.x - l.tag.mx) * s, y: t.applyY(l.tag.my) + (l.tag.y - l.tag.my) * s, w: l.w * s, h: EDGE_H * s });
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
  };

  const paintFocus = () => {
    const near = focusId ? neighbours.get(focusId)! : null;
    svg.classed('has-focus', focusId !== null);
    node.classed('is-focus', (d) => d.id === focusId).classed('is-on', (d) => d.id === focusId || !!near?.has(d.id));
    link.classed('is-on', (d) => isLit(d, focusId)).classed('is-hover', (d) => isLit(d, hoverId));
    edgeLabel.classed('is-on', (d) => isLit(d, focusId) || isLit(d, hoverId));
  };

  // --- zoom / pan ---------------------------------------------------------
  const zoomer = zoom<SVGSVGElement, unknown>()
    .scaleExtent(SCALE)
    .clickDistance(4)
    // Plain wheel scrolls the page unless the graph has focus; pinch (ctrl+wheel) always zooms.
    .filter((e: Event) => {
      const ev = e as WheelEvent;
      if (ev.type === 'wheel') return ev.ctrlKey || holder.matches(':focus-within');
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
    const margin = (s: number) => ({ x: Math.min((widest / 2) * s + 12, width / 3), y: (NODE_H / 2) * s + 14 });
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
  const toFront = (el: Element) => {
    if (el.nextSibling) el.parentNode?.appendChild(el);
  };
  let raiseTimer = 0;
  let pressed = false;
  svgEl.addEventListener('pointerdown', () => { pressed = true; window.clearTimeout(raiseTimer); }, true);
  window.addEventListener('pointerup', () => { pressed = false; });
  window.addEventListener('pointercancel', () => { pressed = false; });
  const setFocus = (id: string | null, reveal = false) => {
    focusId = id;
    const d = id ? byId.get(id) : null;
    if (d) node.filter((n) => n.id === id).each(function () { toFront(this); });
    paintFocus();
    render();
    if (status) {
      status.textContent = d
        ? (holder.dataset.selectedTemplate ?? '{label}').replace('{label}', d.label).replace('{relations}', String(neighbours.get(d.id)!.size))
        : '';
    }
    if (d && reveal) {
      const sx = t.applyX(d.x ?? 0), sy = t.applyY(d.y ?? 0);
      const mx = Math.min(d.wFull / 2 + 8, width / 2), my = NODE_H;
      if (sx < mx || sx > width - mx || sy < my || sy > height - my) {
        auto = false;
        moveTo({ k: t.k, x: t.x + width / 2 - sx, y: t.y + height / 2 - sy });
      }
    }
  };

  node
    .on('click', (event: MouseEvent, d) => {
      holder.focus({ preventScroll: true });
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // open in a new tab/window as usual
      if (focusId === d.id) return; // second click follows the link
      event.preventDefault();
      setFocus(d.id);
    })
    .on('pointerenter', function (event: PointerEvent, d) {
      if (event.pointerType === 'touch') return;
      hoverId = d.id;
      window.clearTimeout(raiseTimer);
      raiseTimer = window.setTimeout(() => { if (!pressed && hoverId === d.id) toFront(this); }, 150);
      paintFocus();
      render();
    })
    .on('pointerleave', () => {
      window.clearTimeout(raiseTimer);
      if (hoverId === null) return;
      hoverId = null;
      paintFocus();
      render();
    });
  svg.on('click', (event: MouseEvent) => {
    if (event.target === svgEl && focusId) setFocus(null);
  });

  holder.tabIndex = 0;
  // Nothing inside the aria-hidden SVG keeps focus: a clicked concept hands it to the canvas.
  holder.addEventListener('focusin', (event) => {
    if (event.target !== holder) holder.focus({ preventScroll: true });
  });
  holder.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
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
      case 'Escape': if (!focusId) return; setFocus(null); break;
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

  wrap?.querySelectorAll<HTMLButtonElement>('[data-mm-graph-act]').forEach((button) => {
    button.addEventListener('click', () => {
      switch (button.dataset.mmGraphAct) {
        case 'in': zoomBy(1.4); break;
        case 'out': zoomBy(1 / 1.4); break;
        case 'fit': auto = false; fit(); break;
        case 'reset': reset(); break;
        case 'labels':
          showAll = !showAll;
          button.setAttribute('aria-pressed', String(showAll));
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
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
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
