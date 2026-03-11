import type { Session } from '@auth/core/types';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { canonicalizeCourseId } from '../course-alias';
import { createSupabaseServerClient, ensureDbUserFromSession } from '../forum-server';
import { resolveLiveParticipantRole } from './access';

export type LiveRoomInviteType = 'external' | 'student';

type LiveRoomInviteRow = {
  code: string;
  courseId: string | null;
  createdAt: string;
  createdByUserId: string | null;
  displayName: string | null;
  expiresAt: string | null;
  id: string;
  inviteType: LiveRoomInviteType;
  isActive: boolean;
  metadata: Record<string, unknown>;
  pageSlug: string | null;
  passwordHash: string | null;
  presentationHref: string | null;
  requiresPassword: boolean;
  room: string;
  updatedAt: string;
};

export type PublicLiveRoomInvite = Omit<LiveRoomInviteRow, 'passwordHash'>;

const normalizeText = (value: unknown) => String(value ?? '').trim();

export const normalizeLiveRoomInviteType = (value: unknown): LiveRoomInviteType =>
  normalizeText(value).toLowerCase() === 'student' ? 'student' : 'external';

const normalizeInviteMetadata = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizeInviteRow = (row: any): LiveRoomInviteRow | null => {
  const code = normalizeText(row?.code);
  const room = normalizeText(row?.room);
  if (!code || !room) return null;

  return {
    code,
    courseId: normalizeText(row?.courseId) || null,
    createdAt: normalizeText(row?.createdAt),
    createdByUserId: normalizeText(row?.createdByUserId) || null,
    displayName: normalizeText(row?.displayName) || null,
    expiresAt: normalizeText(row?.expiresAt) || null,
    id: normalizeText(row?.id),
    inviteType: normalizeLiveRoomInviteType(row?.inviteType),
    isActive: row?.isActive !== false,
    metadata: normalizeInviteMetadata(row?.metadata),
    pageSlug: normalizeText(row?.pageSlug) || null,
    passwordHash: normalizeText(row?.passwordHash) || null,
    presentationHref: normalizeText(row?.presentationHref) || null,
    requiresPassword: Boolean(row?.requiresPassword),
    room,
    updatedAt: normalizeText(row?.updatedAt),
  };
};

const redactInvite = (row: LiveRoomInviteRow): PublicLiveRoomInvite => {
  const { passwordHash: _passwordHash, ...invite } = row;
  return invite;
};

const isInviteExpired = (expiresAt: string | null | undefined) => {
  const timestamp = Date.parse(normalizeText(expiresAt));
  return Number.isFinite(timestamp) && timestamp <= Date.now();
};

const createInviteCode = () =>
  randomBytes(9)
    .toString('base64url')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 12)
    .toLowerCase();

const hashInvitePassword = (password: string) => {
  const normalized = normalizeText(password).normalize('NFKC');
  const salt = randomBytes(16);
  const hash = scryptSync(normalized, salt, 64);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
};

const verifyInvitePassword = (password: string, storedHash: string | null | undefined) => {
  const normalizedHash = normalizeText(storedHash);
  if (!normalizedHash) return false;

  const [scheme, saltBase64, digestBase64] = normalizedHash.split(':');
  if (scheme !== 'scrypt' || !saltBase64 || !digestBase64) return false;

  try {
    const salt = Buffer.from(saltBase64, 'base64');
    const expectedDigest = Buffer.from(digestBase64, 'base64');
    const actualDigest = scryptSync(normalizeText(password).normalize('NFKC'), salt, expectedDigest.length);
    return (
      actualDigest.length === expectedDigest.length &&
      timingSafeEqual(actualDigest, expectedDigest)
    );
  } catch {
    return false;
  }
};

const createInviteClient = () => createSupabaseServerClient({ requireServiceRole: true });

const selectInviteColumns =
  'id, code, room, inviteType, courseId, pageSlug, presentationHref, displayName, requiresPassword, passwordHash, createdByUserId, expiresAt, isActive, metadata, createdAt, updatedAt';

