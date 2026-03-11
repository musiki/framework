// Script to build graph data from markdown files
import fs from 'node:fs';
import path from 'node:path';
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

export function buildGraphData() {
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
  
  // Build slug index
  const slugMap = new Map();
  const slugToTitle = new Map();
  
  for (const abs of files) {
    const rel = abs.slice(ROOT.length + 1);
    const posix = rel.split(path.sep).join('/');
    const raw = fs.readFileSync(abs, 'utf8');
    const fm = matter(raw);
    
    const slug = posix.replace(/\.(md|mdx)$/i, '');
    
    const base = slug.split('/').pop() || slug;
    const title = fm.data.title || base;
    
    slugMap.set(norm(slug), slug);
    slugMap.set(norm(base), slug);
    slugToTitle.set(slug, title);
  }
  
  // Build nodes and links
  const nodes = [];
  const links = [];
  const nodeIds = new Set();
  const linkSet = new Set();
  
  for (const abs of files) {
    const rel = abs.slice(ROOT.length + 1);
    const posix = rel.split(path.sep).join('/');
    const slug = posix.replace(/\.(md|mdx)$/i, '');
    
    if (slug.toLowerCase() === 'home') continue;
    
    const raw = fs.readFileSync(abs, 'utf8');
    const fm = matter(raw);
    const title = fm.data.title || slug.split('/').pop() || slug;
    const tags = Array.isArray(fm.data.tags) 
      ? fm.data.tags 
      : (fm.data.tags ? String(fm.data.tags).split(',').map(s => s.trim()) : []);
    
    // Add document node
    if (!nodeIds.has(slug)) {
      nodes.push({
        id: slug,
        name: title,
        type: 'document',
        group: slug.split('/')[0] || 'root',
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
  }
  
  return { nodes, links };
}

// Write to public directory
const graphData = buildGraphData();
const outputPath = path.resolve('public/graph-data.json');
fs.writeFileSync(outputPath, JSON.stringify(graphData, null, 2));
console.log(`Graph data written to ${outputPath}`);
console.log(`Nodes: ${graphData.nodes.length}, Links: ${graphData.links.length}`);
