import { glob } from 'glob';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import crypto from 'crypto';

const CONTENT_PATH = 'src/content';
const PUBLIC_PATH = 'public';
const INDEX_PATH = path.join(PUBLIC_PATH, 'search-index.json');
const EMBED_PATH = path.join(PUBLIC_PATH, 'vault-embeddings.json');
const OLLAMA_URL = process.env.CORRECTION_API_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';

// Normalization logic matching src/lib/content-slug.ts
const normalizeContentSlug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const hash = (s) => {
    return crypto.createHash('sha256').update(s || '').digest('hex');
};

async function ensureModel() {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) return false;
    const { models } = await resp.json();
    if (models.some(m => m.name.includes(EMBED_MODEL))) return true;
    
    console.log(`Model ${EMBED_MODEL} not found. Attempting to pull...`);
    await fetch(`${OLLAMA_URL}/api/pull`, {
        method: 'POST',
        body: JSON.stringify({ name: EMBED_MODEL })
    });
    return true;
  } catch(e) {
    console.warn(`[vault-index] Could not verify/pull model ${EMBED_MODEL}:`, e.message);
    return false;
  }
}

async function updateVaultIndex() {
  console.log('--- Updating Vault Index & Embeddings ---');
  
  if (!existsSync(PUBLIC_PATH)) mkdirSync(PUBLIC_PATH, { recursive: true });

  const hasOllama = await ensureModel();
  if (!hasOllama) {
      console.warn('[vault-index] Ollama unreachable or model missing. Skipping semantic embeddings, but keeping search index.');
  }

  const files = await glob('**/*.md', { cwd: CONTENT_PATH });
  console.log(`Found ${files.length} markdown files in ${CONTENT_PATH}`);

  const index = [];
  
  for (const file of files) {
    try {
        const filePath = path.join(CONTENT_PATH, file);
        const raw = readFileSync(filePath, 'utf-8');
        const { data, content } = matter(raw);

        const filename = path.basename(file, '.md');
        const title = data.title || filename;
        
        // Determine slug and courseId
        let slug = data.slug || data.shortSlug || normalizeContentSlug(filename);
        const parts = file.split(path.sep);
        
        let courseId = null;
        let isPublic = false;

        if (parts[0] === 'cursos' && parts[1]) {
            courseId = parts[1];
            isPublic = (data.visibility === 'public');
            // If it's a course lesson, slug should probably include courseId or follow course-routing logic
            // But for the search index, we often want the canonical path
            slug = file.replace(/\.md$/, '');
        } else if (parts[0] === 'public') {
            isPublic = true;
            slug = file.replace(/\.md$/, '');
        } else {
            slug = file.replace(/\.md$/, '');
        }

        const itemType = String(data.type || '').trim().toLowerCase();
        const type =
          (itemType === 'concept' && 'Concept')
          || (itemType === 'glossary' && 'Glossary')
          || (itemType === 'notes' && 'Note')
          || (itemType === 'public-note' && 'Note')
          || (courseId ? 'Lesson' : 'Note');

        const reveal = Boolean(data.reveal === true || data.reveal === 'true' || data.theme || data.slideTheme || data.revealTheme);

        index.push({
          title,
          slug: '/' + slug.replace(/\\/g, '/'),
          content: content || '',
          type,
          hasDataview: content.includes('```dataview'),
          reveal,
          isPublic,
          courseId,
          tags: Array.isArray(data.tags) ? data.tags : [],
          lastModified: new Date().toISOString()
        });
    } catch (err) {
        console.warn(`Failed to index ${file}:`, err.message);
    }
  }

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`✓ Search index created with ${index.length} entries at ${INDEX_PATH}`);

  if (!hasOllama) return;

  // --- Embeddings ---
  let embedCache = {};
  if (existsSync(EMBED_PATH)) {
    try {
        embedCache = JSON.parse(readFileSync(EMBED_PATH, 'utf-8'));
    } catch(e) {}
  }

  console.log(`Generating/Updating embeddings using ${EMBED_MODEL}...`);
  const results = { ...embedCache };
  let skipCount = 0;
  let newCount = 0;

  for (const item of index) {
    const id = item.slug;
    const contentHash = hash(item.content);

    if (results[id] && results[id].contentHash === contentHash) {
        skipCount++;
        continue;
    }

    try {
      process.stdout.write(`[${newCount + skipCount}/${index.length}] Embedding: ${item.title}... \r`);
      const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: 'POST',
        body: JSON.stringify({
          model: EMBED_MODEL,
          prompt: `${item.title}\n${item.content}`.slice(0, 5000)
        }),
        // Add a reasonable timeout for embedding
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
          console.warn(`\nFailed to embed ${id}: ${response.statusText}`);
          continue;
      }

      const { embedding } = await response.json();
      results[id] = {
        title: item.title,
        embedding,
        contentHash,
        courseId: item.courseId,
        isPublic: item.isPublic
      };
      newCount++;

      if (newCount % 5 === 0) writeFileSync(EMBED_PATH, JSON.stringify(results, null, 2));
    } catch (err) {
      console.error(`\nError embedding ${id}:`, err.message);
    }
  }

  writeFileSync(EMBED_PATH, JSON.stringify(results, null, 2));
  console.log(`\n✓ Done! Semantic map updated. New: ${newCount}, Skipped: ${skipCount}. Saved to ${EMBED_PATH}`);
}

updateVaultIndex();
