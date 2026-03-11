export const getRemainingMs = (endsAt, now = Date.now()) => {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - now);
};

export const formatCountdown = (remainingMs) => {
  if (remainingMs === null || remainingMs === undefined) return '--:--';
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
