// Connectoma del pod Progreso: el grafo de la materia desde la nota que se está
// leyendo, con profundidad 1 (sus vecinos) a 5 (el mapa entero). Usa el mismo
// motor que el Graph del ribbon (force-graph, /scripts/force-graph.min.js).
import { MAX_DEPTH, clampDepth, neighborhood } from '../../lib/course/connectome-depth.mjs';
import { conceptState, noteKey } from '../../lib/itinerary/route-position.mjs';

type Concept = { id: string; slug?: string; pageSlug?: string; name?: string; href?: string; read?: boolean; completed?: boolean; evaluated?: boolean };
type Edge = { source: string; target: string; type?: string; relType?: string };
type GraphNode = { id: string; name: string; state: number; active: boolean; concept: Concept; x?: number; y?: number };
type GraphLink = { source: string | GraphNode; target: string | GraphNode; type?: string; relType?: string };

type ForceGraphInstance = {
  graphData: (data?: { nodes: GraphNode[]; links: GraphLink[] }) => any;
  width: (w: number) => ForceGraphInstance;
  height: (h: number) => ForceGraphInstance;
  zoom: (k?: number, ms?: number) => any;
  zoomToFit: (ms?: number, padding?: number) => ForceGraphInstance;
  centerAt: (x?: number, y?: number, ms?: number) => ForceGraphInstance;
  _destructor?: () => void;
  [key: string]: any;
};

let loader: Promise<any> | null = null;
function loadForceGraph(): Promise<any> {
  const w = window as any;
  if (typeof w.ForceGraph === 'function') return Promise.resolve(w.ForceGraph);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-musiki-force-graph="true"]');
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(w.ForceGraph || w.default), { once: true });
    script.addEventListener('error', () => { loader = null; reject(new Error('force-graph no cargó')); }, { once: true });
    if (!existing) {
      script.src = '/scripts/force-graph.min.js';
      script.async = true;
      script.dataset.musikiForceGraph = 'true';
      document.head.appendChild(script);
    }
  });
  return loader;
}

const cssVar = (name: string, fallback: string) =>
  (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback;

export type Connectome = {
  update: (concepts: Concept[], edges: Edge[], activeSlug: string) => void;
  setDepth: (depth: number) => void;
  zoomBy: (factor: number) => void;
  resize: () => void;
  destroy: () => void;
};

export function createConnectome(host: HTMLElement, onOpen: (concept: Concept) => void, onCount?: (shown: number, total: number) => void): Connectome {
  let graph: ForceGraphInstance | null = null;
  let concepts: Concept[] = [];
  let edges: Edge[] = [];
  let activeSlug = '';
  let depth = 2;
  let pendingFit = true;

  const size = () => ({ w: host.clientWidth || 320, h: host.clientHeight || 220 });

  function build() {
    const activeKey = noteKey(activeSlug);
    const ids = concepts.map((c) => c.id);
    const startIds = activeKey
      ? concepts.filter((c) => [c.slug, c.id, c.pageSlug].some((v) => noteKey(v) === activeKey)).map((c) => c.id)
      : [];
    const keep = neighborhood(ids, edges, startIds, depth);
    const nodes: GraphNode[] = concepts
      .filter((c) => keep.has(c.id))
      .map((c) => ({ id: c.id, name: String(c.name || c.slug || ''), state: conceptState(c), active: startIds.includes(c.id), concept: c }));
    const links: GraphLink[] = edges
      .filter((e) => keep.has(e.source) && keep.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type, relType: e.relType }));
    onCount?.(nodes.length, concepts.length);
    return { nodes, links };
  }

  async function ensureGraph() {
    if (graph) return graph;
    const ForceGraph = await loadForceGraph();
    const accent = cssVar('--accent', '#c0562b');
    const ink = cssVar('--c-fg', '#2a2620');
    const dim = cssVar('--c-fg-dim', '#8a8478');
    const line = cssVar('--c-border', '#cfc8bb');
    const { w, h } = size();
    graph = ForceGraph()(host)
      .width(w)
      .height(h)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeLabel((n: GraphNode) => n.name)
      .nodeRelSize(4)
      .linkColor((l: GraphLink) => (l.type === 'rel' ? dim : line))
      .linkWidth((l: GraphLink) => (l.type === 'rel' && l.relType !== 'connect' ? 1.4 : 0.8))
      .linkLineDash((l: GraphLink) => (l.type === 'rel' && l.relType === 'connect' ? [2, 3] : null))
      .linkDirectionalArrowLength((l: GraphLink) => (l.type === 'rel' && l.relType !== 'connect' ? 3 : 0))
      .linkDirectionalArrowRelPos(0.92)
      .cooldownTicks(120)
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((n: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
        const r = n.active ? 6 : 4;
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        if (n.state >= 3) { ctx.fillStyle = accent; ctx.fill(); }
        else if (n.state === 2) { ctx.fillStyle = ink; ctx.fill(); }
        else {
          ctx.fillStyle = cssVar('--c-bg', '#fff');
          ctx.fill();
          ctx.lineWidth = 1.2 / Math.max(scale, 0.6);
          ctx.strokeStyle = n.state === 1 ? ink : dim;
          ctx.stroke();
        }
        if (n.active) {
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
          ctx.lineWidth = 1.6 / Math.max(scale, 0.6);
          ctx.strokeStyle = accent;
          ctx.stroke();
        }
        // Etiquetas: siempre en la nota activa, y en las demás al acercarse o con pocos nodos.
        const count = (graph?.graphData()?.nodes?.length as number) || 0;
        if (n.active || scale > 1.6 || count <= 24) {
          const font = Math.max(10 / scale, 2.5);
          ctx.font = `${font}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = n.active ? accent : dim;
          ctx.fillText(n.name.slice(0, 28), x, y + r + 2);
        }
      })
      .onNodeClick((n: GraphNode) => onOpen(n.concept))
      .onEngineStop(() => {
        if (pendingFit) { pendingFit = false; graph?.zoomToFit(300, 18); }
      });
    return graph;
  }

  async function redraw() {
    try {
      const g = await ensureGraph();
      pendingFit = true;
      g.graphData(build());
    } catch (error) {
      console.warn('[progress] connectome', error);
      host.textContent = 'No se pudo dibujar el Connectoma.';
    }
  }

  return {
    update(nextConcepts, nextEdges, nextActive) {
      const sameData = nextConcepts === concepts && nextEdges === edges;
      concepts = nextConcepts || [];
      edges = nextEdges || [];
      if (sameData && noteKey(nextActive) === noteKey(activeSlug) && graph) return;
      activeSlug = nextActive || '';
      void redraw();
    },
    setDepth(next) {
      depth = clampDepth(next);
      void redraw();
    },
    zoomBy(factor) {
      if (!graph) return;
      const current = Number(graph.zoom()) || 1;
      graph.zoom(current * factor, 200);
    },
    resize() {
      if (!graph) return;
      const { w, h } = size();
      graph.width(w).height(h);
      graph.zoomToFit(200, 18);
    },
    destroy() {
      graph?._destructor?.();
      graph = null;
      host.replaceChildren();
    },
  };
}

export { MAX_DEPTH };
