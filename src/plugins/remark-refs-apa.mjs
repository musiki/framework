// src/plugins/remark-refs-apa.mjs
import { visit } from 'unist-util-visit';
import { visitParents } from 'unist-util-visit-parents';

// ======== helpers texto ======== 
function trimBraces(s) {
  if (!s) return s;
  return s.replace(/^{+/, '').replace(/}+$/, '');
}
function unlatex(s) {
  if (!s) return s;
  return s
    .replace(/[{}]/g, '')
    .replace(/\&/g, '&')
    .replace(/\%/g, '%')
    .replace(/\_/g, '_')
    .replace(/\#/g, '#')
    .replace(/\textit\{([^}]*)\}/g, '$1')
    .replace(/\emph\{([^}]*)\}/g, '$1')
    .replace(/\url\{([^}]*)\}/g, '$1')
    .replace(/\doi\{([^}]*)\}/g, '$1')
    .replace(/\~{}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function sentenceCase(title) {
  if (!title) return title;
  const t = title.trim();
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1);
}

// ======== autores APA ======== 
function parseAuthors(authorStr) {
  if (!authorStr) return [];
  const parts = authorStr.split(/\s+and\s+|,\s*and\s*|;\s*/i).map(s => s.trim()).filter(Boolean);
  return parts.map(formatOneAuthor);
}
function formatOneAuthor(name) {
  let last = '', firsts = '';
  if (name.includes(',')) {
    const [a, b] = name.split(',').map(s => s.trim());
    last = a; firsts = b || '';
  } else {
    const tokens = name.split(/\s+/);
    last = tokens.pop() || '';
    firsts = tokens.join(' ');
  }
  const initials = firsts
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w[0] ? w[0].toUpperCase() + '.' : ''))
    .join(' ');
  const lastCased = last
    .split('-')
    .map(p => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('-');
  return initials ? `${lastCased}, ${initials}` : lastCased;
}
function formatAuthorsApa(authors) {
  if (authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length <= 20) return authors.slice(0, -1).join(', ') + ', & ' + authors.slice(-1);
  const first19 = authors.slice(0, 19).join(', ');
  const last = authors[authors.length - 1];
  return `${first19}, …, ${last}`;
}

// ======== año ======== 
function pickYear(entry) {
  const y = entry.year || entry.date || '';
  const m = String(y).match(/\d{4}/);
  return m ? m[0] : 's. f.';
}

// ======== formateadores APA ======== 
function j(v) { return (v && String(v).trim()) ? String(v).trim() : ''; }

function fmtArticle(e) {
  const authors = j(formatAuthorsApa(parseAuthors(e.author)));
  const year = j(pickYear(e));
  const title = j(sentenceCase(unlatex(e.title)));
  const journal = j(unlatex(e.journal || e.journaltitle));
  const volume = j(e.volume);
  const number = j(e.number ? `(${e.number})` : '');
  const pages = j(e.pages ? e.pages.replace(/--/g, '–') : '');
  const volIssue = j([volume, number].filter(Boolean).join(''));
  const doi = j(e.doi ? `https://doi.org/${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//,'')}` : '');
  const url = (!doi && e.url) ? j(e.url) : '';

  const parts = [];
  if (authors) parts.push(`${authors} (${year || 's. f.'}).`);
  if (title) parts.push(`${title}.`);
  const jpp = [journal, volIssue].filter(Boolean).join(', ');
  if (jpp) parts.push(jpp + (pages ? `, ${pages}.` : '.'));
  else if (pages) parts.push(pages + '.');
  if (doi) parts.push(doi);
  else if (url) parts.push(url);

  return parts.join(' ').replace(/\s+\./g, '.').trim();
}

function fmtBook(e) {
  const authors = j(formatAuthorsApa(parseAuthors(e.author) || parseAuthors(e.editor)));
  const year = j(pickYear(e));
  const title = j(sentenceCase(unlatex(e.title)));
  const edition = j(e.edition ? `(${e.edition} ed.)` : '');
  const publisher = j(unlatex(e.publisher || e.organization || ''));
  const doi = j(e.doi ? `https://doi.org/${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//,'')}` : '');
  const url = (!doi && e.url) ? j(e.url) : '';

  const parts = [];
  if (authors) parts.push(`${authors} (${year || 's. f.'}).`);
  if (title) parts.push(edition ? `${title}. ${edition}.` : `${title}.`);
  if (publisher) parts.push(`${publisher}.`);
  if (doi) parts.push(doi);
  else if (url) parts.push(url);

  return parts.join(' ').replace(/\s+\./g, '.').trim();
}

