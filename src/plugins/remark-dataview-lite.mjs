import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export default function remarkDataviewLite() {
  return (tree, file) => {
    const ROOT = path.resolve(process.cwd(), 'src/content');
    const files = getAllMarkdownFiles(ROOT);

    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'dataview' && node.lang !== 'dataviewjs') return;

      const command = String(node.value || '').trim();
      let tag = null;

      let config = {};
      if (node.meta) {
        const metaStr = node.meta.trim();
        if (metaStr.startsWith('{')) {
          try {
            config = JSON.parse(metaStr);
          } catch (e) {
            // Silently ignore invalid meta
          }
        }
      }

      if (node.lang === 'dataviewjs') {
        const match = command.match(/dv\.pages\(\s*['"]#([^'"]+)['"]\s*\)/);
        if (match) {
          tag = match[1];
        } else {
          renderClientSideDataviewJS(node, index, parent, command, config, file, ROOT);
          return;
        }
      } else if (node.lang === 'dataview' && command.startsWith('list from #')) {
        tag = command.replace('list from #', '').trim();
      }

      if (tag) {
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
    try {
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
    } catch (e) {
      // Skip files that can't be read or parsed
    }
  }

  if (matchingFiles.length > 0) {
    const listItems = matchingFiles.map(file => `<li><a href="/${file.slug}">${file.title}</a></li>`).join('');
    const html = `<div class="dvlist"><ul class="dvlist-items">${listItems}</ul></div>`;
    parent.children[index] = { type: 'html', value: html };
  } else {
    parent.children[index] = { type: 'html', value: `<div class="dvlist dvlist--empty">No content found with tag #${tag}</div>` };
  }
}

function renderClientSideDataviewJS(node, index, parent, command, config, file, ROOT) {
  const id = 'dvjs-' + Math.random().toString(36).slice(2);
  const encodedCommand = JSON.stringify(command);
  const sanitizedFilePath = (file && file.path ? path.relative(ROOT, file.path).split(path.sep).join('/') : '')
    .replace(/\\/g, '/')
    .replace(/"/g, '&quot;');

  let imports = '';
  const libMap = {
    three: 'https://cdn.skypack.dev/three@latest',
    'three.js': 'https://cdn.skypack.dev/three@latest',
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
(function() {
  try {
    const container = document.getElementById('${id}');
    if (!container) return;

    const dv = {
      container,
      current: () => ({ file: { path: "${sanitizedFilePath}", outlinks: [], inlinks: [] } }),
      el: (tag, text = '', options = {}) => {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
        if (options.attr) {
          for (const [key, value] of Object.entries(options.attr)) {
            el.setAttribute(key, value);
          }
        }
        const parentEl = options.parent || container;
        parentEl.appendChild(el);
        return el;
      },
      paragraph: (text, options = {}) => dv.el('p', text, options),
      span: (text, options = {}) => dv.el('span', text, options),
      header: (level, text, options = {}) => dv.el('h' + Math.min(Math.max(level, 1), 6), text, options),
      list: (items, options = {}) => {
        const ul = dv.el('ul', '', options);
        items.forEach(item => dv.el('li', item, { parent: ul }));
        return ul;
      },
      table: (headers, rows, options = {}) => {
        const table = dv.el('table', '', options);
        const thead = dv.el('thead', '', { parent: table });
        const tr = dv.el('tr', '', { parent: table });
        headers.forEach(h => dv.el('th', h, { parent: tr }));
        const tbody = dv.el('tbody', '', { parent: table });
        rows.forEach(row => {
          const rowTr = dv.el('tr', '', { parent: tbody });
          row.forEach(cell => dv.el('td', cell, { parent: rowTr }));
        });
        return table;
      },
      pages: (query) => {
        console.warn('dv.pages("' + query + '") not supported in client-side rendering');
        return [];
      }
    };

    const audioContexts = [];
    if (typeof window.AudioContext !== 'undefined') {
      const OriginalAudioContext = window.AudioContext;
      window.AudioContext = function(...args) {
        const ctx = new OriginalAudioContext(...args);
        audioContexts.push(ctx);
        return ctx;
      };
    }

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
      const code = ${encodedCommand};
      const fn = new AsyncFunction('dv', code);
      fn.call(dv, dv);
    } catch (e) {
      if (container) container.innerHTML = '<div style=\"color:red;border:1px solid red;padding:10px;\">DataviewJS Error: ' + e.message.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
      console.error(e);
    }
  } catch(err) {
    console.error("DataviewJS Fatal:", err);
  }
})();`;

  parent.children[index] = { 
    type: 'html', 
    value: `<div id="${id}" class="dataviewjs-container"></div><script type="module">${script}</script>` 
  };
}
