// Spaced-repetition scheduler (SM-2) for eval blocks with `spaced.enabled`.
// Model documented in s123/EVALUATION.md §5. The scheduler is a side-channel:
// it must never break the submission flow (callers wrap it in try/catch).

export interface SrsState {
  reps: number;
  easeFactor: number;
  intervalDays: number;
}

export interface SrsResult extends SrsState {
  dueAt: Date;
  quality: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;

const clampQuality = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
};

/**
 * Derive an SM-2 response quality (0..5) from a submission outcome.
 * Higher declared confidence on a wrong answer penalises more (worse calibration);
 * higher confidence on a correct answer rewards more.
 */
export function qualityFromOutcome(
  isCorrect: boolean,
  opts: { score?: number | null; confidence?: number | null } = {},
): number {
  const { score, confidence } = opts;
  const hasConfidence = typeof confidence === 'number' && Number.isFinite(confidence);

  if (!isCorrect) {
    if (hasConfidence) {
      if ((confidence as number) >= 66) return 0;
      if ((confidence as number) >= 33) return 1;
      return 2;
    }
    if (typeof score === 'number' && Number.isFinite(score)) {
      return score >= 0.5 ? 2 : 1;
    }
    return 2;
  }

  if (hasConfidence) {
    if ((confidence as number) >= 66) return 5;
    if ((confidence as number) >= 33) return 4;
    return 3;
  }
  return 4;
}

/**
 * SM-2 update. On a lapse (q < 3) reps reset to 0, interval to 1 day and the
 * ease factor is conserved (floored at 1.3). On success the ease factor is
 * updated and intervals follow 1, 6, ceil(prev * EF').
 */
export function sm2(state: SrsState, quality: number, now: Date = new Date()): SrsResult {
  const q = clampQuality(quality);
  const prevEase = Number.isFinite(state.easeFactor) ? state.easeFactor : 2.5;
  const prevReps = Number.isFinite(state.reps) ? state.reps : 0;
  const prevInterval = Number.isFinite(state.intervalDays) ? state.intervalDays : 0;

  let reps: number;
  let easeFactor: number;
  let intervalDays: number;

  if (q < 3) {
    reps = 0;
    intervalDays = 1;
    easeFactor = Math.max(MIN_EASE, prevEase);
  } else {
    easeFactor = Math.max(MIN_EASE, prevEase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    reps = prevReps + 1;
    if (reps === 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 6;
    else intervalDays = Math.ceil(prevInterval * easeFactor);
  }

  const dueAt = new Date(now.getTime() + intervalDays * MS_PER_DAY);
  return { reps, easeFactor, intervalDays, dueAt, quality: q };
}
