// DB-bound wrapper for the mm relation types core (see concepts.ts for the
// conventions): reads use the pool, mutations that run a transaction check out
// one client through `onClient`.

import { query } from '../db/pool';
import * as core from './relation-types-core.ts';
import { onClient } from './concepts.ts';
import { mmDefinitionRenderCache, mmRendererFor } from './render.ts';
import type { MmLang } from './ui-lang.ts';
import type { QueryFn } from './concepts-core.ts';

export { RELATION_COLORS, RELATION_STROKES, RELATION_RENDERS, relationTypeConceptSlug } from './relation-types-core.ts';
export type {
  RelationTypeView, RelationTypeDetail, RelationTypeFields, RelationColor, RelationStroke, RelationRender,
} from './relation-types-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

/** Public. Seeds the built-ins the first time a commons space without any type is read. */
export const listRelationTypes = (args: Parameters<typeof core.listRelationTypes>[1]) => core.listRelationTypes(poolQ, args);
/** Public. The type with its definition concept, rendered by the sanitized mm renderer. */
export const getRelationType = ({ lang = 'en', ...args }: Omit<Parameters<typeof core.getRelationType>[1], 'render'> & { lang?: MmLang }) =>
  core.getRelationType(poolQ, { ...args, render: mmRendererFor(mmDefinitionRenderCache, lang) });

export const createRelationType = (args: Parameters<typeof core.createRelationType>[1]) =>
  onClient((q) => core.createRelationType(q, args));
export const updateRelationType = (args: Parameters<typeof core.updateRelationType>[1]) =>
  onClient((q) => core.updateRelationType(q, args));
export const archiveRelationType = (args: Parameters<typeof core.archiveRelationType>[1]) => core.archiveRelationType(poolQ, args);
export const reorderRelationTypes = (args: Parameters<typeof core.reorderRelationTypes>[1]) =>
  onClient((q) => core.reorderRelationTypes(q, args));
