export type NoteListItem = {
  slug: string;
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme?: string;
  filePath: string;
};

export type NoteContent = {
  slug: string;
  content: string;
  filePath: string;
};
