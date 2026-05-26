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
  window.SVGElement.prototype.getBBox = function getBBox() {
    const text = String(this.textContent || '');
    return {
      x: 0,
      y: 0,
      width: Math.max(60, text.length * 7),
      height: 20,
    };
  };
  window.SVGElement.prototype.getComputedTextLength = function getComputedTextLength() {
    return Math.max(60, String(this.textContent || '').length * 7);
  };
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
