// Security sanitizer for LilyPond SVG output.
//
// A LilyPond score is a program: it can write any SVG it likes, so every SVG
// that the engine inlines into a page or serves from the site origin
// (public/lily/*.svg, /api/lily/render) goes through DOMPurify (jsdom window)
// with a strict SVG-only configuration:
//   - no <script>, <foreignObject>, <image>, animation elements, HTML elements;
//   - no on* handlers (DOMPurify) and no attribute values containing
//     javascript:/data:/vbscript:;
//   - href / xlink:href only as internal fragment references (#id);
//   - url(...) in style/presentation attributes only as url(#id);
//   - <style> dropped when it contains @import, url(...) to anything but #id,
//     expression(), behaviour/binding or "<".
// The result is serialized as XML, so it is valid both inline in HTML and as a
// standalone image/svg+xml file. `sanitizeLilypondSvgMarkup` (lilypond-support)
// remains a cosmetic pass (currentColor → theme ink) applied afterwards.
import createDOMPurify from 'dompurify';

const FORBID_TAGS = [
  'script', 'foreignObject', 'foreignobject', 'image', 'feImage', 'feimage',
  'animate', 'animateMotion', 'animatemotion', 'animateTransform', 'animatetransform',
  'animateColor', 'animatecolor', 'set', 'discard', 'handler', 'listener',
  'iframe', 'embed', 'object', 'audio', 'video', 'canvas', 'html', 'body', 'img',
];
const FORBID_ATTR = ['target', 'formaction', 'action', 'autofocus', 'tabindex'];
const DANGEROUS_VALUE_RE = /(?:java|vb)script\s*:|data\s*:|livescript\s*:/i;
const URL_REF_RE = /url\s*\(\s*(['"]?)\s*([^'")\s]*)\s*\1\s*\)/gi;
const STYLE_BLOCK_BAD_RE = /@import|expression\s*\(|behaviou?r\s*:|-moz-binding|<|\\/i;

/** Every url(...) in `text` must be a parsable internal reference url(#id). */
function urlRefsAreInternal(text) {
  const opened = (String(text).match(/url\s*\(/gi) || []).length;
  if (opened === 0) return true;
  const refs = Array.from(String(text).matchAll(URL_REF_RE));
  return refs.length === opened && refs.every((m) => /^#[\w.:-]+$/.test(m[2]));
}

let purifier = null;
let jsdomWindow = null;

async function loadPurifier() {
  if (purifier) return purifier;
  const { JSDOM } = await import('jsdom');
  jsdomWindow = new JSDOM('<!doctype html><html><body></body></html>').window;
  const instance = createDOMPurify(jsdomWindow);

  instance.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = String(data.attrName || '').toLowerCase();
    const value = String(data.attrValue || '');
    const compact = value.replace(/[\u0000- ]+/g, '');

    if (DANGEROUS_VALUE_RE.test(compact)) {
      data.keepAttr = false;
      return;
    }
    if (name === 'href' || name === 'xlink:href' || name.endsWith(':href')) {
      if (!/^#[\w.:-]*$/.test(value.trim())) data.keepAttr = false;
      return;
    }
    if (!urlRefsAreInternal(value)) data.keepAttr = false;
  });

  instance.addHook('uponSanitizeElement', (node, data) => {
    if (String(data.tagName || '').toLowerCase() !== 'style') return;
    const css = String(node.textContent || '');
    let bad = STYLE_BLOCK_BAD_RE.test(css) || DANGEROUS_VALUE_RE.test(css.replace(/\s+/g, ''));
    if (!bad) bad = !urlRefsAreInternal(css);
    if (bad && node.parentNode) node.parentNode.removeChild(node);
  });

  purifier = instance;
  return purifier;
}

/**
 * Sanitize SVG markup. Resolves the sanitized <svg>…</svg> (XML serialization,
 * no XML declaration / doctype), or '' when nothing safe is left.
 * @param {string} svgText
 * @returns {Promise<string>}
 */
export async function sanitizeSvgSecurity(svgText) {
  const input = String(svgText || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();
  if (!input) return '';
  const dompurify = await loadPurifier();

  const body = dompurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    WHOLE_DOCUMENT: false,
    RETURN_DOM: true,
  });

  const svg = Array.from(body.children).find((el) => el.localName === 'svg');
  if (!svg) return '';
  const serializer = new jsdomWindow.XMLSerializer();
  return serializer.serializeToString(svg);
}

/** True when the markup looks like an SVG document at all (cheap pre-check). */
export function looksLikeSvg(text) {
  return /<svg[\s>]/i.test(String(text || ''));
}
