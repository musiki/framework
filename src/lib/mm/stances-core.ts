// mm relation stances: agreement on a relation, BLIND, THEN REVEALED
// (spec docs/superpowers/specs/2026-09-30-mm-relation-modeler-design.md,
// "Agreement — blind, then revealed"; plan Global Constraints).
//
// Members (not guests) mark `agree` / `disagree` on a relation: one stance per
// user, changeable; withdrawing deletes the row (no trace).
//
// SECURITY INVARIANT — enforced in SQL, not in callers:
//   * reveal time = COALESCE(settledAt, createdAt + stanceRevealDays days),
//     stanceRevealDays from Space.settings (default 14, clamped 1–90);
//   * before the reveal, NOTHING in this module returns who holds which stance,
//     for any role (admins and curators included): the only statement that
//     reads a name next to a stance (STANCE_NAMES_SQL) carries
//     `now() >= <reveal time>` in its WHERE clause, so before the reveal the
//     database returns no rows at all;
//   * after the reveal, names go to members, curators and admins of the space
//     only (the same statement checks the viewer's membership); guests and the
//     public get totals;
//   * a viewer's own stance is read by (relationId, viewer's own id) only;
//   * no statement here returns a stance holder's user id or e-mail — names are
//     display names through `publicName`.
// Totals (agree / disagree counts) are public.
//
// Pure module: no astro/db imports; `q` first (relations.ts binds it).

import { ConceptError, authorize, run, requireUuid, userRef, type QueryFn, type UserRef } from './concepts-core.ts';
import { isUuid } from '../tenant/space-roles.ts';
import { publicName } from './view.ts';

export const STANCES = ['agree', 'disagree'] as const;
export type Stance = (typeof STANCES)[number];
export const isStance = (v: unknown): v is Stance => v === 'agree' || v === 'disagree';

export const STANCE_REVEAL_DAYS_DEFAULT = 14;
export const STANCE_REVEAL_DAYS_MIN = 1;
export const STANCE_REVEAL_DAYS_MAX = 90;

/** The space's `stanceRevealDays` setting: a number clamped to 1–90, else the default 14. Mirrors REVEAL_DAYS_SQL. */
export function stanceRevealDays(settings: unknown): number {
  let obj: unknown = settings;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      obj = null;
    }
  }
  const raw = obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>).stanceRevealDays : undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return STANCE_REVEAL_DAYS_DEFAULT;
  return Math.min(STANCE_REVEAL_DAYS_MAX, Math.max(STANCE_REVEAL_DAYS_MIN, Math.round(raw)));
}

/** Reveal time of a relation (pure mirror of REVEAL_AT_SQL, for display and tests). */
export function revealAt(createdAt: string | Date, settledAt: string | Date | null | undefined, days: number): Date {
  if (settledAt) return new Date(settledAt);
  return new Date(new Date(createdAt).getTime() + days * 86_400_000);
}

/** Days until reveal, from Space.settings (alias `sp`). Not a number → 14; clamped before the cast. */
export const REVEAL_DAYS_SQL = `(CASE WHEN jsonb_typeof(sp.settings -> 'stanceRevealDays') = 'number'
        THEN LEAST(${STANCE_REVEAL_DAYS_MAX}, GREATEST(${STANCE_REVEAL_DAYS_MIN}, round((sp.settings ->> 'stanceRevealDays')::numeric)))::int
        ELSE ${STANCE_REVEAL_DAYS_DEFAULT} END)`;
/** Reveal time of relation `r` in space `sp`. */
export const REVEAL_AT_SQL = `COALESCE(r."settledAt", r."createdAt" + make_interval(days => ${REVEAL_DAYS_SQL}))`;
/** THE blind guard: true only once the relation's stances are revealed. */
export const REVEALED_SQL = `now() >= ${REVEAL_AT_SQL}`;

/**
 * The only statement that reads names next to stances. Returns rows only when
 * the relation is revealed AND $2 is a member/curator/admin of its (commons)
 * space. Selects display names — never the stance holder's id.
 */
export const STANCE_NAMES_SQL = `SELECT s.stance, s."afterReveal", u.name, (u.id IS NULL) AS deleted
     FROM "ConceptRelationStance" s
     JOIN "ConceptRelation" r ON r.id = s."relationId"
     JOIN "Space" sp ON sp.id = r."spaceId" AND sp.kind = 'commons'
     LEFT JOIN "User" u ON u.id = s."userId"
     WHERE s."relationId" = $1::uuid
       AND ${REVEALED_SQL}
       AND EXISTS (
         SELECT 1 FROM "SpaceMember" m
         WHERE m."spaceId" = r."spaceId" AND m."userId" = $2::uuid AND m."role" IN ('member', 'curator', 'admin'))
     ORDER BY s."createdAt" ASC, lower(COALESCE(u.name, '')) ASC`;

export type StanceName = { name: string | null; deleted: boolean; stance: Stance; afterReveal: boolean };

