type PatchNode = {
  id: string;
  label: string;
};

type PatchEdge = {
  from: string;
  fromOutlet: number;
  to: string;
  toInlet: number;
};

type ParsedPatch = {
  format: 'puredata' | 'max' | 'raw';
  nodes: PatchNode[];
  edges: PatchEdge[];
  flowLines: string[];
  notes: string[];
  normalized: string;
};

const DEFAULT_PATCH_EVALUATION_PROMPT = [
  'Ignora por completo la posicion XY, patching_rect, presentation_rect, tamaño, color y cualquier atributo visual.',
  'Reconstruye cada patch como un grafo dirigido de objetos y conexiones.',
  'Pesa mucho mas la gramatica de conexiones, el flujo de señal/control y el rol funcional de cada objeto que su disposicion visual.',
  'Si la estructura funcional coincide pero cambia el layout, no penalices.',
  'Si cambian conexiones, outlets, inlets, orden logico o argumentos que alteren el comportamiento, penaliza.',
  'Describe el nivel de proximidad o lejania del patch del alumno respecto del patch de referencia.',
].join(' ');

const ensureText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const cleanupLine = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*$/g, '')
    .trim();

const safeJsonParse = (value: string): Record<string, any> | null => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const extractMaxJsonCandidate = (rawPatch: string): string => {
  const raw = String(rawPatch || '').trim();
  if (!raw) return '';

  const fencedStart = raw.indexOf('{');
  const fencedEnd = raw.lastIndexOf('}');
  if (fencedStart !== -1 && fencedEnd > fencedStart) {
    return raw.slice(fencedStart, fencedEnd + 1);
  }

  return raw;
};

const cleanPdLabel = (kind: string, payload: string[]): string => {
  const suffix = payload.join(' ').replace(/\\;/g, ';').trim();
  if (kind === 'obj') return cleanupLine(suffix);
  return cleanupLine([kind, suffix].filter(Boolean).join(' '));
};

const parsePureDataPatch = (rawPatch: string): ParsedPatch | null => {
  const raw = ensureText(rawPatch);
  if (!raw || !/#X\s+(obj|msg|floatatom|symbolatom|listbox|text|bng|tgl|nbx|hradio|vradio|hsl|vsl|connect)\b/.test(raw)) {
    return null;
  }

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const nodes: PatchNode[] = [];
  const edges: PatchEdge[] = [];
  const notes: string[] = [];

  lines.forEach((line) => {
    if (!line.startsWith('#X ')) return;

    const clean = cleanupLine(line);
    const parts = clean.split(/\s+/g);
    const pdType = parts[1] || '';

    if (pdType === 'connect') {
      const from = Number(parts[2]);
      const fromOutlet = Number(parts[3]);
      const to = Number(parts[4]);
      const toInlet = Number(parts[5]);
      if ([from, fromOutlet, to, toInlet].every((value) => Number.isFinite(value))) {
        edges.push({
          from: `n${from}`,
          fromOutlet,
          to: `n${to}`,
          toInlet,
        });
      }
      return;
    }

    if (['coords', 'restore', 'declare'].includes(pdType)) return;
    if (pdType === 'text') return;

    const payload = parts.slice(4);
    const label = cleanPdLabel(pdType, payload);
    const nodeIndex = nodes.length;
    nodes.push({
      id: `n${nodeIndex}`,
      label: label || pdType || `node-${nodeIndex}`,
    });
  });

  if (nodes.length === 0) {
    notes.push('No se pudieron extraer nodos del patch Pure Data.');
  }

  const flowLines = buildFlowLines(nodes, edges);

  return {
    format: 'puredata',
    nodes,
    edges,
    flowLines,
    notes,
    normalized: formatParsedPatch('puredata', nodes, edges, flowLines, notes),
  };
};

const labelMaxNode = (box: Record<string, any>, fallbackId: string): string => {
  const text = ensureText(box.text);
  const maxclass = ensureText(box.maxclass);
  const name = text || maxclass || ensureText(box.varname) || ensureText(box.name) || fallbackId;
  return cleanupLine(name);
};

