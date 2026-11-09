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

/** 1 = completion coordinator (was retention), 2 = case handler, 3 = client support. */
export type ActiveHandlerType = 1 | 2 | 3;

export function normalizeActiveHandlerType(value: unknown): ActiveHandlerType {
  const n = Number(value);
  if (n === 1 || n === 3) return n;
  return 2;
}

/**
 * Value the three pipelines should bucket on.
 * 4–10 are the newer handling roles, so none of those three pipelines owns the case.
 * Unknown values stay on the case handler (2), which is the historical default.
 */
export function readPipelineActiveType(value: unknown): number {
  const n = Number(value);
  if (n === 9) return 3;
  if (n === 1 || n === 2 || n === 3) return n;
  if (Number.isFinite(n) && n >= 4 && n <= 10) return n;
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
 * Bucket for a handling role that owns the case only while `active_handler_type` matches.
 * An inactive lead stays visible under non-active. Case monitoring and the newer handling
 * roles all use this rule.
 */
export function classifyOwnedHandlingBucket(
  stageId: number | null,
  activeHandlerType: number,
  isInactive: boolean,
  ownerType: number,
): HandlerBucket | null {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) !== ownerType) return 'non_active';
  if (isInactive) return 'non_active';
  if (stageId <= 105) return 'new';
  if (stageId >= 110) return 'active';
  return null;
}

/**
 * Case-monitoring bucket. `active_handler_type` 3 means that role owns the case.
 */
export function classifySupportBucket(
  stageId: number | null,
  activeHandlerType: number,
  isInactive: boolean,
): HandlerBucket | null {
  return classifyOwnedHandlingBucket(stageId, activeHandlerType, isInactive, 3);
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