const getLatestLiveRoomInviteRow = async ({
  inviteType,
  room,
}: {
  inviteType?: unknown;
  room: unknown;
}): Promise<LiveRoomInviteRow | null> => {
  const normalizedRoom = normalizeText(room);
  if (!normalizedRoom) return null;

  const supabase = createInviteClient();
  const { data, error } = await supabase
    .from('LiveRoomInvite')
    .select(selectInviteColumns)
    .eq('room', normalizedRoom)
    .eq('inviteType', normalizeLiveRoomInviteType(inviteType))
    .eq('isActive', true)
    .order('updatedAt', { ascending: false })
    .limit(5);

  if (error) throw error;

  const invites = (Array.isArray(data) ? data : [])
    .map(normalizeInviteRow)
    .filter((invite): invite is LiveRoomInviteRow => Boolean(invite))
    .filter((invite) => invite.isActive && !isInviteExpired(invite.expiresAt));

  return invites[0] || null;
};

const normalizeInviteExpiresAt = (value: unknown) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error('expiresAt must be a valid ISO datetime');
  }
  if (timestamp <= Date.now()) {
    throw new Error('expiresAt must be in the future');
  }
  return new Date(timestamp).toISOString();
};

export const getLiveRoomInviteByCode = async (
  codeInput: unknown,
  options: { includePasswordHash?: boolean } = {},
): Promise<LiveRoomInviteRow | PublicLiveRoomInvite | null> => {
  const code = normalizeText(codeInput).toLowerCase();
  if (!code) return null;

  const supabase = createInviteClient();
  const { data, error } = await supabase
    .from('LiveRoomInvite')
    .select(selectInviteColumns)
    .eq('code', code)
    .maybeSingle();

  if (error) throw error;

  const invite = normalizeInviteRow(data);
  if (!invite || !invite.isActive || isInviteExpired(invite.expiresAt)) {
    return null;
  }

  return options.includePasswordHash ? invite : redactInvite(invite);
};

export const getLatestLiveRoomInvite = async ({
  inviteType,
  room,
}: {
  inviteType?: unknown;
  room: unknown;
}): Promise<PublicLiveRoomInvite | null> => {
  const invite = await getLatestLiveRoomInviteRow({
    inviteType,
    room,
  });
  return invite ? redactInvite(invite) : null;
};

export const upsertLiveRoomInvite = async ({
  courseId,
  createdByUserId,
  displayName,
  expiresAt,
  inviteType,
  metadata,
  pageSlug,
  password,
  presentationHref,
  room,
}: {
  courseId?: unknown;
  createdByUserId?: unknown;
  displayName?: unknown;
  expiresAt?: unknown;
  inviteType?: unknown;
  metadata?: Record<string, unknown>;
  pageSlug?: unknown;
  password?: unknown;
  presentationHref?: unknown;
  room: unknown;
}): Promise<PublicLiveRoomInvite> => {
  const normalizedRoom = normalizeText(room);
  if (!normalizedRoom) {
    throw new Error('room is required');
  }

  const normalizedInviteType = normalizeLiveRoomInviteType(inviteType);
  const normalizedPassword = normalizeText(password);
  if (normalizedInviteType === 'external' && !normalizedPassword) {
    throw new Error('password is required for external invites');
  }

  const normalizedCourseId = await canonicalizeCourseId(normalizeText(courseId));
  const normalizedPageSlug = normalizeText(pageSlug) || null;
  const normalizedPresentationHref = normalizeText(presentationHref) || null;
  const normalizedDisplayName = normalizeText(displayName) || null;
  const normalizedExpiresAt = normalizeInviteExpiresAt(expiresAt);
  const normalizedCreatedByUserId = normalizeText(createdByUserId) || null;
  const existingInvite = await getLatestLiveRoomInviteRow({
    inviteType: normalizedInviteType,
    room: normalizedRoom,
  }).catch(() => null);
  const passwordHash = normalizedPassword
    ? hashInvitePassword(normalizedPassword)
    : normalizedInviteType === 'external'
      ? existingInvite?.passwordHash || null
      : null;
  if (normalizedInviteType === 'external' && !passwordHash) {
    throw new Error('password is required for external invites');
  }
  const requiresPassword = normalizedInviteType === 'external';
  const supabase = createInviteClient();

  const payload = {
    code: existingInvite?.code || createInviteCode(),
    courseId: normalizedCourseId || null,
    createdByUserId: normalizedCreatedByUserId,
    displayName: normalizedDisplayName,
    expiresAt: normalizedExpiresAt,
    inviteType: normalizedInviteType,
    isActive: true,
    metadata: normalizeInviteMetadata(metadata),
    pageSlug: normalizedPageSlug,
    passwordHash,
    presentationHref: normalizedPresentationHref,
    requiresPassword,
    room: normalizedRoom,
  };

  const query = existingInvite
    ? supabase
        .from('LiveRoomInvite')
        .update(payload)
        .eq('id', existingInvite.id)
    : supabase.from('LiveRoomInvite').insert([payload]);

  const { data, error } = await query
    .select(selectInviteColumns)
    .single();

  if (error) throw error;

  const invite = normalizeInviteRow(data);
  if (!invite) {
    throw new Error('could not persist invite');
  }

  return redactInvite(invite);
};