const parseMaxPatch = (rawPatch: string): ParsedPatch | null => {
  const candidate = extractMaxJsonCandidate(rawPatch);
  if (!candidate || !candidate.includes('"patcher"')) return null;

  const parsed = safeJsonParse(candidate);
  const patcher = parsed?.patcher && typeof parsed.patcher === 'object' ? parsed.patcher : parsed;
  if (!patcher || typeof patcher !== 'object') return null;

  const rawBoxes = Array.isArray((patcher as any).boxes) ? (patcher as any).boxes : [];
  const rawLines = Array.isArray((patcher as any).lines) ? (patcher as any).lines : [];

  const nodes: PatchNode[] = [];
  const edges: PatchEdge[] = [];
  const notes: string[] = [];
  const nodeMap = new Map<string, PatchNode>();

  rawBoxes.forEach((entry: any, index: number) => {
    const box = entry?.box && typeof entry.box === 'object' ? entry.box : entry;
    if (!box || typeof box !== 'object') return;

    const id = ensureText(box.id) || `obj-${index + 1}`;
    const label = labelMaxNode(box, id);
    const node: PatchNode = { id, label };
    nodeMap.set(id, node);
    nodes.push(node);
  });

  rawLines.forEach((entry: any) => {
    const line = entry?.patchline && typeof entry.patchline === 'object' ? entry.patchline : entry;
    if (!line || typeof line !== 'object') return;

    const source = Array.isArray(line.source) ? line.source : [];
    const destination = Array.isArray(line.destination) ? line.destination : [];
    const from = ensureText(source[0]);
    const to = ensureText(destination[0]);
    const fromOutlet = Number(source[1]);
    const toInlet = Number(destination[1]);
    if (!from || !to) return;

    edges.push({
      from,
      fromOutlet: Number.isFinite(fromOutlet) ? fromOutlet : 0,
      to,
      toInlet: Number.isFinite(toInlet) ? toInlet : 0,
    });
  });

  if (nodes.length === 0) {
    notes.push('No se pudieron extraer boxes del patch Max.');
  }

  const flowLines = buildFlowLines(nodes, edges);

  return {
    format: 'max',
    nodes,
    edges,
    flowLines,
    notes,
    normalized: formatParsedPatch('max', nodes, edges, flowLines, notes),
  };
};

const fallbackNormalizePatch = (rawPatch: string): ParsedPatch => {
  const raw = ensureText(rawPatch);
  const notes = [
    'Se uso representacion raw porque no se pudo parsear el patch como Pure Data o Max JSON.',
  ];

  const cleaned = raw
    .split(/\r?\n/g)
    .map((line) => cleanupLine(line))
    .filter(Boolean)
    .slice(0, 120);

  return {
    format: 'raw',
    nodes: [],
    edges: [],
    flowLines: [],
    notes,
    normalized: [
      'FORMATO DETECTADO: raw',
      'RAW PATCH:',
      ...cleaned.map((line) => `- ${line}`),
      'NOTAS:',
      ...notes.map((note) => `- ${note}`),
    ].join('\n'),
  };
};

const buildFlowLines = (nodes: PatchNode[], edges: PatchEdge[]): string[] => {
  if (nodes.length === 0 || edges.length === 0) return [];

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, PatchEdge[]>();
  const indegree = new Map<string, number>();

  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  });

  edges.forEach((edge) => {
    const sourceEdges = outgoing.get(edge.from) || [];
    sourceEdges.push(edge);
    outgoing.set(edge.from, sourceEdges);
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  });

  const starts = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const visitQueue = starts.length > 0 ? starts : nodes.map((node) => node.id).slice(0, 4);
  const flowLines: string[] = [];
  const seen = new Set<string>();
  const maxFlows = 18;
  const maxDepth = 6;

  const describeStep = (edge: PatchEdge): string => {
    const sourceLabel = nodeMap.get(edge.from)?.label || edge.from;
    const targetLabel = nodeMap.get(edge.to)?.label || edge.to;
    return `${sourceLabel}:${edge.fromOutlet} -> ${targetLabel}:${edge.toInlet}`;
  };

  const walk = (nodeId: string, path: string[], depth: number) => {
    if (flowLines.length >= maxFlows) return;
    const nextEdges = outgoing.get(nodeId) || [];
    if (nextEdges.length === 0 || depth >= maxDepth) {
      if (path.length > 0) {
        const key = path.join(' | ');
        if (!seen.has(key)) {
          seen.add(key);
          flowLines.push(key);
        }
      }
      return;
    }

    nextEdges.forEach((edge) => {
      if (flowLines.length >= maxFlows) return;
      const step = describeStep(edge);
      walk(edge.to, path.concat(step), depth + 1);
    });
  };

  visitQueue.forEach((nodeId) => {
    walk(nodeId, [], 0);
  });

  return flowLines;
};

