import { getCollection, type CollectionEntry } from 'astro:content';
import { getContentFrontmatterSlug, getContentFilenameSlug, getContentTitleSlug } from './content-slug';

type CourseEntry = CollectionEntry<'cursos'>;

export interface ConceptIndexEntry {
  id: string;
  title: string;
  slug: string;
  type: 'concept' | 'glossary';
  description: string;
  firstParagraph: string;
}

export interface ConceptLookup {
  term: string;
  slug: string;
  type: 'concept' | 'glossary';
}

let cachedIndex: ConceptIndexEntry[] | null = null;
let cachedLookup: ConceptLookup[] | null = null;

const pluralizeSpanish = (word: string) => {
  if (word.endsWith('z')) return word.slice(0, -1) + 'ces';
  if (word.endsWith('s') || word.endsWith('x')) return word;
  if (/[aeiouáéíóú]$/i.test(word)) return word + 's';
  return word + 'es';
};

const pluralizeEnglish = (word: string) => {
  if (word.endsWith('y')) {
    if (/[aeiou]$/i.test(word.slice(-2, -1))) return word + 's';
    return word.slice(0, -1) + 'ies';
  }
  if (/(s|ss|sh|ch|x|o)$/i.test(word)) return word + 'es';
  return word + 's';
};

const extractFirstParagraph = (body: string): string => {
  if (!body) return '';
  // Remove frontmatter if present (though body should be already stripped in some contexts)
  const content = body.replace(/^---[\s\S]*?---/m, '').trim();
  const paragraphs = content.split(/\n\s*\n/);
  const first = paragraphs.find(p => p.trim() && !p.trim().startsWith('#') && !p.trim().startsWith('!')) || '';
  // Clean basic markdown from it
  return first.replace(/\[\[(.*?)\]\]/g, '$1')
              .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
              .replace(/[*_`]/g, '')
              .slice(0, 300);
};

export const buildConceptIndex = async (force = false): Promise<{ index: ConceptIndexEntry[], lookup: ConceptLookup[] }> => {
  if (!force && cachedIndex && cachedLookup) {
    return { index: cachedIndex, lookup: cachedLookup };
  }

  const courseEntries = await getCollection('cursos');
  const concepts = courseEntries.filter(entry => {
    const type = String(entry.data.type || '').trim().toLowerCase();
    const status = String(entry.data.status || '').trim().toLowerCase();
    return (type === 'concept' || type === 'glossary') && (status === 'public' || status === 'published' || entry.data.public === true);
  });

  const index: ConceptIndexEntry[] = [];
  const lookup: ConceptLookup[] = [];

  for (const entry of concepts) {
    const type = String(entry.data.type || '').trim().toLowerCase() as 'concept' | 'glossary';
    const slug = getContentFrontmatterSlug(entry) || getContentFilenameSlug(entry) || getContentTitleSlug(entry);
    const title = entry.data.title || slug;
    
    index.push({
      id: entry.id,
      title,
      slug,
      type,
      description: entry.data.summary || entry.data.description || '',
      firstParagraph: extractFirstParagraph(entry.body),
    });

    const terms = new Set<string>();
    terms.add(title.toLowerCase());
    
    const aliases = Array.isArray(entry.data.alias) 
      ? entry.data.alias 
      : entry.data.alias 
        ? [String(entry.data.alias)] 
        : [];
    
    for (const alias of aliases) {
      terms.add(String(alias).toLowerCase());
    }

    // Relaxed rules: plurals
    const currentTerms = Array.from(terms);
    for (const term of currentTerms) {
      terms.add(pluralizeSpanish(term).toLowerCase());
      terms.add(pluralizeEnglish(term).toLowerCase());
    }

    for (const term of terms) {
      if (term.length < 3) continue; // Skip very short terms to avoid false positives
      lookup.push({
        term,
        slug,
        type,
      });
    }
  }

  // Sort lookup by term length descending to match longest terms first
  lookup.sort((a, b) => b.term.length - a.term.length);

  cachedIndex = index;
  cachedLookup = lookup;

  return { index, lookup };
};
