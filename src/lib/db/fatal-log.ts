/**
 * Fatal query errors repeat by the thousand when a caller keeps hitting the same schema or data
 * problem (one 4 GB error log in three weeks). Log the first occurrence of each distinct failure,
 * then at most one line per window with the number of repeats that were suppressed.
 */
export type FatalLogger = (key: string, entry: Record<string, unknown>) => void;

export interface FatalLoggerOptions {
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
  write?: (entry: Record<string, unknown>) => void;
}

export function createFatalLogger(options: FatalLoggerOptions = {}): FatalLogger {
  const windowMs = options.windowMs ?? 60_000;
  const maxKeys = options.maxKeys ?? 200;
  const now = options.now ?? Date.now;
  const write = options.write ?? ((entry) => console.error('[DB-QUERY] Fatal Error', entry));
  const seen = new Map<string, { lastLoggedAt: number; suppressed: number }>();

  return (key, entry) => {
    const at = now();
    const previous = seen.get(key);

    if (previous && at - previous.lastLoggedAt < windowMs) {
      previous.suppressed += 1;
      return;
    }

    if (!previous && seen.size >= maxKeys) seen.clear();

    write(previous?.suppressed ? { ...entry, repeatedSincePreviousLog: previous.suppressed } : entry);
    seen.set(key, { lastLoggedAt: at, suppressed: 0 });
  };
}