const formatParsedPatch = (
  format: ParsedPatch['format'],
  nodes: PatchNode[],
  edges: PatchEdge[],
  flowLines: string[],
  notes: string[],
): string => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const objectLines = nodes.length > 0
    ? nodes.map((node) => `- ${node.id}: ${node.label}`)
    : ['- (sin nodos extraidos)'];
  const connectionLines = edges.length > 0
    ? edges.map((edge) => {
        const sourceLabel = nodeMap.get(edge.from)?.label || edge.from;
        const targetLabel = nodeMap.get(edge.to)?.label || edge.to;
        return `- ${edge.from}:${edge.fromOutlet} -> ${edge.to}:${edge.toInlet} :: ${sourceLabel} -> ${targetLabel}`;
      })
    : ['- (sin conexiones extraidas)'];
  const pathLines = flowLines.length > 0
    ? flowLines.map((line) => `- ${line}`)
    : ['- (sin recorridos inferidos)'];
  const noteLines = notes.length > 0
    ? notes.map((note) => `- ${note}`)
    : ['- (sin observaciones adicionales)'];

  return [
    `FORMATO DETECTADO: ${format}`,
    `OBJETOS: ${nodes.length}`,
    `CONEXIONES: ${edges.length}`,
    'OBJECTS:',
    ...objectLines,
    'CONNECTIONS:',
    ...connectionLines,
    'FLOW SIGNATURES:',
    ...pathLines,
    'NOTES:',
    ...noteLines,
  ].join('\n');
};

const buildPatchRepresentation = (rawPatch: string): ParsedPatch => {
  const parsedPd = parsePureDataPatch(rawPatch);
  if (parsedPd) return parsedPd;

  const parsedMax = parseMaxPatch(rawPatch);
  if (parsedMax) return parsedMax;

  return fallbackNormalizePatch(rawPatch);
};

export function buildPatchEvaluationPrompt({
  consigna,
  referencePatch,
  studentPatch,
  criteriaPrompts = [],
  evaluationPrompt = '',
}: {
  consigna: string;
  referencePatch: string;
  studentPatch: string;
  criteriaPrompts?: string[];
  evaluationPrompt?: string;
}): string {
  const cleanConsigna = ensureText(consigna);
  const cleanCriteria = Array.isArray(criteriaPrompts)
    ? criteriaPrompts.map((item) => ensureText(item)).filter(Boolean)
    : [];
  const cleanEvaluationPrompt = ensureText(evaluationPrompt) || DEFAULT_PATCH_EVALUATION_PROMPT;

  const reference = buildPatchRepresentation(referencePatch);
  const student = buildPatchRepresentation(studentPatch);

  const criteriaBlock = cleanCriteria.length > 0
    ? cleanCriteria.map((item) => `- ${item}`).join('\n')
    : '- Sin criterios adicionales del docente.';

  return `Eres un evaluador de patches Max/MSP y Pure Data.

Tu tarea: comparar el patch del alumno contra la consigna y el patch de referencia, y devolver SOLO JSON valido (sin markdown, sin comentarios, sin texto extra) con esta estructura exacta:
{
  "resumen": "string",
  "tesis": {
    "clara": true,
    "explicacion": "string"
  },
  "fortalezas": ["string", "string"],
  "debilidades": ["string", "string"],
  "sugerencia": "string",
  "calificacion": {
    "nota": 0,
    "justificacion": "string"
  }
}

Reglas:
- "resumen": debe describir cercania o lejania funcional del patch del alumno respecto del patch de referencia.
- "tesis.clara": true solo si la logica principal del patch del alumno queda funcionalmente alineada con la consigna.
- "fortalezas": exactamente 2 items concretos sobre objetos, conexiones o estructura correcta.
- "debilidades": exactamente 2 items concretos sobre conexiones faltantes, conexiones incorrectas, outlets/inlets mal usados o argumentos que cambian el comportamiento.
- "sugerencia": una accion concreta para acercar el patch del alumno al de referencia.
- "calificacion.nota": numero entre 0 y 10.
- "calificacion.justificacion": 1 oracion breve y accionable.
- No penalices diferencias puramente visuales o espaciales.
- Penaliza diferencias estructurales reales de flujo, conexiones, outlets/inlets, objetos faltantes o argumentos funcionalmente relevantes.

Instruccion de analisis:
${cleanEvaluationPrompt}

Consigna:
"""
${cleanConsigna}
"""

Criterios adicionales del docente:
${criteriaBlock}

PATCH DE REFERENCIA NORMALIZADO
${reference.normalized}

PATCH DEL ALUMNO NORMALIZADO
${student.normalized}`;
}
