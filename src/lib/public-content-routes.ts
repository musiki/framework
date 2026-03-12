import { getCollection, type CollectionEntry } from 'astro:content';
import { buildCourseLessonHref } from './course-routing';
import {
  getContentFilenameSlug,
  getContentFrontmatterSlug,
  getContentTitleSlug,
} from './content-slug';

type ContentEntry = CollectionEntry<'content'>;
type CourseEntry = CollectionEntry<'cursos'>;

export type PublicContentRouteProps =
  | {
      kind: 'content';
      entryId: string;
      canonicalSlug: string;
      presentationHref: string;
    }
  | {
      kind: 'redirect';
      redirectTo: string;
    };

export type PublicSlidesRouteProps = {
  entryId: string;
  canonicalSlug: string;
};

type PublicContentRouteIndex = {
  contentPaths: Array<{ params: { slug: string }; props: PublicContentRouteProps }>;
  slidePaths: Array<{ params: { slug: string }; props: PublicSlidesRouteProps }>;
};

let routeIndexPromise: Promise<PublicContentRouteIndex> | null = null;

const normalizeSlug = (value: unknown) => String(value || '').trim().replace(/^\/+|\/+$/g, '');

const groupBySlug = <T>(items: T[], getSlug: (item: T) => string) => {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const slug = normalizeSlug(getSlug(item));
    if (!slug) continue;
    const bucket = grouped.get(slug) || [];
    bucket.push(item);
    grouped.set(slug, bucket);
  }
  return grouped;
};

const registerUniqueMatches = <T>(
  target: Map<string, T>,
  grouped: Map<string, T[]>,
) => {
  for (const [slug, items] of grouped.entries()) {
    if (items.length !== 1) continue;
    if (target.has(slug)) continue;
    target.set(slug, items[0]);
  }
};

const getCanonicalSlugByEntryId = (routeBySlug: Map<string, ContentEntry>) => {
  const canonicalSlugByEntryId = new Map<string, string>();
  for (const [slug, entry] of routeBySlug.entries()) {
    if (!canonicalSlugByEntryId.has(entry.id)) {
      canonicalSlugByEntryId.set(entry.id, slug);
    }
  }
  return canonicalSlugByEntryId;
};

const hasPresentationTheme = (entry: ContentEntry) => {
  const data = (entry.data || {}) as Record<string, unknown>;
  return Boolean(
    typeof data.theme === 'string' && data.theme.trim()
    || typeof data.slideTheme === 'string' && data.slideTheme.trim()
    || typeof data.revealTheme === 'string' && data.revealTheme.trim(),
  );
};

const buildContentRouteIndex = async (): Promise<PublicContentRouteIndex> => {
  const [contentEntries, courseEntries] = await Promise.all([
    getCollection('content'),
    getCollection('cursos'),
  ]);

  const contentEntryBySlug = new Map<string, ContentEntry>();
  registerUniqueMatches(contentEntryBySlug, groupBySlug(contentEntries, getContentFrontmatterSlug));
  registerUniqueMatches(contentEntryBySlug, groupBySlug(contentEntries, getContentFilenameSlug));
  registerUniqueMatches(contentEntryBySlug, groupBySlug(contentEntries, getContentTitleSlug));

  const canonicalSlugByEntryId = getCanonicalSlugByEntryId(contentEntryBySlug);
  const contentPaths: Array<{ params: { slug: string }; props: PublicContentRouteProps }> = [];
  const slidePaths: Array<{ params: { slug: string }; props: PublicSlidesRouteProps }> = [];

  for (const [slug, entry] of contentEntryBySlug.entries()) {
    const canonicalSlug = canonicalSlugByEntryId.get(entry.id) || slug;
    const presentationHref = hasPresentationTheme(entry) ? `/slides/${canonicalSlug}` : '';

    if (slug === canonicalSlug) {
      contentPaths.push({
        params: { slug },
        props: {
          kind: 'content',
          entryId: entry.id,
          canonicalSlug,
          presentationHref,
        },
      });

      if (presentationHref) {
        slidePaths.push({
          params: { slug: canonicalSlug },
          props: {
            entryId: entry.id,
            canonicalSlug,
          },
        });
      }

      continue;
    }

    contentPaths.push({
      params: { slug },
      props: {
        kind: 'redirect',
        redirectTo: `/${canonicalSlug}`,
      },
    });
  }

  const courseIndexById = new Map<string, CourseEntry>();
  const courseLessons = courseEntries.filter((entry) => {
    const isIndex = entry.id.endsWith('/_index') || entry.id.endsWith('_index');
    if (isIndex) {
      const courseId = entry.id.replace(/\/_index$/, '').replace(/_index$/, '');
      if (courseId) courseIndexById.set(courseId, entry);
      return false;
    }
    return true;
  });

  const courseFilenameRedirects = new Map<string, CourseEntry>();
  registerUniqueMatches(courseFilenameRedirects, groupBySlug(courseLessons, getContentFilenameSlug));

  const courseTitleRedirects = new Map<string, CourseEntry>();
  const courseLessonsByTitle = groupBySlug(courseLessons, getContentTitleSlug);
  for (const [slug, items] of courseLessonsByTitle.entries()) {
    if (items.length !== 1) continue;
    if (contentEntryBySlug.has(slug) || courseFilenameRedirects.has(slug)) continue;
    courseTitleRedirects.set(slug, items[0]);
  }

  const appendCourseRedirect = (slug: string, entry: CourseEntry) => {
    if (contentEntryBySlug.has(slug)) return;
    const courseId = String(entry.id.split('/')[0] || '').trim();
    if (!courseId) return;
    const courseIndex = courseIndexById.get(courseId);
    const redirectTo = buildCourseLessonHref(
      courseId,
      (courseIndex?.data || {}) as Record<string, unknown>,
      entry,
    );

    contentPaths.push({
      params: { slug },
      props: {
        kind: 'redirect',
        redirectTo,
      },
    });
  };

  for (const [slug, entry] of courseFilenameRedirects.entries()) {
    appendCourseRedirect(slug, entry);
  }
  for (const [slug, entry] of courseTitleRedirects.entries()) {
    appendCourseRedirect(slug, entry);
  }

  return { contentPaths, slidePaths };
};

const getRouteIndex = async () => {
  if (!routeIndexPromise) {
    routeIndexPromise = buildContentRouteIndex();
  }
  return routeIndexPromise;
};

export const getPublicContentStaticPaths = async () => {
  const { contentPaths } = await getRouteIndex();
  return contentPaths;
};

export const getPublicSlidesStaticPaths = async () => {
  const { slidePaths } = await getRouteIndex();
  return slidePaths;
};
