type ContentEntryLike = {
  id: string;
  data?: Record<string, unknown>;
};

export const normalizeContentSlug = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getFilenameStem = (entryId: string) =>
  String(entryId || '')
    .split('/')
    .pop()
    ?.replace(/\.[^/.]+$/, '') || '';

export const getContentFrontmatterSlug = (entry: ContentEntryLike) =>
  normalizeContentSlug(entry?.data?.slug || entry?.data?.shortSlug);

export const getContentFilenameSlug = (entry: ContentEntryLike) =>
  normalizeContentSlug(getFilenameStem(entry.id));

export const getContentTitleSlug = (entry: ContentEntryLike) =>
  normalizeContentSlug(entry?.data?.title);

export const getContentCanonicalSlug = (entry: ContentEntryLike) =>
  getContentFrontmatterSlug(entry)
  || getContentFilenameSlug(entry)
  || getContentTitleSlug(entry);
