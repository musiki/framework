export const VISIBILITIES = ['private', 'supervision', 'committee', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const isVisibility = (v: unknown): v is Visibility =>
  typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v);

type FolderLike = { id: string; parentId: string | null; visibility?: string | null };

export function effectiveVisibility(
  note: { visibility?: string | null; folderId?: string | null },
  foldersById: Map<string, FolderLike>,
): Visibility {
  if (isVisibility(note.visibility)) return note.visibility;
  const seen = new Set<string>();
  let id = note.folderId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = foldersById.get(id);
    if (!folder) break;
    if (isVisibility(folder.visibility)) return folder.visibility;
    id = folder.parentId;
  }
  return 'private';
}
