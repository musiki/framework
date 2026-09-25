export const SPACE_ROLES = ['author', 'supervisor', 'coordinator', 'reviewer', 'guest'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];
export const GRANTABLE_ROLES: readonly SpaceRole[] = SPACE_ROLES.filter((r) => r !== 'author');

export const isSpaceRole = (v: unknown): v is SpaceRole =>
  typeof v === 'string' && (SPACE_ROLES as readonly string[]).includes(v);
export const isGrantableRole = (v: unknown): v is SpaceRole =>
  isSpaceRole(v) && v !== 'author';

export const normalizeEmail = (raw: unknown): string => String(raw ?? '').trim().toLowerCase();

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : '';
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
export const isValidDomain = (domain: string): boolean => DOMAIN_RE.test(domain);
export function isValidEmail(email: string): boolean {
  const parts = email.split('@');
  return parts.length === 2 && parts[0].length > 0 && isValidDomain(parts[1]);
}

export function validateAccessRuleInput(input: { kind: unknown; value: unknown; role: unknown }):
  | { ok: true; kind: 'email' | 'domain'; value: string; role: SpaceRole }
  | { ok: false; error: string } {
  const value = normalizeEmail(input.value);
  if (!isGrantableRole(input.role)) return { ok: false, error: 'invalid-role' };
  if (input.kind === 'email') {
    return isValidEmail(value) ? { ok: true, kind: 'email', value, role: input.role } : { ok: false, error: 'invalid-email' };
  }
  if (input.kind === 'domain') {
    return isValidDomain(value) ? { ok: true, kind: 'domain', value, role: input.role } : { ok: false, error: 'invalid-domain' };
  }
  return { ok: false, error: 'invalid-kind' };
}

export function validateInviteInput(input: { email: unknown; role: unknown }):
  | { ok: true; email: string; role: SpaceRole }
  | { ok: false; error: string } {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
  if (!isGrantableRole(input.role)) return { ok: false, error: 'invalid-role' };
  return { ok: true, email, role: input.role };
}
