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

/**
 * Case-handler bucket.
 *
 * `active_handler_type` 1 means the retention handler owns the case, so it is non-active work for
 * the case handler however far along it is. An inactive lead is counted nowhere.
 */
export function classifyHandlerBucket(
  stageId: number | null,
  activeHandlerType: number,
  isInactive: boolean,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) === 1) return 'non_active';
  if (isInactive) return null;
  if (Number(activeHandlerType) === 2 && stageId <= 105) return 'new';
  if (Number(activeHandlerType) === 2 && stageId >= 110) return 'active';
  return null;
}

/**
 * Client-support bucket.
 *
 * `active_handler_type` says which of the two handlers owns a case, which has no bearing on client
 * support, so the stage alone places a case. Non-active here means the lead itself is parked, the
 * one state that stops support work on it.
 */
export function classifySupportBucket(
  stageId: number | null,
  isInactive: boolean,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (isInactive) return 'non_active';
  if (stageId <= 105) return 'new';
  if (stageId >= 110) return 'active';
  return null;
}

/**
 * Retention-handler bucket, the mirror of the above: type 2 is the case handler's work.
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
  if (Number(activeHandlerType) === 2) return 'non_active';
  if (Number(activeHandlerType) === 1 && stageId <= 105 && !started) return 'new';
  if (Number(activeHandlerType) === 1 && (stageId >= 110 || (stageId <= 105 && started))) {
    return 'active';
  }
  return null;
}
