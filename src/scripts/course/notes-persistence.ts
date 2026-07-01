// src/scripts/course/notes-persistence.ts
import { saveNote } from '../notes-editor/api';

type Status = 'idle' | 'pending' | 'saving' | 'error';

export type PersistenceState = {
  status: Status;
  error?: string;
};

export type PersistenceOptions = {
  onStatusChange?: (state: PersistenceState) => void;
  debounceMs?: number;
};

const DRAFT_PREFIX = 'notes-draft::';

export class NotesPersistence {
  private readonly courseId: string;
  private readonly slug: string;
  private readonly debounceMs: number;
  private readonly onStatusChange: (s: PersistenceState) => void;

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private pendingContent: string | null = null;
  private status: Status = 'idle';
  private flushResolvers: Array<() => void> = [];

  constructor(courseId: string, slug: string, opts: PersistenceOptions = {}) {
    this.courseId = courseId;
    this.slug = slug;
    this.debounceMs = opts.debounceMs ?? 1500;
    this.onStatusChange = opts.onStatusChange ?? (() => {});
  }

  private get storageKey(): string {
    return `${DRAFT_PREFIX}${this.courseId}::${this.slug}`;
  }

  private setStatus(s: Status, error?: string) {
    this.status = s;
    this.onStatusChange({ status: s, error });
  }

  onChange(content: string): void {
    this.pendingContent = content;
    // Write to localStorage immediately (crash-safe buffer)
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        content,
        ts: Date.now(),
      }));
    } catch {
      // localStorage full or unavailable — not fatal
    }
    // Reset debounce
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.setStatus('pending');
    this.timerId = setTimeout(() => this.write(), this.debounceMs);
  }

  private async write(): Promise<void> {
    if (this.pendingContent === null) return;
    const content = this.pendingContent;
    this.timerId = null;
    this.setStatus('saving');
    try {
      await saveNote(this.courseId, this.slug, content);
      this.pendingContent = null;
      // Clear localStorage draft on successful save
      try { localStorage.removeItem(this.storageKey); } catch {}
      this.setStatus('idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la nota.';
      console.error('[notes-persistence] save failed', {
        courseId: this.courseId,
        slug: this.slug,
        error: message,
      });
      this.setStatus('error', message);
    } finally {
      // Resolve any flush() waiters
      this.flushResolvers.forEach(r => r());
      this.flushResolvers = [];
    }
  }

  async flush(): Promise<void> {
    if (this.timerId === null && this.pendingContent === null) return;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    await new Promise<void>(resolve => {
      this.flushResolvers.push(resolve);
      this.write();
    });
  }

  recover(): { content: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { content: string; ts: number };
    } catch {
      return null;
    }
  }

  discardDraft(): void {
    try { localStorage.removeItem(this.storageKey); } catch {}
  }

  destroy(): void {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
    this.pendingContent = null;
    this.flushResolvers = [];
    this.setStatus('idle');
  }
}