export const revokeLiveRoomInvite = async ({
  code,
  inviteType,
  room,
}: {
  code?: unknown;
  inviteType?: unknown;
  room?: unknown;
}): Promise<PublicLiveRoomInvite | null> => {
  const normalizedCode = normalizeText(code).toLowerCase();
  const normalizedRoom = normalizeText(room);
  const normalizedInviteType = normalizeLiveRoomInviteType(inviteType);

  const targetInvite = normalizedCode
    ? await getLiveRoomInviteByCode(normalizedCode, { includePasswordHash: true })
    : await getLatestLiveRoomInviteRow({
        inviteType: normalizedInviteType,
        room: normalizedRoom,
      });

  if (!targetInvite) {
    return null;
  }

  const inviteRow = 'passwordHash' in targetInvite
    ? targetInvite
    : await getLatestLiveRoomInviteRow({
        inviteType: targetInvite.inviteType,
        room: targetInvite.room,
      });

  if (!inviteRow) {
    return null;
  }

  const supabase = createInviteClient();
  const { data, error } = await supabase
    .from('LiveRoomInvite')
    .update({
      isActive: false,
    })
    .eq('id', inviteRow.id)
    .select(selectInviteColumns)
    .single();

  if (error) throw error;

  const invite = normalizeInviteRow(data);
  return invite ? redactInvite(invite) : null;
};

export const verifyLiveRoomInviteAccess = async ({
  code,
  password,
}: {
  code: unknown;
  password?: unknown;
}): Promise<{ invite: PublicLiveRoomInvite | null; ok: boolean; reason?: string }> => {
  const invite = await getLiveRoomInviteByCode(code, { includePasswordHash: true });
  if (!invite || !('passwordHash' in invite)) {
    return { invite: null, ok: false, reason: 'Invite not found or expired.' };
  }

  if (invite.requiresPassword && !verifyInvitePassword(String(password ?? ''), invite.passwordHash)) {
    return { invite: null, ok: false, reason: 'Invalid invite password.' };
  }

  return {
    invite: redactInvite(invite),
    ok: true,
  };
};

export const resolveLiveInviteTeacherAccess = async (
  session: Session | null | undefined,
  courseId = '',
) => {
  const role = await resolveLiveParticipantRole(session, courseId);
  if (role !== 'teacher') {
    return {
      canManage: false,
      role,
      userId: '',
    };
  }

  let userId = '';
  try {
    const supabase = createSupabaseServerClient();
    const dbUser = await ensureDbUserFromSession(supabase, session);
    userId = normalizeText(dbUser?.id);
  } catch (error) {
    console.error('Live invite teacher resolution failed:', error);
  }

  return {
    canManage: true,
    role,
    userId,
  };
};
