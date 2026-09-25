import type { TenantId } from '../../tenant/tenants.ts';
import { isSpaceRole } from '../../tenant/space-roles.ts';
import { effectiveVisibility } from './visibility.ts';
import { resolveSpaceAccess, type NoteAccess } from './space-access.ts';

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ data: any[] | null; error: any }>;

export type NoteAccessResult = 'edit' | 'comment' | 'view' | null;

export type NoteAccessDetail = {
  access: NoteAccess;
  versionsOnly: boolean;
  spaceId: string | null;
};

type NoteRow = {
  id: string;
  userId: string;
  courseId: string | null;
  spaceId?: string | null;
  visibility?: string | null;
  folderId?: string | null;
};

// Course-branch access: moved verbatim from the former
// src/pages/api/live/notes/annotations.ts getNoteAccess (query(...) -> q(...)).
// `note` is the already-fetched LiveClassNote row; `noteId` below refers to note.id
// exactly as the original code referred to the noteId parameter.
export async function courseAccess(
  q: QueryFn,
  note: NoteRow,
  userId: string,
): Promise<NoteAccessResult> {
  const noteId = note.id;

  // 1. Check ownership
  if (note.userId === userId) return 'edit';

  // 2. Check if user is a teacher of the course
  if (note.courseId) {
    const { data: enroll } = await q(
      `SELECT "roleInCourse" FROM "Enrollment" WHERE "userId" = $1::uuid AND "courseId" = $2 LIMIT 1`,
      [userId, note.courseId]
    );
    if (enroll?.length && enroll[0].roleInCourse === 'teacher') {
      return 'edit'; // Teachers have edit access to student notes
    }
  }

  // 3. Check sharing configurations
  const { data: shares } = await q(
    `SELECT "targetType", "targetId", "accessLevel" FROM "LiveClassNoteShare" WHERE "noteId" = $1::uuid`,
    [noteId]
  );

  if (!shares || shares.length === 0) return null;

  // Determine user's active commissions/classrooms inside this course
  let userClassIds: string[] = [];
  if (note.courseId) {
    const { data: userClasses } = await q(
      `SELECT DISTINCT "claseId" FROM "ResourceSession"
       WHERE "courseId" = $1 AND "claseId" IS NOT NULL AND "claseId" != ''`,
      [note.courseId]
    );
    userClassIds = (userClasses ?? []).map((row: any) => String(row.claseId));

    const { data: profileSub } = await q(
      `SELECT payload->>'grupo' as grupo
       FROM "Submission"
       WHERE "userId" = $1::uuid
         AND "assignmentId" LIKE $2
       LIMIT 1`,
      [userId, `__meta__:course-student-profile:${encodeURIComponent(note.courseId)}:%`]
    );
    if (profileSub?.length && profileSub[0].grupo) {
      const g = String(profileSub[0].grupo).trim();
      if (g) {
        userClassIds.push(g);
        userClassIds.push(`${note.courseId}/${g}`);
      }
    }
  }

  let bestAccess: 'view' | 'comment' | 'edit' | null = null;
  const accessRank = { 'view': 1, 'comment': 2, 'edit': 3 };

  for (const share of shares) {
    let matched = false;
    if (share.targetType === 'user' && share.targetId === userId) {
      matched = true;
    } else if (share.targetType === 'teachers') {
      if (note.courseId) {
        const { data: enroll } = await q(
          `SELECT "roleInCourse" FROM "Enrollment" WHERE "userId" = $1::uuid AND "courseId" = $2 LIMIT 1`,
          [userId, note.courseId]
        );
        if (enroll?.length && enroll[0].roleInCourse === 'teacher') matched = true;
      }
    } else if (share.targetType === 'students') {
      if (note.courseId) {
        const { data: enroll } = await q(
          `SELECT "roleInCourse" FROM "Enrollment" WHERE "userId" = $1::uuid AND "courseId" = $2 LIMIT 1`,
          [userId, note.courseId]
        );
        if (enroll?.length && enroll[0].roleInCourse === 'student') matched = true;
      }
    } else if (share.targetType === 'class' && userClassIds.includes(share.targetId)) {
      matched = true;
    }

    if (matched) {
      const currentRank = accessRank[share.accessLevel as 'view' | 'comment' | 'edit'] ?? 0;
      const bestRank = bestAccess ? (accessRank[bestAccess] ?? 0) : 0;
      if (currentRank > bestRank) {
        bestAccess = share.accessLevel as 'view' | 'comment' | 'edit';
      }
    }
  }

  return bestAccess;
}

export function createNoteAccessDetail(q: QueryFn) {
  return async function getNoteAccessDetail(
    noteId: string,
    userId: string,
    opts: { tenantId?: TenantId } = {},
  ): Promise<NoteAccessDetail> {
    const { data: noteRows } = await q(
      `SELECT "userId","courseId","spaceId","visibility","folderId" FROM "LiveClassNote" WHERE id=$1::uuid LIMIT 1`,
      [noteId]
    );
    if (!noteRows?.length) return { access: null, versionsOnly: false, spaceId: null };
    const note: NoteRow = { id: noteId, ...noteRows[0] };

    if (note.spaceId) {
      const { data: spaceRows } = await q(`SELECT "tenantId" FROM "Space" WHERE id=$1`, [note.spaceId]);
      const tenantId = spaceRows?.[0]?.tenantId ?? null;
      if (!tenantId || tenantId !== opts.tenantId) {
        return { access: null, versionsOnly: false, spaceId: note.spaceId };
      }

      const { data: memberRows } = await q(
        `SELECT role FROM "SpaceMember" WHERE "spaceId"=$1 AND "userId"=$2::uuid`,
        [note.spaceId, userId]
      );
      const role = memberRows?.[0]?.role;
      if (!isSpaceRole(role)) {
        return { access: null, versionsOnly: false, spaceId: note.spaceId };
      }

      const { data: folderRows } = await q(
        `SELECT id,"parentId",visibility FROM "LiveClassNoteFolder" WHERE "spaceId"=$1`,
        [note.spaceId]
      );
      const foldersById = new Map((folderRows ?? []).map((f: any) => [f.id, f]));
      const visibility = effectiveVisibility(note, foldersById);
      const { access, versionsOnly } = resolveSpaceAccess(role, visibility);
      return { access, versionsOnly, spaceId: note.spaceId };
    }

    if ((opts.tenantId ?? 'musiki') !== 'musiki') {
      return { access: null, versionsOnly: false, spaceId: null };
    }
    const access = await courseAccess(q, note, userId);
    return { access, versionsOnly: false, spaceId: null };
  };
}

export function createNoteAccessResolver(q: QueryFn) {
  const detail = createNoteAccessDetail(q);
  return async function getNoteAccess(
    noteId: string,
    userId: string,
    opts: { tenantId?: TenantId } = {},
  ): Promise<NoteAccessResult> {
    const result = await detail(noteId, userId, opts);
    return result.access;
  };
}