export type RelationView = {
  id: string;
  /** Relation type slug. */
  type: string;
  source: { slug: string; label: string; labelNb: string | null };
  target: { slug: string; label: string; labelNb: string | null };
  /** Who proposed the relation (display name only). */
  createdBy: UserRef;
  /** Whether the viewer proposed it (never the id). */
  own: boolean;
  createdAt: string;
  /** The post where it was argued, with what a page needs to link it. */
  fromPost: { id: string; threadId: string; groupSlug: string | null; channelSlug: string | null } | null;
  settled: boolean;
  /** When names are (or were) revealed to members. */
  revealAt: string;
  revealed: boolean;
  agree: number;
  disagree: number;
  /** The viewer's own stance (null: none, or not signed in). */
  myStance: Stance | null;
  myStanceAfterReveal: boolean;
  /** Names behind the stances: null while blind and for non-members; a list once revealed, for members. */
  stances: StanceName[] | null;
};

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

/**
 * One relation with its agreement: totals for everyone, the viewer's own
 * stance, the reveal date, and — once revealed, for members — the names.
 * `spaceId` pins the read to the tenant's space. Public read.
 */
export async function getRelationView(
  q: QueryFn,
  { relationId, spaceId, viewerUserId = null }: { relationId: string; spaceId?: string | null; viewerUserId?: string | null },
): Promise<RelationView | null> {
  if (typeof relationId !== 'string' || !isUuid(relationId)) return null;
  if (spaceId !== undefined && spaceId !== null && !isUuid(spaceId)) return null;
  const viewer = typeof viewerUserId === 'string' && isUuid(viewerUserId) ? viewerUserId : null;
  const rows = await run(
    q,
    `SELECT r.id, r."createdAt", r."createdBy", uc.name AS "createdByName", (r."settledAt" IS NOT NULL) AS settled,
            t.slug AS type,
            ${REVEAL_AT_SQL} AS "revealAt",
            (${REVEALED_SQL}) AS revealed,
            src.slug AS "sourceSlug", src.label AS "sourceLabel", src."labelNb" AS "sourceLabelNb",
            tgt.slug AS "targetSlug", tgt.label AS "targetLabel", tgt."labelNb" AS "targetLabelNb",
            fp.id AS "fromPostId", ft.id AS "fromThreadId", fb.slug AS "fromBoardSlug", fpb.slug AS "fromGroupSlug",
            (SELECT count(*) FROM "ConceptRelationStance" s WHERE s."relationId" = r.id AND s.stance = 'agree')::int AS agree,
            (SELECT count(*) FROM "ConceptRelationStance" s WHERE s."relationId" = r.id AND s.stance = 'disagree')::int AS disagree
     FROM "ConceptRelation" r
     JOIN "Space" sp ON sp.id = r."spaceId"
     JOIN "RelationType" t ON t.id = r."typeId"
     JOIN "Concept" src ON src.id = r."sourceId"
     JOIN "Concept" tgt ON tgt.id = r."targetId"
     LEFT JOIN "User" uc ON uc.id = r."createdBy"
     LEFT JOIN "ForumPost" fp ON fp.id = r."fromPostId" AND fp.status = 'published'
     LEFT JOIN "ForumThread" ft ON ft.id = fp."threadId" AND ft."spaceId" = r."spaceId"
     LEFT JOIN "ForumBoard" fb ON fb.id = ft."boardId"
     LEFT JOIN "ForumBoard" fpb ON fpb.id = fb."parentId"
     WHERE r.id = $1::uuid AND ($2::uuid IS NULL OR r."spaceId" = $2::uuid)
     LIMIT 1`,
    [relationId, spaceId ?? null],
  );
  const r = rows[0];
  if (!r) return null;

  let myStance: Stance | null = null;
  let myStanceAfterReveal = false;
  let stances: StanceName[] | null = null;
  if (viewer) {
    // Own stance: keyed by the viewer's own id, so it can only ever be theirs.
    const mine = await run(
      q,
      `SELECT s.stance, s."afterReveal" FROM "ConceptRelationStance" s
       WHERE s."relationId" = $1::uuid AND s."userId" = $2::uuid LIMIT 1`,
      [relationId, viewer],
    );
    if (mine[0] && isStance(mine[0].stance)) {
      myStance = mine[0].stance;
      myStanceAfterReveal = mine[0].afterReveal === true;
    }
    // Names: the statement itself returns nothing before the reveal or to non-members.
    if (r.revealed === true) {
      const named = await run(q, STANCE_NAMES_SQL, [relationId, viewer]);
      const isMember = named.length > 0 || (await viewerIsMember(q, relationId, viewer));
      stances = isMember
        ? named.filter((n: any) => isStance(n.stance)).map((n: any) => ({
            name: n.deleted === true ? null : publicName(n.name),
            deleted: n.deleted === true,
            stance: n.stance,
            afterReveal: n.afterReveal === true,
          }))
        : null;
    }
  }

  return {
    id: r.id,
    type: r.type,
    source: { slug: r.sourceSlug, label: r.sourceLabel, labelNb: r.sourceLabelNb ?? null },
    target: { slug: r.targetSlug, label: r.targetLabel, labelNb: r.targetLabelNb ?? null },
    createdBy: userRef(r.createdBy, r.createdByName),
    own: !!viewer && r.createdBy === viewer,
    createdAt: iso(r.createdAt),
    fromPost: r.fromPostId && r.fromThreadId
      ? {
          id: r.fromPostId,
          threadId: r.fromThreadId,
          groupSlug: r.fromGroupSlug ?? r.fromBoardSlug ?? null,
          channelSlug: r.fromGroupSlug ? (r.fromBoardSlug ?? null) : null,
        }
      : null,
    settled: r.settled === true,
    revealAt: iso(r.revealAt),
    revealed: r.revealed === true,
    agree: Number(r.agree) || 0,
    disagree: Number(r.disagree) || 0,
    myStance,
    myStanceAfterReveal,
    stances,
  };
}

