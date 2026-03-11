import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { createSupabaseServerClient, json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { canonicalizeCourseId, canonicalizeCourseSlugPath } from '../../../lib/course-alias';

const BUCKET_NAME = 'live-wordclouds';
const IMAGE_WIDTH = 1600;
const IMAGE_HEIGHT = 900;
const WORD_LIMIT = 120;

const normalizeText = (value: unknown) => String(value ?? '').trim();

const slugifySegment = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';

const escapeXml = (value: unknown) =>
  normalizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const clampCount = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.round(parsed));
};

const normalizeWordCounts = (input: unknown) => {
  if (!input || typeof input !== 'object') return [];

  return Object.entries(input as Record<string, unknown>)
    .map(([term, count]) => ({
      term: normalizeText(term).replace(/\s+/g, ' ').trim(),
      count: clampCount(count),
    }))
    .filter((entry) => entry.term && entry.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.term.localeCompare(right.term, 'es');
    })
    .slice(0, WORD_LIMIT);
};

const buildWordcloudSvg = ({
  courseId,
  pageSlug,
  prompt,
  sessionId,
  words,
}: {
  courseId: string;
  pageSlug: string;
  prompt: string;
  sessionId: string;
  words: Array<{ term: string; count: number }>;
}) => {
  const padding = 72;
  const headerHeight = 180;
  const footerHeight = 72;
  const contentWidth = IMAGE_WIDTH - padding * 2;
  const contentHeight = IMAGE_HEIGHT - headerHeight - footerHeight;
  const maxCount = Math.max(...words.map((entry) => entry.count), 1);
  const minCount = Math.min(...words.map((entry) => entry.count), maxCount);

  let cursorX = padding;
  let cursorY = headerHeight;
  let lineHeight = 0;

  const wordNodes: string[] = [];
  for (const [index, entry] of words.entries()) {
    const ratio = maxCount === minCount ? 1 : (entry.count - minCount) / (maxCount - minCount);
    const fontSize = 36 + ratio * 72;
    const approxWidth = Math.max(fontSize * 1.7, entry.term.length * fontSize * 0.58);
    const approxHeight = fontSize * 1.25;

    if (cursorX + approxWidth > IMAGE_WIDTH - padding) {
      cursorX = padding;
      cursorY += lineHeight + 26;
      lineHeight = 0;
    }

    if (cursorY + approxHeight > headerHeight + contentHeight) {
      break;
    }

    const hue = (index * 41 + 19) % 360;
    const fill = `hsl(${hue} 80% 64%)`;
    const weight = ratio > 0.6 ? 700 : 500;
    const y = cursorY + fontSize;

    wordNodes.push(
      `<text x="${cursorX}" y="${y}" font-size="${fontSize.toFixed(1)}" font-weight="${weight}" fill="${fill}">${escapeXml(entry.term)}</text>`,
    );

    cursorX += approxWidth + 28;
    lineHeight = Math.max(lineHeight, approxHeight);
  }

  const totalResponses = words.reduce((sum, entry) => sum + entry.count, 0);
  const subtitle = [courseId, pageSlug].filter(Boolean).join(' / ');
  const meta = [
    `${totalResponses} aportes`,
    `${words.length} términos`,
    sessionId ? `sesión ${sessionId.slice(0, 8)}` : '',
  ].filter(Boolean).join(' · ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#050505" />
  <rect x="18" y="18" width="${IMAGE_WIDTH - 36}" height="${IMAGE_HEIGHT - 36}" rx="24" fill="none" stroke="rgba(255,255,255,0.18)" />
  <text x="${padding}" y="84" font-size="24" letter-spacing="5" fill="rgba(255,255,255,0.56)">WORDCLOUD</text>
  <text x="${padding}" y="126" font-size="48" font-weight="700" fill="#f5f7fb">${escapeXml(prompt || 'Nube de palabras')}</text>
  <text x="${padding}" y="158" font-size="22" fill="rgba(245,247,251,0.62)">${escapeXml(subtitle || 'Sala performativa')}</text>
  ${wordNodes.join('\n  ')}
  <text x="${padding}" y="${IMAGE_HEIGHT - 32}" font-size="20" fill="rgba(245,247,251,0.55)">${escapeXml(meta)}</text>
</svg>`;
};

const ensureBucket = async (supabase: ReturnType<typeof createSupabaseServerClient>) => {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (Array.isArray(buckets) && buckets.some((bucket) => bucket.name === BUCKET_NAME)) {
    return;
  }

  const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: true,
    fileSizeLimit: '5MB',
  });

  if (error && !/already exists/i.test(String(error.message || ''))) {
    throw error;
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const rawCourseId = normalizeText(body?.courseId);
  const courseId = await canonicalizeCourseId(rawCourseId);
  const pageSlug = await canonicalizeCourseSlugPath(body?.pageSlug, courseId);
  const effectiveCourseId = courseId || (pageSlug ? await canonicalizeCourseId(pageSlug.split('/')[0]) : '');
  if (!effectiveCourseId) {
    return json({ error: 'courseId required' }, 400);
  }

  const access = await resolveLiveManageAccess(session, effectiveCourseId);
  if (!access.canManage) {
    return json({ error: 'Only teachers can export wordcloud images' }, 403);
  }

  const interactionId = normalizeText(body?.interactionId) || 'wordcloud';
  const sessionId = normalizeText(body?.sessionId);
  const prompt = normalizeText(body?.prompt) || 'Nube de palabras';
  const words = normalizeWordCounts(body?.wordCounts);

  if (words.length === 0) {
    return json({ error: 'wordCounts required' }, 400);
  }

  const svg = buildWordcloudSvg({
    courseId: effectiveCourseId,
    pageSlug,
    prompt,
    sessionId,
    words,
  });

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const supabase = createSupabaseServerClient({ requireServiceRole: true });
  await ensureBucket(supabase);

  const lessonPath = pageSlug
    ? pageSlug
        .split('/')
        .slice(1)
        .filter(Boolean)
        .map((segment) => slugifySegment(segment))
        .join('/')
    : 'sin-leccion';
  const fileName = `${slugifySegment(interactionId)}-${slugifySegment(sessionId || Date.now())}.png`;
  const storagePath = `${slugifySegment(effectiveCourseId)}/${lessonPath}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, pngBuffer, {
      cacheControl: '3600',
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) {
    return json({ error: uploadError.message || 'Could not upload PNG' }, 500);
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);

  return json({
    ok: true,
    bucket: BUCKET_NAME,
    path: storagePath,
    publicUrl: publicUrlData.publicUrl,
  });
};
