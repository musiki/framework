import { getCollection } from 'astro:content';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const srcContentDir = path.resolve(thisDir, '../content');

const isEmptyCollectionError = (error: unknown, collectionName: string) => {
  const message = String((error as any)?.message || error || '');
  return (
    message.includes(`The collection "${collectionName}" does not exist or is empty.`)
    || message.includes(`The collection "${collectionName}" does not exist or is empty`)
  );
};

const hasCollectionContentFiles = (directory: string): boolean => {
  let entries: string[] = [];
  try {
    entries = readdirSync(directory);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry === 'cursos' || entry === 'blog') continue;

    const fullPath = path.join(directory, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (hasCollectionContentFiles(fullPath)) return true;
      continue;
    }

    if (stats.isFile() && /\.(md|mdx)$/i.test(entry)) {
      return true;
    }
  }

  return false;
};

export async function safeGetCollection<T = any>(collectionName: string): Promise<T[]> {
  if (collectionName === 'content' && !hasCollectionContentFiles(srcContentDir)) {
    return [];
  }

  try {
    return await getCollection(collectionName as any);
  } catch (error) {
    if (isEmptyCollectionError(error, collectionName)) {
      return [];
    }
    throw error;
  }
}
