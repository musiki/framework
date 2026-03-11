import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { Buffer } from 'node:buffer';

export default function remarkDataviewLite() {
  return (tree, file) => {
    const ROOT = path.resolve(process.cwd(), 'src/content');

    // Cache file list for performance (assuming static build)
    const files = getAllMarkdownFiles(ROOT);

    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'dataview' && node.lang !== 'dataviewjs') return;

      const command = node.value.trim();
      let tag = null;

      // Parse optional meta (e.g., ```dataviewjs {"libs": ["three"]})
      let config = {};
      if (node.meta) {
        const metaStr = node.meta.trim();
        if (metaStr.startsWith('{')) {
          try {
            config = JSON.parse(metaStr);
          } catch (e) {
            console.warn(`Invalid meta JSON in dataview block: ${e.message}`);
          }
        }
      }

      if (node.lang === 'dataviewjs') {
        const match = command.match(/dv\.pages\(\s*['"]#([^'"]+)['"]\s*\)/);
        if (match) {
          tag = match[1];
        } else {
          // Render generic dataviewjs as client-side module script
          renderClientSideDataviewJS(node, index, parent, command, config, file, ROOT);
          return;
        }
      } else if (node.lang === 'dataview' && command.startsWith('list from #')) {
        tag = command.replace('list from #', '').trim();
      }

      if (tag) {
        // Server-side rendering for simple tag-based lists
        renderServerSideList(tag, files, index, parent);
      }
    });
  };
}

function getAllMarkdownFiles(root) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mdx)$/i.test(e.name)) files.push(p);
    }
  }
  walk(root);
  return files;
}

function renderServerSideList(tag, files, index, parent) {
  const matchingFiles = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const fm = matter(raw);
    const tags = fm.data.tags || [];
    if (tags.includes(tag)) {
      const rawSlug = path.basename(file).replace(/\.(md|mdx)$/i, '');
      const slug = rawSlug
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      let title = fm.data.title;
      if (!title) {
        const h1 = raw.match(/^#\s+(.*)$/m);
        if (h1) title = h1[1];
        else title = slug.split('/').pop();
      }
      matchingFiles.push({ slug, title });
    }
  }

  if (matchingFiles.length > 0) {
    const listItems = matchingFiles.map(file => `<li><a href="/${file.slug}">${file.title}</a></li>`).join('');
    const html = `<div class="dvlist"><ul class="dvlist-items">${listItems}</ul></div>`;
    parent.children[index] = { type: 'html', value: html };
  }
}

