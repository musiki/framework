import { emailDomain, isGrantableForKind, normalizeEmail, type AnySpaceRole, type SpaceKind } from './space-roles.ts';

export type InviteRow = {
  id: string; spaceId: string; email: string; role: string;
  expiresAt: string | Date; acceptedAt: string | Date | null;
};
export type AccessRuleRow = { spaceId: string; kind: 'email' | 'domain'; value: string; role: string };
export type SpaceInfo = { id: string; kind: SpaceKind; openJoin?: boolean };
export type AccessGrant = {
  spaceId: string; role: AnySpaceRole; via: 'invite' | 'email-rule' | 'domain-rule' | 'open-join'; inviteId?: string;
};
export type AccessDecision =
  | { allowed: false; reason: 'no-email' | 'unverified' | 'no-grant' }
  | { allowed: true; grants: AccessGrant[] };

export function decideSpaceAccess(input: {
  email: string; emailVerified: boolean; now: Date; isMember: boolean;
  invites: InviteRow[]; rules: AccessRuleRow[];
  /** Kind and open-join flag per space. Spaces not listed are treated as dissertation spaces. */
  spaces?: SpaceInfo[];
  /** Spaces the user already belongs to (open-join never re-grants these). */
  memberSpaceIds?: string[];
  /** Commons spaces the user was removed from: open-join and rules skip them (invites still work). */
  blockedSpaceIds?: string[];
}): AccessDecision {
  const email = normalizeEmail(input.email);
  if (!email) return { allowed: false, reason: 'no-email' };
  if (!input.emailVerified) return { allowed: false, reason: 'unverified' };
  const domain = emailDomain(email);

  const info = new Map((input.spaces ?? []).map((sp) => [sp.id, sp]));
  const kindOf = (spaceId: string): SpaceKind => info.get(spaceId)?.kind ?? 'dissertation';

  const bySpace = new Map<string, AccessGrant>();
  const add = (g: AccessGrant) => { if (!bySpace.has(g.spaceId)) bySpace.set(g.spaceId, g); };

  for (const inv of input.invites) {
    if (normalizeEmail(inv.email) !== email || inv.acceptedAt) continue;
    if (new Date(inv.expiresAt).getTime() <= input.now.getTime()) continue;
    if (!isGrantableForKind(kindOf(inv.spaceId), inv.role)) continue;
    add({ spaceId: inv.spaceId, role: inv.role, via: 'invite', inviteId: inv.id });
  }
  // A removal from a commons space (SpaceMemberBlock) sticks against email/domain
  // rules and open-join; only an explicit invite re-admits.
  const blocked = new Set(input.blockedSpaceIds ?? []);
  const ruleBlocked = (spaceId: string) => blocked.has(spaceId) && kindOf(spaceId) === 'commons';
  for (const rule of input.rules) {
    if (ruleBlocked(rule.spaceId)) continue;
    if (rule.kind === 'email' && rule.value === email && isGrantableForKind(kindOf(rule.spaceId), rule.role)) {
      add({ spaceId: rule.spaceId, role: rule.role, via: 'email-rule' });
    }
  }
  for (const rule of input.rules) {
    if (ruleBlocked(rule.spaceId)) continue;
    if (rule.kind === 'domain' && domain && rule.value === domain && isGrantableForKind(kindOf(rule.spaceId), rule.role)) {
      add({ spaceId: rule.spaceId, role: rule.role, via: 'domain-rule' });
    }
  }

  // Open-join: commons spaces only, verified email (checked above), no other grant, not already a member.
  const members = new Set(input.memberSpaceIds ?? []);
  for (const sp of info.values()) {
    if (sp.kind === 'commons' && sp.openJoin === true && !bySpace.has(sp.id) && !members.has(sp.id) && !blocked.has(sp.id)) {
      add({ spaceId: sp.id, role: 'member', via: 'open-join' });
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
