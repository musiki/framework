import { JSDOM } from 'jsdom';

let renderQueue = Promise.resolve();
let renderSequence = 0;
let mermaidDom = null;

class MermaidStyleSheet {
  cssRules = [];

  insertRule(rule) {
    this.cssRules.push({ cssText: String(rule) });
  }

  replaceSync(rules) {
    this.cssRules = String(rules)
      .split('}')
      .filter(Boolean)
      .map((rule) => ({ cssText: `${rule}}` }));
  }
}

function installSvgMeasurements(window) {
  const NUMBER_RE = /^-?\d*\.?\d+(?:e[-+]?\d+)?/i;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const toNumber = (value, fallback = 0) => {
    const match = String(value ?? '').trim().match(NUMBER_RE);
    if (!match) return fallback;
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : fallback;
  };

  const readAttr = (node, name, fallback = 0) => toNumber(node.getAttribute(name), fallback);

  const measureText = (node) => {
    const lines = String(node.textContent || '')
      .split(/\n|<br\s*\/?>/i)
      .map((line) => line.trim())
      .filter(Boolean);
    const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
    return {
      x: readAttr(node, 'x', 0),
      y: readAttr(node, 'y', 0) - 14,
      width: Math.max(10, longest * 7.2),
      height: Math.max(18, lines.length * 18),
    };
  };

  const installBoxAccessors = (prototype) => {
    if (!prototype) return;
    const readBox = function readBox() {
      const box = measureText(this);
      return {
        width: Math.ceil(box.width),
        height: Math.ceil(box.height),
      };
    };

    for (const [name, axis] of [
      ['offsetWidth', 'width'],
      ['clientWidth', 'width'],
      ['scrollWidth', 'width'],
      ['offsetHeight', 'height'],
      ['clientHeight', 'height'],
      ['scrollHeight', 'height'],
    ]) {
      Object.defineProperty(prototype, name, {
        configurable: true,
        get() {
          return readBox.call(this)[axis];
        },
      });
    }

    prototype.getBoundingClientRect = function getBoundingClientRect() {
      const box = measureText(this);
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: box.width,
        bottom: box.height,
        width: box.width,
        height: box.height,
        toJSON() {
          return this;
        },
      };
    };
  };

  const parseTranslate = (value) => {
    const match = String(value || '').match(/translate\(\s*([-\d.e+]+)(?:[\s,]+([-\d.e+]+))?/i);
    if (!match) return { x: 0, y: 0 };
    return {
      x: toNumber(match[1], 0),
      y: toNumber(match[2], 0),
    };
  };

  const offsetBox = (box, offset) => ({
    x: box.x + offset.x,
    y: box.y + offset.y,
    width: box.width,
    height: box.height,
  });

  const unionBoxes = (boxes) => {
    const finite = boxes.filter((box) =>
      Number.isFinite(box.x) &&
      Number.isFinite(box.y) &&
      Number.isFinite(box.width) &&
      Number.isFinite(box.height) &&
      box.width >= 0 &&
      box.height >= 0
    );
    if (finite.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    const minX = Math.min(...finite.map((box) => box.x));
    const minY = Math.min(...finite.map((box) => box.y));
    const maxX = Math.max(...finite.map((box) => box.x + box.width));
    const maxY = Math.max(...finite.map((box) => box.y + box.height));
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  };

  const measureElement = (node) => {
    const tagName = String(node.tagName || '').toLowerCase();

    if (tagName === 'text' || tagName === 'tspan') return measureText(node);

    if (tagName === 'foreignobject') {
      const textBox = measureText(node);
      return {
        x: readAttr(node, 'x', 0),
        y: readAttr(node, 'y', 0),
        width: Math.max(readAttr(node, 'width', 0), textBox.width),
        height: Math.max(readAttr(node, 'height', 0), textBox.height),
      };
    }

    if (tagName === 'rect' || tagName === 'image' || tagName === 'use') {
      return {
        x: readAttr(node, 'x', 0),
        y: readAttr(node, 'y', 0),
        width: readAttr(node, 'width', 0),
        height: readAttr(node, 'height', 0),
      };
    }

    if (tagName === 'circle') {
      const r = readAttr(node, 'r', 0);
      return {
        x: readAttr(node, 'cx', 0) - r,
        y: readAttr(node, 'cy', 0) - r,
        width: r * 2,
        height: r * 2,
      };
    }

    if (tagName === 'ellipse') {
      const rx = readAttr(node, 'rx', 0);
      const ry = readAttr(node, 'ry', 0);
      return {
        x: readAttr(node, 'cx', 0) - rx,
        y: readAttr(node, 'cy', 0) - ry,
        width: rx * 2,
        height: ry * 2,
      };
    }

    if (tagName === 'line') {
      const x1 = readAttr(node, 'x1', 0);
      const y1 = readAttr(node, 'y1', 0);
      const x2 = readAttr(node, 'x2', 0);
      const y2 = readAttr(node, 'y2', 0);
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    }

    if (tagName === 'path' || tagName === 'polygon' || tagName === 'polyline') {
      const explicitWidth = readAttr(node, 'width', 0);
      const explicitHeight = readAttr(node, 'height', 0);
      if (explicitWidth || explicitHeight) {
        return { x: readAttr(node, 'x', 0), y: readAttr(node, 'y', 0), width: explicitWidth, height: explicitHeight };
      }
    }

    const childBoxes = Array.from(node.children || [])
      .filter((child) => child.namespaceURI === SVG_NS)
      .map((child) => offsetBox(measureElement(child), parseTranslate(child.getAttribute('transform'))));

    return unionBoxes(childBoxes);
  };

  window.SVGElement.prototype.getBBox = function getBBox() {
    const box = measureElement(this);
    return {
      x: Number.isFinite(box.x) ? box.x : 0,
      y: Number.isFinite(box.y) ? box.y : 0,
      width: Number.isFinite(box.width) ? Math.max(0, box.width) : 0,
      height: Number.isFinite(box.height) ? Math.max(0, box.height) : 0,
    };
  };
  window.SVGElement.prototype.getComputedTextLength = function getComputedTextLength() {
    return measureText(this).width;
  };
  installBoxAccessors(window.HTMLElement?.prototype);
}

function getMermaidDom() {
  if (!mermaidDom) {
    mermaidDom = new JSDOM('<!doctype html><html><body></body></html>');
    installSvgMeasurements(mermaidDom.window);
  }
  return mermaidDom;
}

function installMermaidGlobals(dom) {
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
    CSSStyleSheet: globalThis.CSSStyleSheet || MermaidStyleSheet,
  };
  const previous = new Map();

  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

const initializationDom = getMermaidDom();
const restoreInitializationGlobals = installMermaidGlobals(initializationDom);
let mermaid = null;
try {
  mermaid = (await import('mermaid')).default;
} finally {
  restoreInitializationGlobals();
}

async function renderMermaidSource(source) {
  const dom = getMermaidDom();
  const restoreGlobals = installMermaidGlobals(dom);

  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict',
      suppressErrorRendering: true,
    });
    const id = `static-mermaid-${renderSequence += 1}`;
    const result = await mermaid.render(id, source);
    return String(result.svg || '').trim();
  } finally {
    dom.window.document.body.replaceChildren();
    restoreGlobals();
  }
}

export function renderMermaidSvg(source) {
  const normalized = String(source || '').trim();
  if (!normalized) return Promise.resolve('');

  const render = () => renderMermaidSource(normalized);
  const result = renderQueue.then(render, render);
  renderQueue = result.catch(() => undefined);
  return result;
}
