// Script to build graph data from markdown files
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWikilinks(content) {
  const regex = /\[\[([^\]]+)\]\]/g;
  const links = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    let inner = match[1].trim();
    let target = inner;
    
    const barIndex = inner.indexOf('|');
    if (barIndex > -1) {
      target = inner.substring(0, barIndex).trim();
    }
    
    const hashIndex = target.indexOf('#');
    if (hashIndex > -1) {
      target = target.substring(0, hashIndex).trim();
    }
    
    if (target) links.push(target);
  }

  return links;
}

// Targets declared in frontmatter relation fields (hypo / hyper / connect).
// Accepts an array or a single value; entries may be `[[wikilink]]`, `[[a|alias]]`
// or a bare slug/title.
function extractRelationTargets(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of items) {
    const s = String(item || '').trim();
    if (!s) continue;
    const wl = extractWikilinks(s);
    if (wl.length) {
      out.push(...wl);
    } else {
      out.push(s.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim());
    }
  }
  return out.filter(Boolean);
}

const isPublicStatus = (data) => String(data?.status || '').trim().toLowerCase() === 'public';

// Short plain-text excerpt from markdown body: drops frontmatter leftovers,
// headings, code fences, images and wikilink/link syntax; keeps the first
// paragraphs up to ~300 chars for the graph hover preview.
function makeExcerpt(content, maxChars = 300) {
  let text = String(content || '');
  text = text.replace(/```[\s\S]*?```/g, ' ');           // code fences
  text = text.replace(/<[^>]+>/g, ' ');                   // html tags (grids, img, iframe)
  text = text.replace(/%%[\s\S]*?%%/g, ' ');             // obsidian comments
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');      // images
  text = text.replace(/^#{1,6}\s+.*$/gm, ' ');            // headings
  text = text.replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, '$1'); // wikilinks
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');    // md links
  text = text.replace(/[*_`>#]/g, ' ');                   // residual md marks
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + '…';
  }
  return text;
}

export function buildGraphData({ publicOnly = false } = {}) {
  const ROOT = path.resolve('src/content');
  const files = [];
  
  // Walk directory
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mdx)$/i.test(e.name)) files.push(p);
    }
  })(ROOT);
  
  const fileRecords = files.map((abs) => {
    const rel = abs.slice(ROOT.length + 1);
    const posix = rel.split(path.sep).join('/');
    const raw = fs.readFileSync(abs, 'utf8');
    const fm = matter(raw);
    const slug = posix.replace(/\.(md|mdx)$/i, '');
    const base = slug.split('/').pop() || slug;
    const title = fm.data.title || base;
    const publicStatus = isPublicStatus(fm.data);
    return { abs, posix, raw, fm, slug, base, title, isPublic: publicStatus };
  }).filter((record) => record.slug.toLowerCase() !== 'home');

  const visibleRecords = publicOnly
    ? fileRecords.filter((record) => record.isPublic)
    : fileRecords;

  // Build slug index
  const slugMap = new Map();
  const slugToTitle = new Map();

  for (const record of visibleRecords) {
    slugMap.set(norm(record.slug), record.slug);
    slugMap.set(norm(record.base), record.slug);
    slugToTitle.set(record.slug, record.title);
  }
  
  // Build nodes and links
  const nodes = [];
  const links = [];
  const nodeIds = new Set();
  const linkSet = new Set();
  
  for (const record of visibleRecords) {
    const { posix, slug, fm, title } = record;
    const tags = Array.isArray(fm.data.tags) 
      ? fm.data.tags 
      : (fm.data.tags ? String(fm.data.tags).split(',').map(s => s.trim()) : []);
    
    // Add document node
    if (!nodeIds.has(slug)) {
      const parts = posix.split('/');
      const publicFolder = parts[0] === 'public' && parts.length > 1 ? parts[1] : null;

      // Canonical slug: frontmatter slug > normalized filename
      const normalizeSlug = (v) =>
        String(v || '').trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const base = slug.split('/').pop() || slug;
      const canonicalSlug = normalizeSlug(fm.data.slug || fm.data.shortSlug || base);

      // Course identity for the view filter: cursos/<courseId>/… or frontmatter project.
      const course = (parts[0] === 'cursos' && parts.length > 1)
        ? parts[1]
        : (fm.data.project ? String(fm.data.project).trim() : null);

      nodes.push({
        id: slug,
        name: title,
        type: 'document',
        group: slug.split('/')[0] || 'root',
        publicFolder: publicFolder || null,
        course: course || null,
        isPublic: record.isPublic,
        status: String(fm.data.status || '').trim().toLowerCase(),
        canonicalSlug,
        def: fm.data.def ? String(fm.data.def).trim() : '',
        excerpt: makeExcerpt(fm.content),
        img: fm.data.img || fm.data.coverUrl || fm.data.image || fm.data.photo || ''
      });
      nodeIds.add(slug);
    }
    
    // Add tag nodes and links
    for (const tag of tags) {
      const tagId = `tag:${tag}`;
      if (!nodeIds.has(tagId)) {
        nodes.push({
          id: tagId,
          name: tag,
          type: 'tag',
          group: 'tags'
        });
        nodeIds.add(tagId);
      }
      
      const linkId = `${slug}->${tagId}`;
      if (!linkSet.has(linkId)) {
        links.push({
          source: slug,
          target: tagId,
          type: 'tag'
        });
        linkSet.add(linkId);
      }
    }
    
    // Extract and add wikilinks
    const wikilinks = extractWikilinks(fm.content);
    for (const link of wikilinks) {
      const targetSlug = slugMap.get(norm(link));
      if (targetSlug && targetSlug !== slug) {
        const linkId = `${slug}->${targetSlug}`;
        if (!linkSet.has(linkId)) {
          links.push({
            source: slug,
            target: targetSlug,
            type: 'link'
          });
          linkSet.add(linkId);
        }
      }
    }

    // Typed relations from frontmatter (hypo / hyper / connect).
    // These power branch isolation and topos highlighting in the graph.
    for (const relType of ['hypo', 'hyper', 'connect']) {
      const relTargets = extractRelationTargets(fm.data?.[relType]);
      for (const ref of relTargets) {
        const targetSlug = slugMap.get(norm(ref));
        if (targetSlug && targetSlug !== slug) {
          const linkId = `${slug}->${targetSlug}:${relType}`;
          if (!linkSet.has(linkId)) {
            links.push({
              source: slug,
              target: targetSlug,
              type: 'rel',
              relType,
            });
            linkSet.add(linkId);
          }
        }
      }
    }
  }
  
  return { nodes, links };
}

export function buildSearchIndex({ publicOnly = true } = {}) {
  const ROOT = path.resolve('src/content');
  const files = [];
  
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mdx)$/i.test(e.name)) files.push(p);
    }
  })(ROOT);

  const index = [];
  for (const abs of files) {
    const rel = abs.slice(ROOT.length + 1);
    const posix = rel.split(path.sep).join('/');
    const slug = posix.replace(/\.(md|mdx)$/i, '');
    
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      const { data } = matter(raw);
      if (publicOnly && !isPublicStatus(data)) continue;
      
      if (data.title) {
        const parts = slug.split('/');
        let courseId = null;
        let finalSlug = slug;

        if (parts[0] === 'cursos' && parts.length > 1) {
            courseId = parts[1];
            // Lesson slug is everything after cursos/courseId
            finalSlug = parts.slice(2).join('/');
        }

        index.push({
          slug: finalSlug,
          title: data.title,
          description: data.description || '',
          theme: data.theme || null,
          reveal: data.reveal === true || data.reveal === 'true',
          type: data.type || null,
          courseId,
          isPublic: isPublicStatus(data)
        });
      }
    } catch (e) {
      console.warn(`Error indexing ${abs}:`, e.message);
    }
  }
  return index;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // Public static artifacts must never expose non-curated course/private notes.
  const graphData = buildGraphData({ publicOnly: true });
  const graphPath = path.resolve('public/graph-data.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(graphData, null, 2));
  console.log(`Public graph data written to ${graphPath}`);

  const searchIndex = buildSearchIndex({ publicOnly: true });
  const indexPath = path.resolve('public/search-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(searchIndex, null, 2));
  console.log(`Public search index written to ${indexPath} with ${searchIndex.length} entries.`);
}
