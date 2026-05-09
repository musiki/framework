// Pure functions for extracting Author-year-title display names from URLs and filenames.

export type ResourceType = 'pdf' | 'img' | 'md' | 'tex' | 'ly' | 'audio' | 'link' | 'other';

const EXT_TYPE_MAP: Record<string, ResourceType> = {
  pdf: 'pdf', jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', webp: 'img', svg: 'img',
  md: 'md', markdown: 'md', tex: 'tex', ly: 'ly',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
  mov: 'audio', mp4: 'audio', webm: 'audio',
};

export function typeFromExt(ext: string): ResourceType {
  return EXT_TYPE_MAP[ext.toLowerCase()] ?? 'other';
}

export function typeFromUrl(url: string): ResourceType {
  const ext = url.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '';
  if (ext) return typeFromExt(ext);
  if (/youtu\.be|youtube\.com|vimeo\.com/.test(url)) return 'link';
  return 'link';
}

export function slugify(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function stemFromUrl(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const parts = path.split('/');
  const last = parts[parts.length - 1] || parts[parts.length - 2] || '';
  return last.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]/g, ' ').trim();
}

export function formatCandidateName(raw: string): string {
  return slugify(raw) || 'recurso';
}

export function nameFromPageTitle(title: string): string {
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';
  const clean = title.replace(/\s*[-|–—]\s*[^-|–—]*$/, '').trim();
  const slug = slugify(year ? clean.replace(year, '').trim() : clean);
  return year ? `${slug}-${year}` : slug;
}

export function extractDoi(input: string): string | null {
  const m = input.match(/\b10\.\d{4,}\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

export function extractArxivId(url: string): string | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return m ? m[1] : null;
}

export function isVideoUrl(url: string): boolean {
  return /youtu\.be|youtube\.com|vimeo\.com/.test(url);
}

export function isBookUrl(url: string): boolean {
  return /openlibrary\.org|books\.google\.com/.test(url);
}

export function quickNameFromUrl(url: string): string {
  const stem = stemFromUrl(url);
  if (stem && stem.length > 3) return formatCandidateName(stem);
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return formatCandidateName(host);
  } catch {
    return 'recurso';
  }
}

export async function resolveNameFromUrl(url: string): Promise<string> {
  const doi = extractDoi(url);
  if (doi) {
    try {
      const resp = await fetch(`https://doi.org/${doi}`, {
        headers: { Accept: 'application/vnd.citationstyles.csl+json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        const author = (data?.author?.[0]?.family ?? '').slice(0, 30);
        const year   = String(data?.issued?.['date-parts']?.[0]?.[0] ?? '');
        const title  = slugify((data?.title ?? '').slice(0, 60));
        if (author && title) return `${slugify(author)}-${year}-${title}`;
      }
    } catch { /* fall through */ }
  }

  const arxiv = extractArxivId(url);
  if (arxiv) {
    try {
      const resp = await fetch(`https://export.arxiv.org/abs/${arxiv}`, { headers: { Accept: 'application/atom+xml' } });
      if (resp.ok) {
        const xml = await resp.text();
        const title = xml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
        const year  = arxiv.slice(0, 2);
        const fullYear = Number(year) > 50 ? `19${year}` : `20${year}`;
        if (title) return slugify(title.slice(0, 60)) + (fullYear ? `-${fullYear}` : '');
      }
    } catch { /* fall through */ }
  }

  try {
    const resp = await fetch(`/api/live/recursos/resolve-title?url=${encodeURIComponent(url)}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.title) return nameFromPageTitle(data.title);
    }
  } catch { /* fall through */ }

  return quickNameFromUrl(url);
}

export function nameFromFile(file: File): string {
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return formatCandidateName(stem);
}
