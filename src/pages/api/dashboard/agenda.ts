import type { APIRoute } from 'astro';
import {
  createSupabaseServerClient,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import {
  buildAgendaConfigAssignmentId,
  buildAgendaEventsAssignmentId,
  buildAgendaEventColor,
  buildAgendaStudentAssignmentId,
  clampAgendaMaxStudentMinutes,
  createAgendaBlockId,
  COURSE_AGENDA_CONFIG_META_KIND,
  COURSE_AGENDA_EVENTS_META_KIND,
  COURSE_AGENDA_STUDENT_META_KIND,
  getAgendaBlockDurationMinutes,
  normalizeAgendaComment,
  normalizeAgendaConfigPayload,
  normalizeAgendaCourseId,
  normalizeAgendaDateKey,
  normalizeAgendaEventText,
  normalizeAgendaEventsPayload,
  normalizeAgendaStudentPayload,
  normalizeAgendaYear,
  normalizeText,
  type AgendaBlock,
  type AgendaEvent,
} from '../../../lib/dashboard/agenda';

const ensureMetaAssignment = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  assignmentId: string,
  courseId: string,
  slug: string,
) => {
  const { data: existing, error: existingError } = await supabase
    .from('Assignment')
    .select('id')
    .eq('id', assignmentId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return;

  const baseAssignment = {
    id: assignmentId,
    courseId,
    slug,
  };

  const withWeight = await supabase.from('Assignment').insert([{ ...baseAssignment, weight: 1 }]);
  if (!withWeight.error) return;

  const weightMissing =
    typeof withWeight.error.message === 'string'
    && withWeight.error.message.toLowerCase().includes('weight');
  if (!weightMissing) throw withWeight.error;

  const withoutWeight = await supabase.from('Assignment').insert([baseAssignment]);
  if (withoutWeight.error) throw withoutWeight.error;
};

const rangesOverlap = (block: AgendaBlock | AgendaEvent, startMinute: number, endMinute: number) =>
  Number(block.startMinute || 0) < endMinute && Number(block.endMinute || 0) > startMinute;

const replaceBlocksInRange = (
  blocks: AgendaBlock[],
  dateKeys: Set<string>,
  startMinute: number,
  endMinute: number,
  nextBlocks: AgendaBlock[],
) => {
  const persisted = (blocks || []).filter(
    (block) => !(dateKeys.has(block.dateKey) && rangesOverlap(block, startMinute, endMinute)),
  );
  return [...persisted, ...nextBlocks].sort((left, right) => {
    if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey, 'es');
    if (left.startMinute !== right.startMinute) return left.startMinute - right.startMinute;
    return left.endMinute - right.endMinute;
  });
};

const sumBlocksMinutes = (blocks: AgendaBlock[]) =>
  (blocks || []).reduce((total, block) => total + getAgendaBlockDurationMinutes(block), 0);

const normalizeDateKeys = (value: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => normalizeAgendaDateKey(entry))
        .filter(Boolean),
    ),
  );

const normalizeMinute = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(0, Math.min(24 * 60, parsed));
};

const normalizeSelectedRange = (body: any) => {
  const dateKeys = normalizeDateKeys(body?.dateKeys || body?.dates);
  const startMinute = normalizeMinute(body?.startMinute);
  const endMinute = normalizeMinute(body?.endMinute);
  if (!dateKeys.length || !Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) {
    return null;
  }
  return { dateKeys, startMinute, endMinute };
};

