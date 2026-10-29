export interface StudentCandidate {
  id: string;
  name: string;
  email: string | null;
}

export interface AmigxCriticxPair {
  authorUserId: string;
  recipientUserId: string;
}

export interface AmigxCriticxReviewRecord {
  id: string;
  courseId: string;
  authorUserId: string;
  authorName: string;
  recipientUserId: string;
  recipientName: string;
  descripcion: string;
  funcionaNoFunciona: string;
  hariaDistinto: string;
  recipientResponse: string;
  recipientRespondedAt: string | null;
  isPublic: boolean;
  status: 'claimed' | 'submitted';
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PairValidationErrorCode =
  | 'SELF'
  | 'ALREADY_TAKEN'
  | 'RECIPROCAL'
  | 'INVALID_INPUT';

export type PairValidationResult =
  | { ok: true }
  | { ok: false; code: PairValidationErrorCode; message: string };

/**
 * Counts words in a text block (no word limit enforced).
 */
export function countWords(text: unknown): number {
  const normalized = String(text ?? '').trim();
  if (!normalized) return 0;
  return normalized.split(/\s+/).filter(Boolean).length;
}

/**
 * Validates whether `authorUserId` can select `recipientUserId` under the urn rules:
 * 1. Cannot select oneself (`SELF`)
 * 2. First-come, first-served urn: `recipientUserId` cannot already be selected by someone else (`ALREADY_TAKEN`)
 * 3. Non-reciprocal: if `recipientUserId` has already selected `authorUserId`, crossed critical friends are forbidden (`RECIPROCAL`)
 */
export function validatePairSelection(
  authorUserId: string,
  recipientUserId: string,
  existingPairs: readonly AmigxCriticxPair[],
): PairValidationResult {
  const author = String(authorUserId || '').trim();
  const recipient = String(recipientUserId || '').trim();

  if (!author || !recipient) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Debés seleccionar unx alumnx válidx de la lista.',
    };
  }

  if (author === recipient) {
    return {
      ok: false,
      code: 'SELF',
      message: 'No podés elegirte a vos mismx como amigx críticx.',
    };
  }

  for (const pair of existingPairs) {
    const pairAuthor = String(pair.authorUserId || '').trim();
    const pairRecipient = String(pair.recipientUserId || '').trim();

    // First-come, first-take: recipient already chosen by another student
    if (pairRecipient === recipient && pairAuthor !== author) {
      return {
        ok: false,
        code: 'ALREADY_TAKEN',
        message: 'Estx alumnx ya fue elegidx por otrx compañerx en la urna.',
      };
    }

    // Non-reciprocal rule: recipient has already chosen author as their target
    if (pairAuthor === recipient && pairRecipient === author) {
      return {
        ok: false,
        code: 'RECIPROCAL',
        message: 'No puede ser recíproco (amigos críticos cruzados): estx alumnx ya es tu amigx críticx.',
      };
    }
  }

  return { ok: true };
}

/**
 * Computes the available active students in the urn dropdown for `currentUserId`.
 * Filters out:
 * - `currentUserId`
 * - students already taken as `recipientUserId` by someone else
 * - the student who chose `currentUserId` as their `recipientUserId` (non-reciprocal rule)
 */
export function computeUrnCandidates(
  activeStudents: readonly StudentCandidate[],
  existingPairs: readonly AmigxCriticxPair[],
  currentUserId: string,
): StudentCandidate[] {
  const me = String(currentUserId || '').trim();

  const takenByOthers = new Set<string>();
  const choseMe = new Set<string>();

  for (const pair of existingPairs) {
    const pairAuthor = String(pair.authorUserId || '').trim();
    const pairRecipient = String(pair.recipientUserId || '').trim();
    if (!pairAuthor || !pairRecipient) continue;

    if (pairAuthor !== me) {
      takenByOthers.add(pairRecipient);
    }
    if (pairRecipient === me) {
      choseMe.add(pairAuthor);
    }
  }

  return activeStudents
    .filter((student) => {
      const id = String(student.id || '').trim();
      if (!id || id === me) return false;
      if (takenByOthers.has(id)) return false;
      if (choseMe.has(id)) return false;
      return true;
    })
    .sort((a, b) =>
      String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'es', {
        sensitivity: 'base',
      }),
    );
}

/**
 * Visibility check per §27.3.8 + HACER PÚBLICO toggle:
 * Visible to:
 * - Teachers / admins (`isTeacher === true`)
 * - The author (`review.authorUserId === viewerUserId`)
 * - The recipient (`review.recipientUserId === viewerUserId`)
 * - Any enrolled student if `review.isPublic === true` and `review.status === 'submitted'`
 */
export function canViewReview(
  review: Pick<AmigxCriticxReviewRecord, 'authorUserId' | 'recipientUserId' | 'isPublic' | 'status'>,
  viewerUserId: string,
  isTeacher: boolean,
): boolean {
  if (isTeacher) return true;
  const viewer = String(viewerUserId || '').trim();
  if (!viewer) return false;
  if (review.authorUserId === viewer) return true;
  if (review.recipientUserId === viewer) return true;
  if (review.isPublic && review.status === 'submitted') return true;
  return false;
}
