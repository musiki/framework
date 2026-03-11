// src/plugins/rehype-obsidian-callouts.mjs
import { visit } from 'unist-util-visit';

// Extrae texto plano de un nodo HAST (element/text/raw)
function nodeText(n) {
  let out = '';
  (function walk(x) {
    if (!x) return;
    if (x.type === 'text' && typeof x.value === 'string') out += x.value;
    if (x.type === 'raw' && typeof x.value === 'string') out += x.value;
    if (Array.isArray(x.children)) x.children.forEach(walk);
  })(n);
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Quita el encabezado "[!tipo] título" del primer <p> del blockquote, preservando hijos.
function stripHeaderFromParagraph(p) {
  // Texto plano del párrafo
  const plain = nodeText(p).trimStart();
  const m = plain.match(/^\[\!([a-zA-Z]+)\]\s*(.*)?$/);
  if (!m) return null;

  const type = (m[1] || 'note').toLowerCase();
  const title = (m[2] || '').trim();

  // Vamos a “consumir” m[0] caracteres desde el INICIO del párrafo
  let toSkip = plain.indexOf('[') === 0 ? m[0].length : 0;
  if (!toSkip) return null;

  // Volvemos a caminar los hijos del párrafo y recortamos text nodes al frente
  const newChildren = [];
  let remainingToSkip = toSkip;
  for (const child of p.children || []) {
    if (remainingToSkip <= 0) {
      newChildren.push(child);
      continue;
    }
    if (child.type === 'text' && typeof child.value === 'string') {
      const v = child.value;
      if (v.length <= remainingToSkip) {
        remainingToSkip -= v.length; // saltar
        continue;
      } else {
        newChildren.push({ ...child, value: v.slice(remainingToSkip) });
        remainingToSkip = 0;
      }
    } else {
      // Nodo no-text todavía dentro del encabezado: lo omitimos
      // (muy raro que alguien meta inline antes del [!tipo], pero así evitamos falsos negativos)
    }
  }

  const cleanedParagraph = { ...p, children: newChildren };
  return { type, title, paragraph: cleanedParagraph };
}

export default function rehypeObsidianCallouts() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (!parent || node.tagName !== 'blockquote') return;

      const kids = Array.isArray(node.children) ? node.children : [];
      if (!kids.length) return;

      // Buscamos el primer <p> del blockquote para leer [!tipo] título
      const firstPara = kids.find((n) => n.type === 'element' && n.tagName === 'p');
      if (!firstPara) return;

      const header = stripHeaderFromParagraph(firstPara);
      if (!header) return; // no es callout

      const { type, title, paragraph } = header;

      // Construimos el “cuerpo”: párrafo limpio + resto de hijos del blockquote
      const bodyChildren = [];
      if (paragraph && paragraph.children && paragraph.children.length) {
        bodyChildren.push(paragraph);
      } else {
        // si el primer párrafo no dejó contenido, simplemente lo omitimos
      }
      for (const k of kids) {
        if (k === firstPara) continue; // ya lo manejamos
        bodyChildren.push(k);
      }

      // Armamos <aside class="callout callout-xxx"> con título opcional y cuerpo
      const asideNode = {
        type: 'element',
        tagName: 'aside',
        properties: { className: ['callout', `callout-${type}`] },
        children: [
          ...(title
            ? [{
                type: 'element',
                tagName: 'div',
                properties: { className: ['callout-title'] },
                children: [{ type: 'text', value: title }]
              }]
            : []),
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['callout-body'] },
            // el cuerpo mantiene los nodos HAST ya parseados (listas, code, etc.)
            children: bodyChildren
          }
        ]
      };

      // Reemplazamos el blockquote en su padre
      const i = parent.children.indexOf(node);
      if (i !== -1) parent.children.splice(i, 1, asideNode);
    });
  };
}