/** Distinguishes "revealed, nobody voted" ([]) from "not a member" (null). Reads no stance. */
async function viewerIsMember(q: QueryFn, relationId: string, viewer: string): Promise<boolean> {
  const rows = await run(
    q,
    `SELECT 1 FROM "ConceptRelation" r
     JOIN "Space" sp ON sp.id = r."spaceId" AND sp.kind = 'commons'
     JOIN "SpaceMember" m ON m."spaceId" = r."spaceId" AND m."userId" = $2::uuid AND m."role" IN ('member', 'curator', 'admin')
     WHERE r.id = $1::uuid LIMIT 1`,
    [relationId, viewer],
  );
  return rows.length > 0;
}

async function loadRelationSpace(q: QueryFn, relationId: unknown, spaceId?: string | null): Promise<{ id: string; spaceId: string }> {
  const id = requireUuid(relationId, 'relation');
  const rows = await run(q, `SELECT id, "spaceId" FROM "ConceptRelation" WHERE id = $1::uuid LIMIT 1`, [id]);
  const rel = rows[0];
  if (!rel || (spaceId && rel.spaceId !== spaceId)) throw new ConceptError(404, 'relation not found');
  return rel;
}

/**
 * Sets, changes or withdraws (`stance: null`) the actor's stance on a relation.
 * Members, curators and admins only. A withdrawn stance is deleted — nothing
 * remains to reveal. `afterReveal` is decided by the database clock in the same
 * statement: true when the stance is created or changed once the relation is
 * revealed (such stances are signed from the start); repeating the same stance
 * leaves the flag as it was.
 */
export async function setStance(
  q: QueryFn,
  input: { relationId: string; actorUserId: string | null; stance: unknown; spaceId?: string | null },
): Promise<{ stance: Stance | null; afterReveal: boolean }> {
  const rel = await loadRelationSpace(q, input.relationId, input.spaceId);
  await authorize(q, rel.spaceId, input.actorUserId, 'stance');
  const actor = input.actorUserId as string;
  if (input.stance === null) {
    await run(q, `DELETE FROM "ConceptRelationStance" WHERE "relationId" = $1::uuid AND "userId" = $2::uuid`, [rel.id, actor]);
    return { stance: null, afterReveal: false };
  }
  if (!isStance(input.stance)) throw new ConceptError(400, 'stance must be agree, disagree or null');
  const rows = await run(
    q,
    `INSERT INTO "ConceptRelationStance" AS cur ("relationId", "userId", stance, "afterReveal")
     SELECT r.id, $2::uuid, $3::text, (${REVEALED_SQL})
     FROM "ConceptRelation" r JOIN "Space" sp ON sp.id = r."spaceId"
     WHERE r.id = $1::uuid
     ON CONFLICT ("relationId", "userId") DO UPDATE
       SET stance = EXCLUDED.stance,
           "afterReveal" = CASE WHEN cur.stance IS DISTINCT FROM EXCLUDED.stance THEN EXCLUDED."afterReveal" ELSE cur."afterReveal" END
     RETURNING stance, "afterReveal"`,
    [rel.id, actor, input.stance],
  );
  if (!rows.length) throw new ConceptError(404, 'relation not found');
  return { stance: rows[0].stance, afterReveal: rows[0].afterReveal === true };
}

/**
 * A curator or admin closes the discussion of a relation: its stances are
 * revealed to members from now on. Settling is final (there is no un-settle:
 * that would hide names already shown) and idempotent.
 */
export async function settleRelation(
  q: QueryFn,
  input: { relationId: string; actorUserId: string | null; spaceId?: string | null },
): Promise<{ settled: true; settledAt: string }> {
  const rel = await loadRelationSpace(q, input.relationId, input.spaceId);
  await authorize(q, rel.spaceId, input.actorUserId, 'settleRelation');
  const rows = await run(
    q,
    `UPDATE "ConceptRelation" SET "settledAt" = COALESCE("settledAt", now()), "settledBy" = COALESCE("settledBy", $2::uuid)
     WHERE id = $1::uuid RETURNING "settledAt"`,
    [rel.id, input.actorUserId],
  );
  if (!rows.length) throw new ConceptError(404, 'relation not found');
  return { settled: true, settledAt: iso(rows[0].settledAt) };
}
