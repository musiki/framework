// Concept graph (progressive enhancement; the page already lists every
// concept and relation). Same visual language as the MishMash Lab's
// concept-machine.js: labelled boxes in status colours, ink links, dashed
// contrasts, dotted reformulations, edge labels, force layout, drag; a static
// layout when the reader prefers reduced motion. D3 is bundled (no CDN).
// The SVG is decorative for assistive technology (aria-hidden); its links
// are mouse shortcuts to the concept pages listed below it.

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY, forceCollide } from 'd3-force';
import { select } from 'd3-selection';
import { drag } from 'd3-drag';

type Node = { id: string; label: string; status: string; href: string; w?: number; x?: number; y?: number; fx?: number | null; fy?: number | null };
type Link = { source: string | Node; target: string | Node; type: string; label: string };

function draw(holder: HTMLElement): void {
  let data: { nodes: Node[]; links: Link[] };
  try {
    data = JSON.parse(holder.dataset.graph ?? '');
  } catch {
    return;
  }
  if (!data?.nodes?.length) return;

  const nodes: Node[] = data.nodes.map((n) => ({ ...n }));
  const ids = new Set(nodes.map((n) => n.id));
  const links: Link[] = data.links.filter((l) => ids.has(String(l.source)) && ids.has(String(l.target))).map((l) => ({ ...l }));
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const width = holder.clientWidth || 800;
  const height = width < 640 ? 420 : 520;
  const svg = select(holder)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('focusable', 'false')
    .attr('aria-hidden', 'true');

  const link = svg.append('g').selectAll('line').data(links).join('line')
    .attr('class', (d) => `cm-link cm-${d.type}`);

  const edgeLabel = svg.append('g').selectAll('text').data(links).join('text')
    .attr('class', 'cm-edge-label')
    .attr('text-anchor', 'middle')
    .text((d) => d.label);

  const node = svg.append('g').selectAll<SVGAElement, Node>('a').data(nodes).join('a')
    .attr('class', (d) => `cm-node mm-st-${d.status}`)
    .attr('href', (d) => d.href)
    .attr('tabindex', '-1');

  node.append('rect');
  node.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').text((d) => d.label);
  node.each(function (d) {
    const g = select(this);
    const text = g.select<SVGTextElement>('text').node();
    const box = text ? text.getBBox() : ({ x: -30, y: -8, width: 60, height: 16 } as DOMRect);
    d.w = box.width + 16;
    g.select('rect')
      .attr('x', box.x - 8).attr('y', box.y - 5)
      .attr('width', d.w).attr('height', box.height + 10);
  });

  const sim = forceSimulation<Node>(nodes)
    .force('link', forceLink<Node, any>(links).id((d) => d.id).distance(width < 640 ? 130 : 190))
    .force('charge', forceManyBody().strength(width < 640 ? -260 : -420))
    .force('center', forceCenter(width / 2, height / 2))
    .force('x', forceX(width / 2).strength(0.04))
    .force('y', forceY(height / 2).strength(0.08))
    .force('collide', forceCollide<Node>((d) => (d.w ?? 60) / 2 + 14).strength(1).iterations(3));

  const pad = Math.min(80, width / 6);
  const render = () => {
    for (const d of nodes) {
      d.x = Math.max(pad, Math.min(width - pad, d.x ?? width / 2));
      d.y = Math.max(30, Math.min(height - 30, d.y ?? height / 2));
    }
    const n = (v: string | Node) => v as Node;
    link
      .attr('x1', (d) => n(d.source).x ?? 0).attr('y1', (d) => n(d.source).y ?? 0)
      .attr('x2', (d) => n(d.target).x ?? 0).attr('y2', (d) => n(d.target).y ?? 0);
    edgeLabel
      .attr('x', (d) => ((n(d.source).x ?? 0) + (n(d.target).x ?? 0)) / 2)
      .attr('y', (d) => ((n(d.source).y ?? 0) + (n(d.target).y ?? 0)) / 2 - 4);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  };

  if (reduceMotion) {
    sim.stop();
    for (let i = 0; i < 300; i++) sim.tick();
    render();
  } else {
    sim.on('tick', render);
    node.call(
      drag<HTMLAnchorElement | SVGAElement, Node>()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.2).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );
  }
}

document.querySelectorAll<HTMLElement>('[data-mm-graph]').forEach(draw);
