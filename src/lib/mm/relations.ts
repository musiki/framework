// DB-bound wrapper for the mm relation stances core (see concepts.ts for the
// conventions). createRelation / deleteRelation / graph are bound in
// concepts.ts; this file adds agreement: blind, then revealed (stances-core).

import { query } from '../db/pool';
import * as stances from './stances-core.ts';
import type { QueryFn } from './concepts-core.ts';

export { createRelation, deleteRelation, graph } from './concepts';
export { STANCES, STANCE_REVEAL_DAYS_DEFAULT, STANCE_REVEAL_DAYS_MIN, STANCE_REVEAL_DAYS_MAX, stanceRevealDays } from './stances-core.ts';
export type { RelationView, Stance, StanceName } from './stances-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

/** Public: totals, reveal date and the viewer's own stance; names only once revealed and only to members (SQL-enforced). */
export const getRelationView = (args: Parameters<typeof stances.getRelationView>[1]) => stances.getRelationView(poolQ, args);
/** Members+: agree / disagree / null (withdraw: the row is deleted). */
export const setStance = (args: Parameters<typeof stances.setStance>[1]) => stances.setStance(poolQ, args);
/** Curators/admins: close the discussion — reveals the stances to members. */
export const settleRelation = (args: Parameters<typeof stances.settleRelation>[1]) => stances.settleRelation(poolQ, args);