function fmtInProceedings(e) {
  const authors = j(formatAuthorsApa(parseAuthors(e.author)));
  const year = j(pickYear(e));
  const title = j(sentenceCase(unlatex(e.title)));
  const book = j(unlatex(e.booktitle || ''));
  const editors = j(formatAuthorsApa(parseAuthors(e.editor)));
  const pages = j(e.pages ? e.pages.replace(/--/g, '–') : '');
  const inPart = editors ? `En ${editors} (Eds.), ${book}` : (book ? `En ${book}` : '');
  const publisher = j(unlatex(e.publisher || e.organization || ''));
  const doi = j(e.doi ? `https://doi.org/${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//,'')}` : '');
  const url = (!doi && e.url) ? j(e.url) : '';

  const parts = [];
  if (authors) parts.push(`${authors} (${year || 's. f.'}).`);
  if (title) parts.push(`${title}.`);
  if (inPart) parts.push(inPart + (pages ? ` (pp. ${pages}).` : '.'));
  else if (pages) parts.push(`pp. ${pages}.`);
  if (publisher) parts.push(`${publisher}.`);
  if (doi) parts.push(doi);
  else if (url) parts.push(url);

  return parts.join(' ').replace(/\s+\./g, '.').trim();
}

function fmtGeneric(e) {
  const authors = j(formatAuthorsApa(parseAuthors(e.author || e.editor || '')));
  const year = j(pickYear(e));
  const title = j(sentenceCase(unlatex(e.title || e.howpublished || e.note || 'Entrada sin título')));
  const host = j(unlatex(e.journal || e.booktitle || e.publisher || ''));
  const doi = j(e.doi ? `https://doi.org/${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//,'')}` : '');
  const url = (!doi && e.url) ? j(e.url) : '';

  const parts = [];
  if (authors) parts.push(`${authors} (${year || 's. f.'}).`);
  if (title) parts.push(`${title}.`);
  if (host) parts.push(`${host}.`);
  if (doi) parts.push(doi);
  else if (url) parts.push(url);

  return parts.join(' ').replace(/\s+\./g, '.').trim();
}

function formatAPA(entry) {
  const t = (entry.entryType || '').toLowerCase();
  if (t === 'article') return fmtArticle(entry);
  if (t === 'book') return fmtBook(entry);
  if (t === 'inproceedings' || t === 'incollection' || t === 'conference')
    return fmtInProceedings(entry);
  return fmtGeneric(entry);
}

// ======== parser BibTeX (multi-entrada) ======== 
function parseBibTeX(source) {
  const s = (source || '').replace(/^\uFEFF/, '');
  const entries = [];
  const top = /@(\w+)\s*{\s*([^,]+)\s*,([\s\S]*?)}/g;
  let m;
  while ((m = top.exec(s)) !== null) {
    const entryType = m[1];
    const citeKey = m[2];
    const body = m[3];
    const fields = {};
    const rf = /(\w+)\s*=\s*(\{(?:[^\{\}]|\{[^\}]*\})*\}|"(?:[^"\\]|\\.)*")\s*,?/g;
    let f;
    while ((f = rf.exec(body)) !== null) {
      const k = f[1].toLowerCase();
      let v = f[2].trim();
      if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      fields[k] = unlatex(trimBraces(v));
    }
    entries.push({ entryType, citeKey, ...fields });
  }
  return entries;
}

