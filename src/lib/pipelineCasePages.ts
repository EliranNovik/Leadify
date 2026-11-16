import { supabase } from './supabase';
import type { HandlerBucket } from './handlerCaseBuckets';

/** How many leads one pipeline scroll-load asks for, from each lead table. */
export const PIPELINE_PAGE_SIZE = 40;

export type PipelineCountRole =
  | { kind: 'handler' }
  | { kind: 'retention' }
  | { kind: 'owned'; ownerType: number };

export type PipelineBucketTotals = Record<HandlerBucket, number>;

export function emptyPipelineBucketTotals(): PipelineBucketTotals {
  return { new: 0, active: 0, non_active: 0, closed: 0 };
}

/**
 * Types that are not the case handler. `readPipelineActiveType` maps 9 onto case monitoring (3)
 * and leaves 1 and 4–10 as their own owners, so none of these belong in the handler's own buckets.
 */
const NOT_HANDLER_TYPES = '(1,3,4,5,6,7,8,9,10)';

function ownerMatch(ownerType: number): string {
  return ownerType === 3 ? 'active_handler_type.in.(3,9)' : `active_handler_type.eq.${ownerType}`;
}

function notOwnerMatch(ownerType: number): string {
  return ownerType === 3
    ? 'active_handler_type.is.null,active_handler_type.not.in.(3,9)'
    : `active_handler_type.is.null,active_handler_type.neq.${ownerType}`;
}

function withoutInactive(query: any, table: 'new' | 'legacy') {
  // Legacy only treats status 10 as inactive. Other status values still belong in New or Active.
  return table === 'new'
    ? query.is('unactivated_at', null)
    : query.or('status.neq.10,status.is.null');
}

/**
 * Restrict a lead query to one bucket, using the same rules as the pipeline classifiers.
 * A quick filter asks for every open case instead, and the screen narrows that page itself.
 */
export function applyPipelineListFilter(
  query: any,
  role: PipelineCountRole,
  table: 'new' | 'legacy',
  bucket: HandlerBucket,
  openOnly: boolean,
) {
  if (openOnly) {
    return query.not('stage', 'is', null).neq('stage', 200);
  }

  let next = query.not('stage', 'is', null);
  if (bucket === 'closed') return next.eq('stage', 200);
  next = next.neq('stage', 200);

  if (role.kind === 'handler') {
    if (bucket === 'non_active') {
      return next.in('active_handler_type', [1, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    next = withoutInactive(
      next.or(`active_handler_type.is.null,active_handler_type.not.in.${NOT_HANDLER_TYPES}`),
      table,
    );
    return bucket === 'new' ? next.lte('stage', 105) : next.gte('stage', 110);
  }

  if (role.kind === 'retention') {
    if (bucket === 'non_active') {
      return next.or('active_handler_type.is.null,active_handler_type.neq.1');
    }
    next = next.eq('active_handler_type', 1);
    if (bucket === 'new') {
      return next.lte('stage', 105).or('retention_handler_started.is.null,retention_handler_started.is.false');
    }
    return next.or('stage.gte.110,and(stage.lte.105,retention_handler_started.is.true)');
  }

  const ownerType = role.ownerType;
  if (bucket === 'non_active') {
    const inactive =
      table === 'new'
        ? `and(${ownerMatch(ownerType)},unactivated_at.not.is.null)`
        : `and(${ownerMatch(ownerType)},status.eq.10)`;
    return next.or(`${notOwnerMatch(ownerType)},${inactive}`);
  }
  next = withoutInactive(next.or(ownerMatch(ownerType)), table);
  return bucket === 'new' ? next.lte('stage', 105) : next.gte('stage', 110);
}

async function countOne(
  tableName: 'leads' | 'leads_lead',
  table: 'new' | 'legacy',
  role: PipelineCountRole,
  bucket: HandlerBucket,
  applyIdentity: (query: any) => any,
): Promise<number> {
  let query = supabase.from(tableName).select('id', { count: 'exact', head: true });
  query = applyIdentity(query);
  query = applyPipelineListFilter(query, role, table, bucket, false);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Exact New / Active / Non-active / Closed totals, past the row cap that a normal select hits. */
export async function countPipelineBuckets(
  role: PipelineCountRole,
  applyNew: (query: any) => any,
  applyLegacy: (query: any) => any,
): Promise<PipelineBucketTotals> {
  const buckets: HandlerBucket[] = ['new', 'active', 'non_active', 'closed'];
  const counts = await Promise.all(
    buckets.flatMap((bucket) => [
      countOne('leads', 'new', role, bucket, applyNew),
      countOne('leads_lead', 'legacy', role, bucket, applyLegacy),
    ]),
  );
  return {
    new: counts[0] + counts[1],
    active: counts[2] + counts[3],
    non_active: counts[4] + counts[5],
    closed: counts[6] + counts[7],
  };
}
