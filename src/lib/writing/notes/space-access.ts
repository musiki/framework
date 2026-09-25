import type { SpaceRole } from '../../tenant/space-roles.ts';
import type { Visibility } from './visibility.ts';

export type NoteAccess = 'edit' | 'comment' | 'view' | null;

const MATRIX: Record<SpaceRole, Record<Visibility, NoteAccess>> = {
  author:      { private: 'edit', supervision: 'edit',    committee: 'edit', public: 'edit' },
  supervisor:  { private: null,   supervision: 'comment', committee: 'view', public: 'view' },
  coordinator: { private: null,   supervision: null,      committee: 'view', public: 'view' },
  reviewer:    { private: null,   supervision: null,      committee: 'view', public: 'view' },
  guest:       { private: null,   supervision: null,      committee: null,   public: 'view' },
};

export function resolveSpaceAccess(role: SpaceRole, visibility: Visibility): { access: NoteAccess; versionsOnly: boolean } {
  const access = MATRIX[role]?.[visibility] ?? null;
  return { access, versionsOnly: role === 'reviewer' && visibility === 'committee' };
}

export const canManageSpace = (role: SpaceRole): boolean => role === 'author';