// ======== plugin principal ======== 
export default function remarkRefsApa(options = {}) {
  const {
    headingText = 'Referencias',
    removeBibtexBlocks = true,
    showCopyBibButton = true,
    copyButtonLabel = 'Copiar BibTeX',
    copyButtonHint = 'Copiar referencias en BibTeX',
    debug = false
  } = options;

  return (tree, file) => {
    const refs = [];
    const bibtexRawTexts = [];
    const toRemove = []; // Collect all nodes to remove here

    const isCodeContext = (ancestors) =>
      ancestors.some(a => a && (a.type === 'code' || a.type === 'inlineCode'));

    // 1) <ref>…</ref> tanto en 'html' como en 'text' (evita code)
    visitParents(tree, (node) => node.type === 'html' || node.type === 'text', (node, ancestors) => {
      if (isCodeContext(ancestors)) return;
      const val = String(node.value || '');
      if (!val.includes('<ref')) return;

      const re = /<ref>([\s\S]*?)<\/ref>/gi;
      let last = 0, m, out = [], changed = false;
      while ((m = re.exec(val)) !== null) {
        const start = m.index;
        const end = re.lastIndex;
        if (start > last) out.push({ type: 'text', value: val.slice(last, start) });
        const inner = (m[1] || '').trim();
        if (inner) {
          refs.push({ kind: 'free', text: inner });
        }
        last = end; changed = true;
      }
      if (changed) {
        if (last < val.length) out.push({ type: 'text', value: val.slice(last) });
        const parent = ancestors[ancestors.length - 1];
        if (parent && Array.isArray(parent.children)) {
          const idx = parent.children.indexOf(node);
          if (idx !== -1) parent.children.splice(idx, 1, ...out);
        }
      }
    });

    // 2) fences bibtex/bib/biblatex/btx → parseo + guardo raw + (opcional) elimino
    const aliases = new Set(['bibtex', 'bib', 'biblatex', 'btx']);
    visit(tree, 'code', (node, index, parent) => {
      if (!parent) return;
      const lang = (node.lang || '').toLowerCase();
      if (!aliases.has(lang)) return;

      const raw = String(node.value || '');
      if (raw.trim()) bibtexRawTexts.push(raw);

      const entries = parseBibTeX(raw);
      for (const e of entries) {
        const apa = formatAPA(e);
        if (apa && apa.trim()) refs.push({ kind: 'bib', text: apa.trim() });
      }
      if (removeBibtexBlocks) toRemove.push({ parent, index });
    });

    // 3) Find and mark for removal existing "Referencias" heading if option is set
    if (removeBibtexBlocks) {
        visit(tree, 'heading', (node, index, parent) => {
            if (!parent || !node.children || !node.children.length) return;
            const firstChild = node.children[0];
            if (firstChild.type === 'text' && firstChild.value.trim().toLowerCase() === headingText.trim().toLowerCase()) {
                toRemove.push({ parent, index });
            }
        });
    }

    // 4) Perform all removals
    toRemove.sort((a, b) => b.index - a.index);
    for (const { parent, index } of toRemove) {
      parent.children.splice(index, 1);
    }

    if (debug && file && file.path) {
      console.warn('[remark-refs-apa]', file.path, { refsCount: refs.length });
    }

    // 5) Si hay referencias, añadir sección + botón
    if (refs.length > 0) {
      const items = refs
        .map(r => r.text)
        .filter(Boolean) // Remove empty/null strings
        .filter((txt, i, arr) => arr.indexOf(txt) === i); // dedup

      if (items.length === 0) return; // Don't render if all refs were empty

      const headingNode = {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: headingText }]
      };

      let copyGroup = [];
      if (showCopyBibButton && bibtexRawTexts.length > 0) {
        const id = `bibtex-copy-${Math.random().toString(36).slice(2)}`;
        const merged = bibtexRawTexts.join('\n\n').replace(/<\/script>/gi, '<\\/script>');
        copyGroup = [
          {
            type: 'html',
            value:
`<div class="refs-copy-wrap" style="margin:.5rem 0 1rem 0; display:flex; align-items:center; gap:.5rem;">
  <button type="button" class="refs-copy-btn" data-target="${id}" title="${copyButtonHint}" aria-label="${copyButtonHint}" style="padding:.35rem .6rem; border:1px solid var(--c-border,#ccc); border-radius:.35rem; cursor:pointer; background:#f8f8f8;">${copyButtonLabel}</button>
  <small class="refs-copy-hint" aria-hidden="true" style="opacity:.75;">${copyButtonHint}</small>
</div>`
          },
          {
            type: 'html',
            value:
`<textarea id="${id}" style="position:absolute; left:-9999px; top:-9999px;" readonly>${merged}</textarea>`
          },
          {
            type: 'html',
            value:
`<script>
(function(){
  function attach(){
    document.querySelectorAll('.refs-copy-btn[data-target]').forEach(function(btn){
      if(btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener('click', function(){
        try{
          var id = btn.getAttribute('data-target');
          var ta = document.getElementById(id);
          if(!ta) return;
          ta.select();
          document.execCommand('copy');
          var old = btn.textContent;
          btn.textContent = '¡Copiado!';
          setTimeout(function(){ btn.textContent = '${copyButtonLabel}'; }, 900);
        }catch(e){ console.error('Copy BibTeX error:', e); }
      });
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', attach);
  } else { attach(); }
  document.addEventListener && document.addEventListener('astro:page-load', attach);
})();
</script>`
          }
        ];
      }

      const listNode = {
        type: 'list',
        ordered: false,
        spread: false,
        children: items.map(txt => ({
          type: 'listItem',
          spread: false,
          checked: null,
          children: [{ type: 'paragraph', children: [{ type: 'text', value: txt }] }]
        }))
      };

      tree.children.push({ type: 'thematicBreak' });
      tree.children.push(headingNode);
      tree.children.push(...copyGroup);
      tree.children.push(listNode);
    }
  };
}
