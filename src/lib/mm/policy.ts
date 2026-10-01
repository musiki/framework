import type { CommonsRole } from '../tenant/space-roles.ts';

export const MM_ACTIONS = [
  'read', 'vote', 'post', 'editOwnPost', 'proposeConcept', 'editDefinition', 'adoptPost', 'changeStatus',
  'moderate', 'createRelation', 'deleteRelation', 'manageForums', 'manageAccess',
  'manageRelationTypes', 'stance', 'settleRelation', 'renameConceptSlug',
] as const;
export type MmAction = (typeof MM_ACTIONS)[number];

export interface MmPolicyCtx {
  isAuthor?: boolean;
  isOwnRelation?: boolean;
}

const MEMBER_UP = (r: CommonsRole) => r === 'member' || r === 'curator' || r === 'admin';
const CURATOR_UP = (r: CommonsRole) => r === 'curator' || r === 'admin';

/** Pure permission matrix (spec §5). `role === null` means anonymous. Unknown role/action => false. */
export function can(role: CommonsRole | null, action: MmAction, ctx: MmPolicyCtx = {}): boolean {
  if (action === 'read') return true;
  if (role === null) return false;
  switch (action) {
    case 'vote':
      return role === 'guest' || MEMBER_UP(role);
    case 'post':
    case 'proposeConcept':
    case 'createRelation':
    case 'stance':
      // Agree/disagree on a relation: members and up; guests never.
      return MEMBER_UP(role);
    case 'editOwnPost':
      // Author-only (edit/delete own post); curators get no edit power over others' posts.
      return MEMBER_UP(role) && ctx.isAuthor === true;
    case 'editDefinition':
      return CURATOR_UP(role) || (role === 'member' && ctx.isAuthor === true);
    case 'deleteRelation':
      return CURATOR_UP(role) || (role === 'member' && ctx.isOwnRelation === true);
    case 'adoptPost':
    case 'changeStatus':
    case 'moderate':
    case 'manageForums':
    case 'manageRelationTypes':
    case 'settleRelation':
    case 'renameConceptSlug':
      return CURATOR_UP(role);
    case 'manageAccess':
      return role === 'admin';
    default:
      return false;
  }
}
