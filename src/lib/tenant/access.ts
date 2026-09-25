import { emailDomain, isGrantableRole, normalizeEmail, type SpaceRole } from './space-roles.ts';

export type InviteRow = {
  id: string; spaceId: string; email: string; role: string;
  expiresAt: string | Date; acceptedAt: string | Date | null;
};
export type AccessRuleRow = { spaceId: string; kind: 'email' | 'domain'; value: string; role: string };
export type AccessGrant = {
  spaceId: string; role: SpaceRole; via: 'invite' | 'email-rule' | 'domain-rule'; inviteId?: string;
};
export type AccessDecision =
  | { allowed: false; reason: 'no-email' | 'unverified' | 'no-grant' }
  | { allowed: true; grants: AccessGrant[] };

export function decideSpaceAccess(input: {
  email: string; emailVerified: boolean; now: Date; isMember: boolean;
  invites: InviteRow[]; rules: AccessRuleRow[];
}): AccessDecision {
  const email = normalizeEmail(input.email);
  if (!email) return { allowed: false, reason: 'no-email' };
  if (!input.emailVerified) return { allowed: false, reason: 'unverified' };
  const domain = emailDomain(email);

  const bySpace = new Map<string, AccessGrant>();
  const add = (g: AccessGrant) => { if (!bySpace.has(g.spaceId)) bySpace.set(g.spaceId, g); };

  for (const inv of input.invites) {
    if (normalizeEmail(inv.email) !== email || inv.acceptedAt) continue;
    if (new Date(inv.expiresAt).getTime() <= input.now.getTime()) continue;
    if (!isGrantableRole(inv.role)) continue;
    add({ spaceId: inv.spaceId, role: inv.role, via: 'invite', inviteId: inv.id });
  }
  for (const rule of input.rules) {
    if (rule.kind === 'email' && rule.value === email && isGrantableRole(rule.role)) {
      add({ spaceId: rule.spaceId, role: rule.role, via: 'email-rule' });
    }
  }
  for (const rule of input.rules) {
    if (rule.kind === 'domain' && domain && rule.value === domain && isGrantableRole(rule.role)) {
      add({ spaceId: rule.spaceId, role: rule.role, via: 'domain-rule' });
    }
  }

  const grants = [...bySpace.values()];
  if (grants.length > 0 || input.isMember) return { allowed: true, grants };
  return { allowed: false, reason: 'no-grant' };
}

const MUSIKI_PRIVILEGED_ROLES = new Set(['teacher', 'admin']);

/**
 * A user created by another tenant's sign-in (e.g. so) has a musiki User row
 * but must not be able to use it on musiki. Reject only when there is no sign
 * of a real musiki account: no enrollment, no privileged role, and at least
 * one membership in a non-musiki space.
 */
export function shouldRejectMusikiSignIn(input: {
  hasEnrollment: boolean; globalRole: string | null | undefined; hasForeignMembership: boolean;
}): boolean {
  if (input.hasEnrollment) return false;
  if (MUSIKI_PRIVILEGED_ROLES.has(String(input.globalRole ?? '').toLowerCase())) return false;
  return input.hasForeignMembership;
}