const upsertSubmission = async ({
  supabase,
  assignmentId,
  userId,
  payload,
}: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  assignmentId: string;
  userId: string;
  payload: Record<string, any>;
}) => {
  const { data: existingRows, error: existingError } = await supabase
    .from('Submission')
    .select('id, attempts')
    .eq('assignmentId', assignmentId)
    .eq('userId', userId)
    .order('submittedAt', { ascending: false });

  if (existingError) throw existingError;
  const existing = existingRows?.[0] ?? null;
  const now = new Date().toISOString();

  if (existing?.id) {
    const attempts = Number(existing.attempts || 0);
    const { error: updateError } = await supabase
      .from('Submission')
      .update({
        payload,
        attempts: Number.isFinite(attempts) ? attempts + 1 : 1,
        submittedAt: now,
      })
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabase
    .from('Submission')
    .insert([{
      userId,
      assignmentId,
      payload,
      attempts: 1,
      submittedAt: now,
    }]);
  if (insertError) throw insertError;
};

const deleteSubmissionIfEmpty = async ({
  supabase,
  assignmentId,
  userId,
}: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  assignmentId: string;
  userId: string;
}) => {
  const { error } = await supabase
    .from('Submission')
    .delete()
    .eq('assignmentId', assignmentId)
    .eq('userId', userId);
  if (error) throw error;
};

