import { query, getClient } from '../../db/pool';
import * as core from './space-notes-core.ts';
import type { QueryFn } from './access-core.ts';

export { SpaceNotesError } from './space-notes-core.ts';

export const getMemberRole = (spaceId: string, userId: string) => core.getMemberRole(query, spaceId, userId);

export const listSpaceTree = (args: Parameters<typeof core.listSpaceTree>[1]) => core.listSpaceTree(query, args);

export const getSpaceNote = (args: Parameters<typeof core.getSpaceNote>[1]) => core.getSpaceNote(query, args);

export const createSpaceNote = (args: Parameters<typeof core.createSpaceNote>[1]) => core.createSpaceNote(query, args);

export const updateSpaceNote = (args: Parameters<typeof core.updateSpaceNote>[1]) => core.updateSpaceNote(query, args);

export const deleteSpaceNote = (args: Parameters<typeof core.deleteSpaceNote>[1]) => core.deleteSpaceNote(query, args);

export const createSpaceFolder = (args: Parameters<typeof core.createSpaceFolder>[1]) => core.createSpaceFolder(query, args);

export const renameSpaceFolder = (args: Parameters<typeof core.renameSpaceFolder>[1]) => core.renameSpaceFolder(query, args);

export const moveSpaceFolder = (args: Parameters<typeof core.moveSpaceFolder>[1]) => core.moveSpaceFolder(query, args);

export const deleteSpaceFolder = (args: Parameters<typeof core.deleteSpaceFolder>[1]) => core.deleteSpaceFolder(query, args);

export const setFolderVisibility = (args: Parameters<typeof core.setFolderVisibility>[1]) =>
  core.setFolderVisibility(query, args);

export const ensureOkaFolders = (args: Parameters<typeof core.ensureOkaFolders>[1]) => core.ensureOkaFolders(query, args);

/**
 * `reorderSpaceItem` issues several statements (BEGIN/UPDATE.../COMMIT) that
 * must run against the same connection, so — unlike every other export here,
 * which can safely use the pool's retrying `query` per-call — it checks out
 * a single client and binds `q` to it for the whole core call.
 */
export async function reorderSpaceItem(
  args: Parameters<typeof core.reorderSpaceItem>[1],
): ReturnType<typeof core.reorderSpaceItem> {
  const client = await getClient();
  const q: QueryFn = async (text, params = []) => {
    try {
      const res = await client.query(text, params as any[]);
      return { data: res.rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };
  try {
    const result = await core.reorderSpaceItem(q, args);
    client.release();
    return result;
  } catch (err) {
    // The transaction failed (core already issued ROLLBACK on its own `q`
    // before rethrowing) — release with the error so pg discards this
    // connection instead of returning a possibly still-mid-rollback or
    // otherwise suspect connection to the pool for reuse.
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
