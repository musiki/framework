// What happens to a user's mm (space-scoped) content when the user record
// goes away. Pure module: `q` is injected (tests: user-content.test.mjs).
//
// - Merge (src/lib/user-email.ts mergeUsers): every user column below is
//   re-pointed from the merged user to the kept one BEFORE the merged User row
//   is deleted, so forum ON DELETE CASCADE never wipes threads/posts/boards and
//   concept credit is kept. Votes are unique per (post, user): a merged vote on
//   a post the kept user already voted on is dropped, the rest move.
//   Relation stances are BLIND until their relation is revealed, so a merge
//   must not hand them to another account (an admin merging someone into their
//   own account would read that person's votes as "my stance"): the merged
//   user's stances on relations that are NOT yet revealed are DELETED; only
//   stances on revealed relations move (deduped like votes).
// - Delete (src/pages/api/admin/users/[id].ts): refused (409) while the user
//   has any space-scoped forum rows or concept rows; the admin merges instead.
//   Relation stances are not counted: they are deleted with the account (FK
//   ON DELETE CASCADE, spec "Deleting an account deletes its stances").

import { REVEALED_SQL } from './stances-core.ts';

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ data: any[] | null; error: any }>;

/** User-reference columns re-pointed wholesale from the merged user to the kept one. */
export const MERGE_REPOINT_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['Concept', 'createdBy'],
  ['ConceptVersion', 'editedBy'],
  ['ConceptVersion', 'creditedUserId'],
  ['ConceptRelation', 'createdBy'],
  ['ConceptRelation', 'settledBy'],
  ['RelationType', 'createdBy'],
  ['ForumBoard', 'createdByUserId'],
  ['ForumThread', 'createdByUserId'],
  ['ForumPost', 'authorUserId'],
];

/** Unique-per-user rows: [table, user column, the other columns of the unique key]. */
export const MERGE_DEDUPE_COLUMNS: ReadonlyArray<readonly [table: string, column: string, keyColumns: readonly string[]]> = [
  ['ForumPostVote', 'userId', ['postId']],
  // One stance per (relation, user): where both accounts took a stance the kept user's stays.
  // Only stances on revealed relations are still there to move (see MERGE_DROP_BLIND_STANCES_SQL).
  ['ConceptRelationStance', 'userId', ['relationId']],
];

/**
 * Runs first, with [mergeId]: deletes the merged user's stances on relations
 * whose stances are not revealed yet (`IS NOT TRUE`: anything not provably
 * revealed counts as blind).
 */
export const MERGE_DROP_BLIND_STANCES_SQL = `DELETE FROM "ConceptRelationStance" m USING "ConceptRelation" r
      WHERE m."userId" = $1 AND r."id" = m."relationId" AND (${REVEALED_SQL}) IS NOT TRUE`;

/** Missing table/column: the mm migration is not applied on this database, nothing to do. */
const isMissingSchema = (error: any) => error && (error.code === '42P01' || error.code === '42703');

export async function repointMergedUserContent(
  q: QueryFn,
  keepId: string,
  mergeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Blind stances never change hands. If this cannot run (other than "no such
  // table/column"), abort: moving on would re-point them below.
  const blind = await q(MERGE_DROP_BLIND_STANCES_SQL, [mergeId]);
  if (blind.error && !isMissingSchema(blind.error)) return { ok: false, error: blind.error.message };
  for (const [table, column, keys] of MERGE_DEDUPE_COLUMNS) {
    // Blind stances could not be dropped (e.g. no "revealAt" column yet): move none;
    // they go with the merged account (FK cascade).
    if (blind.error && table === 'ConceptRelationStance') continue;
    const match = keys.map((k) => `k."${k}" = m."${k}"`).join(' AND ');
    const del = await q(
      `DELETE FROM "${table}" m WHERE m."${column}" = $2
        AND EXISTS (SELECT 1 FROM "${table}" k WHERE k."${column}" = $1 AND ${match})`,
      [keepId, mergeId],
    );
    if (del.error && !isMissingSchema(del.error)) return { ok: false, error: del.error.message };
    if (del.error) continue;
    const upd = await q(`UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`, [keepId, mergeId]);
    if (upd.error && !isMissingSchema(upd.error)) return { ok: false, error: upd.error.message };
  }
  for (const [table, column] of MERGE_REPOINT_COLUMNS) {
    const { error } = await q(`UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`, [keepId, mergeId]);
    if (error && !isMissingSchema(error)) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** One EXISTS probe per kind of row; a probe whose table/column is missing counts as none. */
export const SPACE_CONTENT_PROBES: ReadonlyArray<readonly [label: string, sql: string]> = [
  ['forum boards', `SELECT 1 FROM "ForumBoard" WHERE "createdByUserId" = $1 AND "spaceId" IS NOT NULL LIMIT 1`],
  ['forum threads', `SELECT 1 FROM "ForumThread" WHERE "createdByUserId" = $1 AND "spaceId" IS NOT NULL LIMIT 1`],
  [
    'forum posts',
    `SELECT 1 FROM "ForumPost" p JOIN "ForumThread" t ON t."id" = p."threadId"
      WHERE p."authorUserId" = $1 AND t."spaceId" IS NOT NULL LIMIT 1`,
  ],
  [
    'forum votes',
    `SELECT 1 FROM "ForumPostVote" v JOIN "ForumPost" p ON p."id" = v."postId" JOIN "ForumThread" t ON t."id" = p."threadId"
      WHERE v."userId" = $1 AND t."spaceId" IS NOT NULL LIMIT 1`,
  ],
  ['concepts', `SELECT 1 FROM "Concept" WHERE "createdBy" = $1 LIMIT 1`],
  ['concept versions', `SELECT 1 FROM "ConceptVersion" WHERE "editedBy" = $1 OR "creditedUserId" = $1 LIMIT 1`],
  ['concept relations', `SELECT 1 FROM "ConceptRelation" WHERE "createdBy" = $1 LIMIT 1`],
];

/** Labels of the kinds of space-scoped (mm) content the user has; [] when none. */
export async function findSpaceScopedContent(q: QueryFn, userId: string): Promise<string[]> {
  const found: string[] = [];
  for (const [label, sql] of SPACE_CONTENT_PROBES) {
    const { data, error } = await q(sql, [userId]);
    if (error) {
      if (isMissingSchema(error)) continue;
      throw new Error(error.message || 'space content check failed');
    }
    if (data && data.length) found.push(label);
  }
  return found;
}

export const deleteBlockedMessage = (labels: string[]) =>
  `This user has community content (${labels.join(', ')}) that deleting would remove or orphan. ` +
  'Merge the account into another user instead (POST /api/admin/users/merge).';