const loadStudentPayloads = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  assignmentId: string,
) => {
  const { data, error } = await supabase
    .from('Submission')
    .select('id, userId, payload, submittedAt')
    .eq('assignmentId', assignmentId)
    .order('submittedAt', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const loadEventsPayload = async (
  supabase: ReturnType<typeof createSupabaseServerClient>,
  assignmentId: string,
  courseId: string,
  year: string,
) => {
  const { data, error } = await supabase
    .from('Submission')
    .select('id, userId, payload, submittedAt')
    .eq('assignmentId', assignmentId)
    .order('submittedAt', { ascending: false });
  if (error) throw error;
  const latest = Array.isArray(data) ? data[0] : null;
  return normalizeAgendaEventsPayload(latest?.payload || {}, courseId, year);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = normalizeText(body?.action).toLowerCase();
    const courseId = normalizeAgendaCourseId(body?.courseId);
    const year = normalizeAgendaYear(body?.year);
    if (!courseId || !action) {
      return json({ error: 'action and courseId are required' }, 400);
    }

    const supabase = createSupabaseServerClient({ requireServiceRole: true });
    const dbUser = await ensureDbUserFromSession(supabase, session);
    if (!dbUser?.id) {
      return json({ error: 'User not found' }, 401);
    }

    const courseAccess = await getForumCourseAccess(supabase, dbUser, courseId);
    const manageAccess = await resolveLiveManageAccess(session, courseId);
    const canManage = Boolean(manageAccess.canManage || courseAccess.isTeacher);
    const canParticipate = Boolean(courseAccess.isEnrolled || canManage);

    if (!canParticipate) {
      return json({ error: 'No tenés acceso a este curso' }, 403);
    }

    const configAssignmentId = buildAgendaConfigAssignmentId(courseId, year);
    const studentAssignmentId = buildAgendaStudentAssignmentId(courseId, year);
    const eventsAssignmentId = buildAgendaEventsAssignmentId(courseId, year);

    if (action === 'save-config') {
      if (!canManage) return json({ error: 'Solo teachers pueden configurar la agenda' }, 403);
      const nextConfig = normalizeAgendaConfigPayload(body, courseId, year);
      await ensureMetaAssignment(
        supabase,
        configAssignmentId,
        courseId,
        `${courseId}/__meta__/agenda-config/${year}`,
      );

      await upsertSubmission({
        supabase,
        assignmentId: configAssignmentId,
        userId: manageAccess.userId || dbUser.id,
        payload: {
          __metaKind: COURSE_AGENDA_CONFIG_META_KIND,
          ...nextConfig,
          updatedAt: new Date().toISOString(),
          updatedBy: manageAccess.userId || dbUser.id,
          updatedByEmail: normalizeText(session?.user?.email),
        },
      });

      return json({ success: true, config: nextConfig });
    }

    if (action === 'assign-students') {
      if (!canManage) return json({ error: 'Solo teachers pueden asignar estudiantes' }, 403);
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);
      const studentIds = Array.from(
        new Set(
          (Array.isArray(body?.studentIds) ? body.studentIds : [])
            .map((value: unknown) => normalizeText(value))
            .filter(Boolean),
        ),
      );
      if (!studentIds.length) return json({ error: 'Seleccioná al menos un estudiante' }, 400);

      const { data: enrollments, error: enrollmentError } = await supabase
        .from('Enrollment')
        .select('userId, roleInCourse')
        .eq('courseId', courseId)
        .in('userId', studentIds);
      if (enrollmentError) throw enrollmentError;

      const allowedStudentIds = new Set(
        (Array.isArray(enrollments) ? enrollments : [])
          .filter((row: any) => normalizeText(row?.roleInCourse).toLowerCase() === 'student')
          .map((row: any) => normalizeText(row?.userId)),
      );

      const invalidStudentId = studentIds.find((studentId) => !allowedStudentIds.has(studentId));
      if (invalidStudentId) {
        return json({ error: 'Hay estudiantes fuera del curso activo' }, 400);
      }

      const { data: configRows, error: configError } = await supabase
        .from('Submission')
        .select('payload, submittedAt')
        .eq('assignmentId', configAssignmentId)
        .order('submittedAt', { ascending: false });
      if (configError) throw configError;
      const currentConfig = normalizeAgendaConfigPayload((configRows?.[0] as any)?.payload || {}, courseId, year);

      await ensureMetaAssignment(
        supabase,
        studentAssignmentId,
        courseId,
        `${courseId}/__meta__/agenda-student/${year}`,
      );
      const existingRows = await loadStudentPayloads(supabase, studentAssignmentId);
      const existingByStudentId = new Map<string, any>();
      existingRows.forEach((row) => {
        const studentId = normalizeText((row as any)?.payload?.studentId || row?.userId);
        if (!studentId || existingByStudentId.has(studentId)) return;
        existingByStudentId.set(studentId, row);
      });
      const updatedStudents = [] as Array<{
        studentId: string;
        color: string;
        blocks: AgendaBlock[];
      }>;

      for (const studentId of studentIds) {
        const existingPayload = normalizeAgendaStudentPayload(
          existingByStudentId.get(studentId)?.payload || {},
          courseId,
          year,
          studentId,
        ) || {
          courseId,
          year,
          studentId,
          color: normalizeText(body?.studentColors?.[studentId]),
          blocks: [],
          updatedAt: '',
        };

        const nextBlocks = selection.dateKeys.map((dateKey) => ({
          id: createAgendaBlockId(),
          dateKey,
          startMinute: selection.startMinute,
          endMinute: selection.endMinute,
          comment: '',
          updatedAt: new Date().toISOString(),
        })) as AgendaBlock[];

        const mergedBlocks = replaceBlocksInRange(
          existingPayload.blocks || [],
          new Set(selection.dateKeys),
          selection.startMinute,
          selection.endMinute,
          nextBlocks,
        );

        const totalMinutes = sumBlocksMinutes(mergedBlocks);
        if (totalMinutes > clampAgendaMaxStudentMinutes(currentConfig.maxStudentMinutes)) {
          return json({ error: 'La asignación supera el tiempo máximo por estudiante' }, 400);
        }

        await upsertSubmission({
          supabase,
          assignmentId: studentAssignmentId,
          userId: studentId,
          payload: {
            __metaKind: COURSE_AGENDA_STUDENT_META_KIND,
            courseId,
            year,
            studentId,
            color: normalizeText(body?.studentColors?.[studentId]) || existingPayload.color,
            blocks: mergedBlocks,
            updatedAt: new Date().toISOString(),
            updatedBy: manageAccess.userId || dbUser.id,
            updatedByEmail: normalizeText(session?.user?.email),
          },
        });

        updatedStudents.push({
          studentId,
          color: normalizeText(body?.studentColors?.[studentId]) || existingPayload.color,
          blocks: mergedBlocks,
        });
      }

      return json({ success: true, students: updatedStudents });
    }

    if (action === 'assign-event') {
      if (!canManage) return json({ error: 'Solo teachers pueden asignar eventos' }, 403);
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);
      const text = normalizeAgendaEventText(body?.text, 120);
      if (!text) return json({ error: 'Ingresá un texto para el evento' }, 400);

      await ensureMetaAssignment(
        supabase,
        eventsAssignmentId,
        courseId,
        `${courseId}/__meta__/agenda-events/${year}`,
      );

      const currentEventsPayload = await loadEventsPayload(supabase, eventsAssignmentId, courseId, year);
      const isVirtual = Boolean(body?.virtual);
      const nextEvents = selection.dateKeys.map((dateKey) => ({
        id: createAgendaBlockId(),
        dateKey,
        startMinute: selection.startMinute,
        endMinute: selection.endMinute,
        text,
        color: buildAgendaEventColor(text),
        virtual: isVirtual,
        updatedAt: new Date().toISOString(),
      })) as AgendaEvent[];

      const persisted = (currentEventsPayload.events || []).filter(
        (event) => !(selection.dateKeys.includes(event.dateKey) && rangesOverlap(event, selection.startMinute, selection.endMinute)),
      );

      await upsertSubmission({
        supabase,
        assignmentId: eventsAssignmentId,
        userId: manageAccess.userId || dbUser.id,
        payload: {
          __metaKind: COURSE_AGENDA_EVENTS_META_KIND,
          courseId,
          year,
          events: [...persisted, ...nextEvents],
          updatedAt: new Date().toISOString(),
          updatedBy: manageAccess.userId || dbUser.id,
          updatedByEmail: normalizeText(session?.user?.email),
        },
      });

      return json({ success: true, events: [...persisted, ...nextEvents] });
    }

    if (action === 'clear-range') {
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);
      if (!canManage) return json({ error: 'Solo teachers pueden borrar cualquier rango' }, 403);

      const studentRows = await loadStudentPayloads(supabase, studentAssignmentId);
      for (const row of studentRows) {
        const payload = normalizeAgendaStudentPayload(row?.payload || {}, courseId, year, row?.userId || '');
        if (!payload) continue;
        const nextBlocks = replaceBlocksInRange(
          payload.blocks || [],
          new Set(selection.dateKeys),
          selection.startMinute,
          selection.endMinute,
          [],
        );
        if (nextBlocks.length === 0) {
          await deleteSubmissionIfEmpty({
            supabase,
            assignmentId: studentAssignmentId,
            userId: normalizeText(row?.userId),
          });
          continue;
        }
        await upsertSubmission({
          supabase,
          assignmentId: studentAssignmentId,
          userId: normalizeText(row?.userId),
          payload: {
            __metaKind: COURSE_AGENDA_STUDENT_META_KIND,
            courseId,
            year,
            studentId: payload.studentId,
            color: payload.color,
            blocks: nextBlocks,
            updatedAt: new Date().toISOString(),
            updatedBy: manageAccess.userId || dbUser.id,
            updatedByEmail: normalizeText(session?.user?.email),
          },
        });
      }

      const currentEvents = await loadEventsPayload(supabase, eventsAssignmentId, courseId, year);
      const remainingEvents = (currentEvents.events || []).filter(
        (event) => !(selection.dateKeys.includes(event.dateKey) && rangesOverlap(event, selection.startMinute, selection.endMinute)),
      );
      await ensureMetaAssignment(
        supabase,
        eventsAssignmentId,
        courseId,
        `${courseId}/__meta__/agenda-events/${year}`,
      );
      await upsertSubmission({
        supabase,
        assignmentId: eventsAssignmentId,
        userId: manageAccess.userId || dbUser.id,
        payload: {
          __metaKind: COURSE_AGENDA_EVENTS_META_KIND,
          courseId,
          year,
          events: remainingEvents,
          updatedAt: new Date().toISOString(),
          updatedBy: manageAccess.userId || dbUser.id,
          updatedByEmail: normalizeText(session?.user?.email),
        },
      });

      return json({ success: true });
    }

    if (action === 'reserve-group') {
      const grupo = normalizeText(body?.grupo);
      if (!grupo) return json({ error: 'grupo es requerido' }, 400);
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);

      // Load student meta to find members of the grupo
      const metaAssignmentId = `__meta__:course-student-profile:${encodeURIComponent(courseId)}:${year}`;
      const { data: metaRows, error: metaError } = await supabase
        .from('Submission')
        .select('userId, payload')
        .eq('assignmentId', metaAssignmentId);
      if (metaError) throw metaError;

      const groupStudentIds = (Array.isArray(metaRows) ? metaRows : [])
        .filter((row: any) => normalizeText(row?.payload?.grupo) === grupo)
        .map((row: any) => normalizeText(row?.userId))
        .filter(Boolean) as string[];

      if (groupStudentIds.length === 0) {
        return json({ error: `No hay estudiantes en el Grupo ${grupo}` }, 400);
      }

      // Students can only reserve for their own group
      if (!canManage && !groupStudentIds.includes(dbUser.id)) {
        return json({ error: 'No pertenecés a este grupo' }, 403);
      }

      const { data: configRows, error: configError } = await supabase
        .from('Submission')
        .select('payload, submittedAt')
        .eq('assignmentId', configAssignmentId)
        .order('submittedAt', { ascending: false });
      if (configError) throw configError;
      const currentConfig = normalizeAgendaConfigPayload((configRows?.[0] as any)?.payload || {}, courseId, year);

      await ensureMetaAssignment(supabase, studentAssignmentId, courseId, `${courseId}/__meta__/agenda-student/${year}`);
      const existingRows = await loadStudentPayloads(supabase, studentAssignmentId);
      const existingByStudentId = new Map<string, any>();
      existingRows.forEach((row) => {
        const sid = normalizeText((row as any)?.payload?.studentId || row?.userId);
        if (sid && !existingByStudentId.has(sid)) existingByStudentId.set(sid, row);
      });

      for (const studentId of groupStudentIds) {
        const existingPayload = normalizeAgendaStudentPayload(
          existingByStudentId.get(studentId)?.payload || {},
          courseId, year, studentId,
        ) || { courseId, year, studentId, color: '', blocks: [], updatedAt: '' };

        const nextBlocks = selection.dateKeys.map((dateKey) => ({
          id: createAgendaBlockId(),
          dateKey,
          startMinute: selection.startMinute,
          endMinute: selection.endMinute,
          comment: '',
          updatedAt: new Date().toISOString(),
        })) as AgendaBlock[];

        const mergedBlocks = replaceBlocksInRange(
          existingPayload.blocks || [],
          new Set(selection.dateKeys),
          selection.startMinute,
          selection.endMinute,
          nextBlocks,
        );

        const totalMinutes = sumBlocksMinutes(mergedBlocks);
        if (totalMinutes > clampAgendaMaxStudentMinutes(currentConfig.maxStudentMinutes)) {
          return json({ error: `El Grupo ${grupo} supera el tiempo máximo por estudiante` }, 400);
        }

        await upsertSubmission({
          supabase,
          assignmentId: studentAssignmentId,
          userId: studentId,
          payload: {
            __metaKind: COURSE_AGENDA_STUDENT_META_KIND,
            courseId, year, studentId,
            color: existingPayload.color || '',
            blocks: mergedBlocks,
            updatedAt: new Date().toISOString(),
            updatedBy: dbUser.id,
            updatedByEmail: normalizeText(session?.user?.email),
          },
        });
      }

      return json({ success: true, grupo, studentIds: groupStudentIds });
    }

    if (action === 'reserve-self') {
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);
      if (!courseAccess.isEnrolled && !canManage) {
        return json({ error: 'Solo estudiantes inscriptos pueden reservar' }, 403);
      }

      const { data: configRows, error: configError } = await supabase
        .from('Submission')
        .select('payload, submittedAt')
        .eq('assignmentId', configAssignmentId)
        .order('submittedAt', { ascending: false });
      if (configError) throw configError;
      const currentConfig = normalizeAgendaConfigPayload((configRows?.[0] as any)?.payload || {}, courseId, year);

      await ensureMetaAssignment(
        supabase,
        studentAssignmentId,
        courseId,
        `${courseId}/__meta__/agenda-student/${year}`,
      );

      const existingRows = await loadStudentPayloads(supabase, studentAssignmentId);
      const existingSubmission = existingRows.find((row) => normalizeText(row?.userId) === dbUser.id) || null;
      const existingPayload = normalizeAgendaStudentPayload(existingSubmission?.payload || {}, courseId, year, dbUser.id) || {
        courseId,
        year,
        studentId: dbUser.id,
        color: '',
        blocks: [],
        updatedAt: '',
      };

      const nextBlocks = selection.dateKeys.map((dateKey) => ({
        id: createAgendaBlockId(),
        dateKey,
        startMinute: selection.startMinute,
        endMinute: selection.endMinute,
        comment: '',
        updatedAt: new Date().toISOString(),
      })) as AgendaBlock[];

      const mergedBlocks = replaceBlocksInRange(
        existingPayload.blocks || [],
        new Set(selection.dateKeys),
        selection.startMinute,
        selection.endMinute,
        nextBlocks,
      );
      const totalMinutes = sumBlocksMinutes(mergedBlocks);
      if (totalMinutes > clampAgendaMaxStudentMinutes(currentConfig.maxStudentMinutes)) {
        return json({ error: 'Supera el tiempo asignado por estudiante' }, 400);
      }

      const updatedPayload = {
        __metaKind: COURSE_AGENDA_STUDENT_META_KIND,
        courseId,
        year,
        studentId: dbUser.id,
        color: existingPayload.color || body?.color,
        blocks: mergedBlocks,
        updatedAt: new Date().toISOString(),
        updatedBy: dbUser.id,
        updatedByEmail: normalizeText(session?.user?.email),
      };

      await upsertSubmission({
        supabase,
        assignmentId: studentAssignmentId,
        userId: dbUser.id,
        payload: updatedPayload,
      });

      return json({ success: true, student: updatedPayload });
    }

    if (action === 'delete-own') {
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);
      const existingRows = await loadStudentPayloads(supabase, studentAssignmentId);
      const existingSubmission = existingRows.find((row) => normalizeText(row?.userId) === dbUser.id) || null;
      if (!existingSubmission) return json({ success: true });
      const existingPayload = normalizeAgendaStudentPayload(existingSubmission.payload || {}, courseId, year, dbUser.id);
      if (!existingPayload) return json({ success: true });
      const nextBlocks = replaceBlocksInRange(
        existingPayload.blocks || [],
        new Set(selection.dateKeys),
        selection.startMinute,
        selection.endMinute,
        [],
      );
      if (nextBlocks.length === 0) {
        await deleteSubmissionIfEmpty({
          supabase,
          assignmentId: studentAssignmentId,
          userId: dbUser.id,
        });
      } else {
        await upsertSubmission({
          supabase,
          assignmentId: studentAssignmentId,
          userId: dbUser.id,
          payload: {
            __metaKind: COURSE_AGENDA_STUDENT_META_KIND,
            courseId,
            year,
            studentId: dbUser.id,
            color: existingPayload.color,
            blocks: nextBlocks,
            updatedAt: new Date().toISOString(),
            updatedBy: dbUser.id,
            updatedByEmail: normalizeText(session?.user?.email),
          },
        });
      }
      return json({ success: true });
    }

    if (action === 'clear-range') {
      const selection = normalizeSelectedRange(body);
      if (!selection) return json({ error: 'Rango inválido' }, 400);
      if (!canManage) return json({ error: 'Solo teachers pueden borrar cualquier rango' }, 403);

      // Clear events
      const currentEventsPayload = await loadEventsPayload(supabase, eventsAssignmentId, courseId, year);
      const remainingEvents = (currentEventsPayload.events || []).filter(
        (event) => !(selection.dateKeys.includes(event.dateKey) && rangesOverlap(event, selection.startMinute, selection.endMinute)),
      );
      
      await upsertSubmission({
        supabase,
        assignmentId: eventsAssignmentId,
        userId: manageAccess.userId || dbUser.id,
        payload: {
          ...currentEventsPayload,
          events: remainingEvents,
          updatedAt: new Date().toISOString(),
        },
      });

      // Clear student blocks
      const studentRows = await loadStudentPayloads(supabase, studentAssignmentId);
      const updatedStudents = [];
      for (const row of studentRows) {
        const payload = normalizeAgendaStudentPayload(row?.payload || {}, courseId, year, row?.userId || '');
        if (!payload) continue;
        const nextBlocks = replaceBlocksInRange(
          payload.blocks || [],
          new Set(selection.dateKeys),
          selection.startMinute,
          selection.endMinute,
          [], // empty means remove
        );

        if (nextBlocks.length !== payload.blocks.length) {
          const nextPayload = {
            ...payload,
            blocks: nextBlocks,
            updatedAt: new Date().toISOString(),
          };
          if (nextBlocks.length === 0) {
            await deleteSubmissionIfEmpty({ supabase, assignmentId: studentAssignmentId, userId: normalizeText(row?.userId) });
          } else {
            await upsertSubmission({
              supabase,
              assignmentId: studentAssignmentId,
              userId: normalizeText(row?.userId),
              payload: nextPayload,
            });
          }
          updatedStudents.push(nextPayload);
        }
      }
      return json({ success: true, events: remainingEvents, students: updatedStudents });
    }

    if (action === 'delete-block') {
      const blockId = normalizeText(body?.blockId);
      if (!blockId) return json({ error: 'blockId es requerido' }, 400);

      // Try events first
      const currentEvents = await loadEventsPayload(supabase, eventsAssignmentId, courseId, year);
      const eventIndex = currentEvents.events.findIndex((e) => e.id === blockId);
      if (eventIndex !== -1) {
        if (!canManage) return json({ error: 'Solo teachers pueden borrar eventos' }, 403);
        const nextEvents = currentEvents.events.filter((e) => e.id !== blockId);
        await upsertSubmission({
          supabase,
          assignmentId: eventsAssignmentId,
          userId: manageAccess.userId || dbUser.id,
          payload: {
            __metaKind: COURSE_AGENDA_EVENTS_META_KIND,
            courseId,
            year,
            events: nextEvents,
            updatedAt: new Date().toISOString(),
          },
        });
        return json({ success: true });
      }

      // Try student blocks
      const studentRows = await loadStudentPayloads(supabase, studentAssignmentId);
      for (const row of studentRows) {
        const payload = normalizeAgendaStudentPayload(row?.payload || {}, courseId, year, row?.userId || '');
        if (!payload) continue;
        const blockIndex = payload.blocks.findIndex((b) => b.id === blockId);
        if (blockIndex !== -1) {
          const isOwnBlock = normalizeText(row?.userId) === dbUser.id;
          if (!canManage && !isOwnBlock) {
            return json({ error: 'No tenés permiso para borrar este bloque' }, 403);
          }
          const nextBlocks = payload.blocks.filter((b) => b.id !== blockId);
          if (nextBlocks.length === 0) {
            await deleteSubmissionIfEmpty({ supabase, assignmentId: studentAssignmentId, userId: normalizeText(row?.userId) });
          } else {
            await upsertSubmission({
              supabase,
              assignmentId: studentAssignmentId,
              userId: normalizeText(row?.userId),
              payload: {
                ...payload,
                blocks: nextBlocks,
                updatedAt: new Date().toISOString(),
              },
            });
          }
          return json({ success: true });
        }
      }
      return json({ error: 'Bloque no encontrado' }, 404);
    }

    if (action === 'update-block' || action === 'move-block') {
      const blockId = normalizeText(body?.blockId);
      if (!blockId) return json({ error: 'blockId es requerido' }, 400);

      // Try events
      const currentEvents = await loadEventsPayload(supabase, eventsAssignmentId, courseId, year);
      const eventIndex = currentEvents.events.findIndex((e) => e.id === blockId);
      if (eventIndex !== -1) {
        if (!canManage) return json({ error: 'Solo teachers pueden editar eventos' }, 403);
        const event = currentEvents.events[eventIndex];
        const nextEvent = {
          ...event,
          text: normalizeAgendaEventText(body?.text || event.text),
          dateKey: normalizeAgendaDateKey(body?.dateKey || event.dateKey),
          startMinute: normalizeMinute(body?.startMinute ?? event.startMinute),
          endMinute: normalizeMinute(body?.endMinute ?? event.endMinute),
          virtual: body?.virtual !== undefined ? Boolean(body.virtual) : event.virtual,
          updatedAt: new Date().toISOString(),
        };
        const nextEvents = [...currentEvents.events];
        nextEvents[eventIndex] = nextEvent;
        await upsertSubmission({
          supabase,
          assignmentId: eventsAssignmentId,
          userId: manageAccess.userId || dbUser.id,
          payload: {
            __metaKind: COURSE_AGENDA_EVENTS_META_KIND,
            courseId,
            year,
            events: nextEvents,
            updatedAt: new Date().toISOString(),
          },
        });
        return json({ success: true });
      }

      // Try student blocks
      const studentRows = await loadStudentPayloads(supabase, studentAssignmentId);
      for (const row of studentRows) {
        const payload = normalizeAgendaStudentPayload(row?.payload || {}, courseId, year, row?.userId || '');
        if (!payload) continue;
        const blockIndex = payload.blocks.findIndex((b) => b.id === blockId);
        if (blockIndex !== -1) {
          const isOwnBlock = normalizeText(row?.userId) === dbUser.id;
          if (!canManage && !isOwnBlock) {
            return json({ error: 'No tenés permiso para editar este bloque' }, 403);
          }
          const block = payload.blocks[blockIndex];
          const nextBlock = {
            ...block,
            comment: normalizeAgendaComment(body?.comment ?? block.comment, 280),
            dateKey: normalizeAgendaDateKey(body?.dateKey || block.dateKey),
            startMinute: normalizeMinute(body?.startMinute ?? block.startMinute),
            endMinute: normalizeMinute(body?.endMinute ?? block.endMinute),
            updatedAt: new Date().toISOString(),
          };
          const nextBlocks = [...payload.blocks];
          nextBlocks[blockIndex] = nextBlock;
          await upsertSubmission({
            supabase,
            assignmentId: studentAssignmentId,
            userId: normalizeText(row?.userId),
            payload: {
              ...payload,
              blocks: nextBlocks,
              updatedAt: new Date().toISOString(),
            },
          });
          return json({ success: true });
        }
      }
      return json({ error: 'Bloque no encontrado' }, 404);
    }

    if (action === 'save-comment') {
      const blockId = normalizeText(body?.blockId);
      const comment = normalizeAgendaComment(body?.comment, 280);
      if (!blockId) return json({ error: 'blockId es requerido' }, 400);

      const existingRows = await loadStudentPayloads(supabase, studentAssignmentId);
      const existingSubmission = existingRows.find((row) => normalizeText(row?.userId) === dbUser.id) || null;
      if (!existingSubmission) return json({ error: 'No se encontró tu agenda' }, 404);
      const existingPayload = normalizeAgendaStudentPayload(existingSubmission.payload || {}, courseId, year, dbUser.id);
      if (!existingPayload) return json({ error: 'No se encontró tu agenda' }, 404);

      let found = false;
      const nextBlocks = (existingPayload.blocks || []).map((block) => {
        if (block.id !== blockId) return block;
        found = true;
        return {
          ...block,
          comment,
          updatedAt: new Date().toISOString(),
        };
      });
      if (!found) return json({ error: 'Bloque no encontrado' }, 404);

      await upsertSubmission({
        supabase,
        assignmentId: studentAssignmentId,
        userId: dbUser.id,
        payload: {
          __metaKind: COURSE_AGENDA_STUDENT_META_KIND,
          courseId,
          year,
          studentId: dbUser.id,
          color: existingPayload.color,
          blocks: nextBlocks,
          updatedAt: new Date().toISOString(),
          updatedBy: dbUser.id,
          updatedByEmail: normalizeText(session?.user?.email),
        },
      });

      return json({ success: true });
    }

    return json({ error: 'Acción no soportada' }, 400);
  } catch (error: any) {
    console.error('Error handling dashboard agenda action:', error);
    return json({ error: error?.message || 'No se pudo actualizar la agenda' }, 500);
  }
};