function renderClientSideDataviewJS(node, index, parent, command, config, file, ROOT) {
  const id = 'dvjs-' + Math.random().toString(36).slice(2);
  const b64 = Buffer.from(command).toString('base64');

  let filePath = '';
  if (file && file.path) {
    filePath = path.relative(ROOT, file.path).split(path.sep).join('/');
  }

  // Support for external libraries via meta config
  let imports = '';
  const libMap = {
    three: 'https://cdn.skypack.dev/three@latest',
    'three.js': 'https://cdn.skypack.dev/three@latest',
    // Add more libraries as needed, e.g.,
    // d3: 'https://cdn.skypack.dev/d3@latest',
  };
  if (config.libs && Array.isArray(config.libs)) {
    for (const lib of config.libs) {
      const url = libMap[lib.toLowerCase()];
      if (url) {
        const varName = lib.toUpperCase().replace(/\./g, '_');
        imports += `import * as ${varName} from '${url}';\n`;
      }
    }
  }

  const script = `${imports}
(async function() {
  try {
  const waitForContainer = async () => {
    const maxAttempts = 240; // ~4s at 60fps
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const el = document.getElementById('${id}');
      if (el && !el.closest('#slides-source')) {
        return el;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const fallback = document.getElementById('${id}');
    return fallback && !fallback.closest('#slides-source') ? fallback : null;
  };

  const container = await waitForContainer();
  if (!container) return;

  const applyElementOptions = (el, options = {}) => {
    if (options == null) return el;
    if (typeof options === 'string') {
      el.textContent = options;
      return el;
    }
    if (typeof options.text === 'string') {
      el.textContent = options.text;
    }
    if (options.cls) {
      const classList = Array.isArray(options.cls) ? options.cls : [options.cls];
      classList.filter(Boolean).forEach((cls) => el.classList.add(cls));
    }
    if (options.attr && typeof options.attr === 'object') {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, String(value));
      }
    }
    return el;
  };

  const enhanceElement = (el) => {
    if (!el || el.__dvEnhanced) return el;

    Object.defineProperty(el, '__dvEnhanced', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: true,
    });

    el.createEl = function(tag, options = {}) {
      const child = document.createElement(tag);
      applyElementOptions(child, options);
      this.appendChild(child);
      return enhanceElement(child);
    };

    el.createDiv = function(options = {}) {
      return this.createEl('div', options);
    };

    el.empty = function() {
      this.innerHTML = '';
      return this;
    };

    el.setText = function(text = '') {
      this.textContent = String(text);
      return this;
    };

    el.addClass = function(...classes) {
      classes.filter(Boolean).forEach((cls) => this.classList.add(cls));
      return this;
    };

    el.removeClass = function(...classes) {
      classes.filter(Boolean).forEach((cls) => this.classList.remove(cls));
      return this;
    };

    return el;
  };

  const enhancedContainer = enhanceElement(container);

  const dv = {
    container: enhancedContainer,
    current: () => ({ file: { path: "${filePath}", outlinks: [], inlinks: [] } }),
    el: (tag, text = '', options = {}) => {
      const el = document.createElement(tag);
      applyElementOptions(el, options);
      if (text && !options?.text) el.textContent = text;
      const parentEl = options.parent || enhancedContainer;
      parentEl.appendChild(el);
      return enhanceElement(el);
    },
    paragraph: (text, options = {}) => dv.el('p', text, options),
    span: (text, options = {}) => dv.el('span', text, options),
    header: (level, text, options = {}) => dv.el(\`h\${Math.min(Math.max(level, 1), 6)}\`, text, options),
    list: (items, options = {}) => {
      const ul = dv.el('ul', '', options);
      items.forEach(item => dv.el('li', item, { parent: ul }));
      return ul;
    },
    table: (headers, rows, options = {}) => {
      const table = dv.el('table', '', options);
      const thead = dv.el('thead', '', { parent: table });
      const tr = dv.el('tr', '', { parent: thead });
      headers.forEach(h => dv.el('th', h, { parent: tr }));
      const tbody = dv.el('tbody', '', { parent: table });
      rows.forEach(row => {
        const rowTr = dv.el('tr', '', { parent: tbody });
        row.forEach(cell => dv.el('td', cell, { parent: rowTr }));
      });
      return table;
    },
    // Stub for pages (not supported client-side, but prevents crashes)
    pages: (query) => {
      console.warn(\`dv.pages("\${query}") not supported in client-side rendering\`);
      return [];
    },
    // Add more Dataview API stubs as needed
  };

  // Manage WebAudioAPI instances to prevent leaks
  const audioContexts = [];
  if (typeof window.AudioContext !== 'undefined') {
    const OriginalAudioContext = window.AudioContext;
    window.AudioContext = function(...args) {
      const ctx = new OriginalAudioContext(...args);
      audioContexts.push(ctx);
      return ctx;
    };
  }

  // Observer to clean up on container removal (e.g., page navigation)
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      audioContexts.forEach(async ctx => {
        if (ctx.state !== 'closed') await ctx.close();
      });
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const code = new TextDecoder().decode(Uint8Array.from(atob("${b64}"), c => c.charCodeAt(0)));
    const trimmed = String(code || '').trim();
    const looksLikeFunctionExpr = /^(async\\s*)?\\(\\s*\\)\\s*=>/.test(trimmed)
      || /^(async\\s*)?function\\s*\\(/.test(trimmed);

    // Run normal DataviewJS blocks first (statement style).
    const fn = new AsyncFunction('dv', code);
    const directResult = await fn.call(dv, dv); // 'this' = dv for this.container
    if (typeof directResult === 'function') {
      await directResult.call(dv, dv);
    } else if (looksLikeFunctionExpr) {
      // Compatibility with blocks written as async arrow/function expressions.
      const fnExpr = new AsyncFunction('dv', 'return (' + trimmed + ');');
      const maybeFn = await fnExpr.call(dv, dv);
      if (typeof maybeFn === 'function') {
        await maybeFn.call(dv, dv);
      }
    }
  } catch (e) {
    if (container) container.innerHTML = '<div style="color:red;border:1px solid red;padding:10px;">DataviewJS Error: ' + e.message + '</div>';
    console.error(e);
  }
  } catch(err) {
    console.error("DataviewJS Fatal:", err);
  }
})();`;

  parent.children[index] = { type: 'html', value: `<div id="${id}"></div><script type="module" is:inline>${script}</script>` };
}
