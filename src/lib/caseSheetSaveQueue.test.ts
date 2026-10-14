import test from 'node:test';
import assert from 'node:assert/strict';

import { CaseSheetSaveQueue } from './caseSheetSaveQueue';
import type { CaseSheetCellChange } from './caseSheetGrid';

const change = (rowIndex: number, colIndex: number, value: string): CaseSheetCellChange => ({
  rowIndex,
  colIndex,
  value,
});

/**
 * Records what each flush was asked to write.
 *
 * Saves complete on their own unless a test calls `hold`, which is what lets a test inspect the
 * queue mid-flight; `release` and `fail` settle the held save and hand control back.
 */
function recordingSave() {
  const batches: CaseSheetCellChange[][] = [];
  const held: { resolve: () => void; reject: (err: Error) => void }[] = [];
  let holding = false;

  const save = (changes: CaseSheetCellChange[]) => {
    batches.push(changes);
    if (!holding) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      held.push({ resolve, reject });
    });
  };

  return {
    batches,
    save,
    hold: () => {
      holding = true;
    },
    resolve: () => {
      holding = false;
      held.shift()?.resolve();
    },
    reject: (err: Error) => {
      holding = false;
      held.shift()?.reject(err);
    },
  };
}

test('a queue with nothing in it reports saved', () => {
  const queue = new CaseSheetSaveQueue(async () => {});
  assert.equal(queue.status, 'saved');
  assert.equal(queue.hasUnsavedWork, false);
});

test('repeated edits to one cell collapse to a single write of the final value', () => {
  // Someone typing "Tamar" produces five edits; only the finished word is worth sending.
  const queue = new CaseSheetSaveQueue(async () => {});
  queue.enqueue([change(0, 0, 'T')]);
  queue.enqueue([change(0, 0, 'Ta')]);
  queue.enqueue([change(0, 0, 'Tamar')]);
  assert.equal(queue.pendingCount, 1);
});

test('edits to different cells are all kept', () => {
  const queue = new CaseSheetSaveQueue(async () => {});
  queue.enqueue([change(0, 0, 'a'), change(0, 1, 'b'), change(1, 0, 'c')]);
  assert.equal(queue.pendingCount, 3);
});

test('a flush writes the queued edits and leaves the queue saved', async () => {
  const batches: CaseSheetCellChange[][] = [];
  const queue = new CaseSheetSaveQueue(async (changes) => {
    batches.push(changes);
  });

  queue.enqueue([change(0, 0, 'Tamar')]);
  assert.equal(queue.status, 'pending');

  await queue.flush();

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [change(0, 0, 'Tamar')]);
  assert.equal(queue.status, 'saved');
  assert.equal(queue.hasUnsavedWork, false);
});

test('flushing an empty queue does not call the save function', async () => {
  let calls = 0;
  const queue = new CaseSheetSaveQueue(async () => {
    calls += 1;
  });
  await queue.flush();
  assert.equal(calls, 0);
});

test('only one batch is ever in flight', async () => {
  /*
   * Two concurrent requests can finish in either order, which would let an older value for a cell
   * land after a newer one.
   */
  const io = recordingSave();
  const queue = new CaseSheetSaveQueue(io.save);

  io.hold();
  queue.enqueue([change(0, 0, 'first')]);
  const firstFlush = queue.flush();
  assert.equal(queue.status, 'saving');

  queue.enqueue([change(0, 0, 'second')]);
  await queue.flush();
  assert.equal(io.batches.length, 1, 'the second flush must wait rather than overlap');

  io.resolve();
  await firstFlush;

  // The newer value is still queued and goes out on the next flush.
  assert.equal(queue.pendingCount, 1);
  await queue.flush();
  assert.deepEqual(io.batches[1], [change(0, 0, 'second')]);
});

test('edits made during a save are not lost', async () => {
  const io = recordingSave();
  const queue = new CaseSheetSaveQueue(io.save);

  io.hold();
  queue.enqueue([change(0, 0, 'saving this')]);
  const inFlight = queue.flush();
  queue.enqueue([change(5, 2, 'typed meanwhile')]);

  io.resolve();
  await inFlight;

  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.status, 'pending');
  await queue.flush();
  assert.deepEqual(io.batches[1], [change(5, 2, 'typed meanwhile')]);
});

test('a failed save is reported and the edits are kept for a retry', async () => {
  const io = recordingSave();
  const queue = new CaseSheetSaveQueue(io.save);

  io.hold();
  queue.enqueue([change(0, 0, 'Tamar')]);
  const flush = queue.flush();
  io.reject(new Error('network down'));
  await flush;

  assert.equal(queue.status, 'error');
  assert.equal(queue.error?.message, 'network down');
  assert.equal(queue.hasUnsavedWork, true, 'the edit must survive the failure');

  queue.clearError();
  await queue.flush();
  assert.deepEqual(io.batches[1], [change(0, 0, 'Tamar')]);
});

test('a failed save does not resurrect an old value over one typed since', async () => {
  /*
   * This is the bug the queue exists to prevent. The handler types "first", the save fails, and in
   * the meantime they have typed "second" into the same cell. Putting the failed batch back must not
   * put "first" on top of "second" — the handler would watch their own correction vanish.
   */
  const io = recordingSave();
  const queue = new CaseSheetSaveQueue(io.save);

  io.hold();
  queue.enqueue([change(0, 0, 'first')]);
  const flush = queue.flush();

  queue.enqueue([change(0, 0, 'second')]);

  io.reject(new Error('network down'));
  await flush;

  queue.clearError();
  await queue.flush();
  assert.deepEqual(io.batches[1], [change(0, 0, 'second')], 'the newer value must win');
});

test('a failed save still restores cells that were not edited again', async () => {
  const io = recordingSave();
  const queue = new CaseSheetSaveQueue(io.save);

  io.hold();
  queue.enqueue([change(0, 0, 'overwritten later'), change(1, 1, 'untouched')]);
  const flush = queue.flush();
  queue.enqueue([change(0, 0, 'newer')]);
  io.reject(new Error('network down'));
  await flush;

  queue.clearError();
  await queue.flush();

  const second = [...io.batches[1]].sort((a, b) => a.rowIndex - b.rowIndex);
  assert.deepEqual(second, [change(0, 0, 'newer'), change(1, 1, 'untouched')]);
});

test('work in flight counts as unsaved, so the tab can warn before closing', async () => {
  const io = recordingSave();
  const queue = new CaseSheetSaveQueue(io.save);

  io.hold();
  queue.enqueue([change(0, 0, 'Tamar')]);
  const flush = queue.flush();

  assert.equal(queue.pendingCount, 0, 'the batch has left the pending map');
  assert.equal(queue.hasUnsavedWork, true, 'but it is not on the server yet');

  io.resolve();
  await flush;
  assert.equal(queue.hasUnsavedWork, false);
});

test('a successful save clears a previous error', async () => {
  let shouldFail = true;
  const queue = new CaseSheetSaveQueue(async () => {
    if (shouldFail) throw new Error('network down');
  });

  queue.enqueue([change(0, 0, 'Tamar')]);
  await queue.flush();
  assert.equal(queue.status, 'error');

  shouldFail = false;
  queue.clearError();
  await queue.flush();
  assert.equal(queue.status, 'saved');
  assert.equal(queue.error, null);
});
