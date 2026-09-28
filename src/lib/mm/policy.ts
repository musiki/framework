import type { CommonsRole } from '../tenant/space-roles.ts';

export const MM_ACTIONS = [
  'read', 'vote', 'post', 'proposeConcept', 'editDefinition', 'adoptPost', 'changeStatus',
  'moderate', 'createRelation', 'deleteRelation', 'manageForums', 'manageAccess',
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
      return MEMBER_UP(role);
    case 'editDefinition':
      return CURATOR_UP(role) || (role === 'member' && ctx.isAuthor === true);
    case 'deleteRelation':
      return CURATOR_UP(role) || (role === 'member' && ctx.isOwnRelation === true);
    case 'adoptPost':
    case 'changeStatus':
    case 'moderate':
    case 'manageForums':
      return CURATOR_UP(role);
    case 'manageAccess':
      return role === 'admin';
    default:
      return false;
  }
}
