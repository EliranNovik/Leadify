import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';

/**
 * Hook to fetch the count of unassigned leads (Created + Scheduler Assigned stages with no scheduler).
 * Matches the logic used in Header quick actions and NewCasesPage.
 */
export function useNewLeadsCount(): number {
  const [count, setCount] = useState(0);
  const stageIdsReadyRef = useRef(false);
  const resolvingStageIdsRef = useRef<Promise<void> | null>(null);
  const createdStageIdsRef = useRef<number[]>([0, 11]);
  const schedulerStageIdsRef = useRef<number[]>([10]);

  const ensureStageIds = useCallback(async () => {
    if (stageIdsReadyRef.current) return;
    if (!resolvingStageIdsRef.current) {
      resolvingStageIdsRef.current = (async () => {
        try {
          const stageMap = await fetchStageNames();
          const entries = Object.entries(stageMap).filter(([, name]) => !!name);
          const createdMatches = entries
            .filter(([, name]) => areStagesEquivalent(name, 'Created'))
            .map(([id]) => Number(id))
            .filter((id) => !Number.isNaN(id));
          const schedulerMatches = entries
            .filter(([, name]) => areStagesEquivalent(name, 'Scheduler Assigned'))
            .map(([id]) => Number(id))
            .filter((id) => !Number.isNaN(id));
          createdStageIdsRef.current = Array.from(new Set([...createdMatches, 0, 11]));
          schedulerStageIdsRef.current = Array.from(new Set([...schedulerMatches, 10]));
        } catch (error) {
          console.error('Error resolving stage IDs for new leads count:', error);
          createdStageIdsRef.current = [0, 11];
          schedulerStageIdsRef.current = [10];
        } finally {
          stageIdsReadyRef.current = true;
          resolvingStageIdsRef.current = null;
        }
      })();
    }
    await resolvingStageIdsRef.current;
  }, []);

  const fetchCount = useCallback(async () => {
    try {
      await ensureStageIds();
      const createdFilters = createdStageIdsRef.current.length ? createdStageIdsRef.current : [0];
      const schedulerFilters = schedulerStageIdsRef.current.length ? schedulerStageIdsRef.current : [10];

      const buildBaseQuery = (query: any) =>
        query.neq('stage', 91).is('unactivated_at', null);

      const [createdResult, schedulerResult] = await Promise.all([
        buildBaseQuery(supabase.from('leads').select('id, scheduler').in('stage', createdFilters)),
        buildBaseQuery(supabase.from('leads').select('id, scheduler').in('stage', schedulerFilters)),
      ]);

      let allLeads = [
        ...(createdResult.data || []),
        ...(schedulerResult.data || []),
      ];

      allLeads = allLeads.filter((lead) => {
        const scheduler = lead.scheduler;
        if (scheduler === null || scheduler === undefined) return true;
        if (typeof scheduler === 'string') {
          const trimmed = scheduler.trim();
          return trimmed === '' || trimmed === '---' || trimmed.toLowerCase() === 'not assigned';
        }
        return false;
      });

      const uniqueLeads = allLeads.filter((lead, index, self) =>
        index === self.findIndex((l) => l.id === lead.id)
      );
      setCount(uniqueLeads.length);
    } catch (error) {
      console.error('Error fetching new leads count:', error);
      setCount(0);
    }
  }, [ensureStageIds]);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  return count;
}
