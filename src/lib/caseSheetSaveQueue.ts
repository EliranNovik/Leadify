/**
 * The autosave queue for the Case Handling sheet.
 *
 * Typing must never wait for the network, so edits land in the grid immediately and are collected
 * here to be written in batches. Two things make that harder than it sounds:
 *
 *  - The same cell gets edited repeatedly while someone types. Only the final value is worth
 *    sending, so pending edits are keyed by cell address and the newest value replaces the previous.
 *
 *  - A save can fail while the handler keeps typing. Putting the failed batch back has to not undo
 *    anything typed since, which is the rule in `requeue` below and the reason this is its own
 *    module rather than a hook body.
 *
 * No timers live here. The component decides when to flush, so this stays testable without waiting
 * on real time.
 */
import type { CaseSheetCellChange } from './caseSheetGrid';
import { cellKey } from './caseSheetGrid';

export type CaseSheetSaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export type CaseSheetSaveFn = (changes: CaseSheetCellChange[]) => Promise<void>;

export class CaseSheetSaveQueue {
  private pending = new Map<string, CaseSheetCellChange>();
  private inFlight = new Map<string, CaseSheetCellChange>();
  private lastError: Error | null = null;
  private saving = false;

  constructor(private readonly save: CaseSheetSaveFn) {}

  /** Newest value per cell wins, so holding a key down sends one write rather than twelve. */
  enqueue(changes: CaseSheetCellChange[]): void {
    for (const change of changes) {
      this.pending.set(cellKey(change.rowIndex, change.colIndex), change);
    }
  }

  get status(): CaseSheetSaveStatus {
    if (this.saving) return 'saving';
    if (this.lastError) return 'error';
    return this.pending.size > 0 ? 'pending' : 'saved';
  }

  /** Drives the "N unsaved" hint, and tells the component whether it is safe to close the tab. */
  get pendingCount(): number {
    return this.pending.size;
  }

  get hasUnsavedWork(): boolean {
    return this.pending.size > 0 || this.inFlight.size > 0;
  }

  get error(): Error | null {
    return this.lastError;
  }

  /**
   * Writes everything queued.
   *
   * Only one batch is ever in flight: a second concurrent flush would let an older value land after
   * a newer one, since nothing guarantees two requests finish in the order they were sent.
   */
  async flush(): Promise<void> {
    if (this.saving) return;
    if (this.pending.size === 0) {
      this.lastError = null;
      return;
    }

    this.inFlight = this.pending;
    this.pending = new Map();
    this.saving = true;

    try {
      await this.save([...this.inFlight.values()]);
      this.inFlight = new Map();
      this.lastError = null;
    } catch (err) {
      this.requeue();
      this.lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      this.saving = false;
    }
  }

  /**
   * Returns a failed batch to the queue without overwriting anything typed since it left.
   *
   * A cell already waiting in `pending` holds a newer value than the one that failed, so the failed
   * value is dropped for that cell. Restoring it would resurrect an old value on top of a new one —
   * silent data loss that only shows up after a dropped connection.
   */
  private requeue(): void {
    for (const [key, change] of this.inFlight) {
      if (this.pending.has(key)) continue;
      this.pending.set(key, change);
    }
    this.inFlight = new Map();
  }

  /** Lets a retry proceed after the handler has been told about a failure. */
  clearError(): void {
    this.lastError = null;
  }
}
