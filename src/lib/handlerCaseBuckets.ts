/**
 * Which bucket a case sits in for a handler — New, Active, Non-active or Closed.
 *
 * The handler and retention pipelines and the Handler Management tables all count the same four
 * buckets, so the rules live here rather than in each screen. They had drifted: the management
 * tables treated a lead with no stage, or one between 106 and 109, as New, while the pipelines drop
 * it from every bucket, and the retention tables ignored `retention_handler_started`. Both screens
 * now call these functions, so a change to the rules moves them together.
 *
 * `null` means the case belongs in no bucket and is not counted anywhere.
 */
export type HandlerBucket = 'new' | 'active' | 'non_active' | 'closed';

export type HandlerBucketCounts = Record<HandlerBucket, number>;

export function emptyHandlerBucketCounts(): HandlerBucketCounts {
  return { new: 0, active: 0, non_active: 0, closed: 0 };
}

/** 1 = retention handler, 2 = case handler, 3 = client support. */
export type ActiveHandlerType = 1 | 2 | 3;

export function normalizeActiveHandlerType(value: unknown): ActiveHandlerType {
  const n = Number(value);
  if (n === 1 || n === 3) return n;
  return 2;
}

/**
 * Case-handler bucket.
 *
 * `active_handler_type` 1 or 3 means another role owns the case, so it is non-active work for
 * the case handler however far along it is. An inactive lead is counted nowhere.
 */
export function classifyHandlerBucket(
  stageId: number | null,
  activeHandlerType: number,
  isInactive: boolean,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) !== 2) return 'non_active';
  if (isInactive) return null;
  if (stageId <= 105) return 'new';
  if (stageId >= 110) return 'active';
  return null;
}

/**
 * Client-support bucket.
 *
 * `active_handler_type` 3 means client support owns the case. Otherwise the row is non-active
 * support work. An inactive lead stays visible under non-active.
 */
export function classifySupportBucket(
  stageId: number | null,
  activeHandlerType: number,
  isInactive: boolean,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) !== 3) return 'non_active';
  if (isInactive) return 'non_active';
  if (stageId <= 105) return 'new';
  if (stageId >= 110) return 'active';
  return null;
}

/**
 * Retention-handler bucket: type 1 owns the case; 2 or 3 is non-active for retention.
 *
 * `started` is `retention_handler_started`, which moves a case the retention handler has picked up
 * into Active even before its stage has moved on.
 */
export function classifyRetentionBucket(
  stageId: number | null,
  activeHandlerType: number,
  started: boolean,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) !== 1) return 'non_active';
  if (stageId <= 105 && !started) return 'new';
  if (stageId >= 110 || (stageId <= 105 && started)) {
    return 'active';
  }
  return null;
}
