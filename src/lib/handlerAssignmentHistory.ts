import { supabase } from './supabase';

export type HandlerAssignmentMeta = {
  handlerAssignedDate: string | null;
  firstHandlerAssignedDate: string | null;
  previousHandlerName: string | null;
  previousHandlerAssignedDate: string | null;
  stage105Date: string | null;
  stage110Date: string | null;
};

function safeParseDate(dateString: string | null | undefined): Date | null {
  if (!dateString || (typeof dateString === 'string' && dateString.trim() === '')) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return date;
}

function toYmd(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isUnassignedLike(nameOrId: unknown): boolean {
  if (nameOrId == null) return true;
  const s = String(nameOrId).trim().toLowerCase();
  return (
    !s ||
    s === '---' ||
    s === '--' ||
    s === '(empty)' ||
    s === 'empty' ||
    s === 'unassigned' ||
    s === 'not assigned' ||
    s === 'null' ||
    s === 'undefined' ||
    s === '0'
  );
}

async function forChunks<T>(ids: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < ids.length; i += size) {
    await fn(ids.slice(i, i + size));
  }
}

/** Same assignment / stage-105 / stage-110 history used by My Cases for New and Re-assigned badges. */
export async function fetchHandlerAssignmentHistory(params: {
  employeeId: number;
  userFullName: string;
  newLeadIds: string[];
  legacyLeadIds: Array<string | number>;
  employees: Array<{ id?: unknown; display_name?: string | null }>;
}): Promise<{ byNewId: Map<string, HandlerAssignmentMeta>; byLegacyId: Map<string, HandlerAssignmentMeta> }> {
  const assignedByNewId = new Map<string, string>();
  const assignedByLegacyId = new Map<string, string>();
  const firstByNewId = new Map<string, string>();
  const firstByLegacyId = new Map<string, string>();
  const prevNameByNewId = new Map<string, string>();
  const prevNameByLegacyId = new Map<string, string>();
  const prevDateByNewId = new Map<string, string>();
  const prevDateByLegacyId = new Map<string, string>();
  const stage105ByNewId = new Map<string, string>();
  const stage105ByLegacyId = new Map<string, string>();
  const stage110ByNewId = new Map<string, string>();
  const stage110ByLegacyId = new Map<string, string>();

  const employeeIdStr = String(params.employeeId);
  const normalizedUserFullName = String(params.userFullName || '').trim().toLowerCase();
  const employeesById = new Map<string, string>();
  params.employees.forEach((emp) => {
    const label = (emp.display_name || '').trim();
    if (!label || emp.id == null) return;
    employeesById.set(String(emp.id), label);
  });
  const resolveHandlerDisplayName = (maybeIdOrName: unknown): string | null => {
    if (maybeIdOrName == null) return null;
    const s = String(maybeIdOrName).trim();
    if (!s || s === '---' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
    const n = Number(s);
    if (!Number.isNaN(n) && Number.isFinite(n) && n > 0) return employeesById.get(String(n)) || null;
    return s;
  };

  try {
    if (params.newLeadIds.length > 0) {
      await forChunks(params.newLeadIds, 100, async (chunk) => {
        const { data: hist, error } = await supabase
          .from('history_leads')
          .select('original_id, changed_at, handler, case_handler_id')
          .in('original_id', chunk)
          .order('changed_at', { ascending: true });
        if (error) throw error;
        const lastHandlerNameByLead = new Map<string, string>();
        const lastHandlerChangedAtByLead = new Map<string, string>();
        (hist || []).forEach((row: any) => {
          const oid = String(row.original_id);
          if (!firstByNewId.has(oid)) {
            const caseHandlerIdAny = row.case_handler_id != null ? String(row.case_handler_id) : '';
            const handlerNameAny = row.handler != null ? String(row.handler).trim().toLowerCase() : '';
            const hasAnyHandler =
              (caseHandlerIdAny !== '' && caseHandlerIdAny !== '0') ||
              (handlerNameAny !== '' && handlerNameAny !== '---' && handlerNameAny !== '--');
            if (hasAnyHandler) {
              const dAny = safeParseDate(row.changed_at);
              if (dAny) firstByNewId.set(oid, toYmd(dAny));
            }
          }
          const caseHandlerId = row.case_handler_id != null ? String(row.case_handler_id) : '';
          const handlerName = row.handler != null ? String(row.handler).trim().toLowerCase() : '';
          const isAssignedToMe =
            (caseHandlerId !== '' && caseHandlerId === employeeIdStr) ||
            (!!normalizedUserFullName && handlerName === normalizedUserFullName) ||
            (handlerName !== '' && handlerName === employeeIdStr);
          if (isAssignedToMe) {
            const d = safeParseDate(row.changed_at);
            if (!d) return;
            const prevNameRaw = lastHandlerNameByLead.get(oid) || null;
            const prevName = !prevNameRaw || isUnassignedLike(prevNameRaw) ? null : prevNameRaw;
            const prevDate = lastHandlerChangedAtByLead.get(oid) || null;
            if (prevName) prevNameByNewId.set(oid, prevName);
            else prevNameByNewId.delete(oid);
            if (prevDate) prevDateByNewId.set(oid, prevDate);
            else prevDateByNewId.delete(oid);
            assignedByNewId.set(oid, toYmd(d));
            return;
          }
          const anyHandlerDisplay =
            resolveHandlerDisplayName(row.case_handler_id) || resolveHandlerDisplayName(row.handler);
          if (anyHandlerDisplay && !isUnassignedLike(anyHandlerDisplay)) {
            const dAny = safeParseDate(row.changed_at);
            if (dAny) {
              lastHandlerNameByLead.set(oid, anyHandlerDisplay);
              lastHandlerChangedAtByLead.set(oid, toYmd(dAny));
            }
          }
        });
      });
    }

    const legacyIds = params.legacyLeadIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (legacyIds.length > 0) {
      await forChunks(legacyIds, 100, async (chunk) => {
        const { data: hist, error } = await supabase
          .from('history_leads_lead')
          .select('original_id, changed_at, case_handler_id')
          .in('original_id', chunk)
          .order('changed_at', { ascending: true });
        if (error) throw error;
        const lastHandlerNameByLead = new Map<string, string>();
        const lastHandlerChangedAtByLead = new Map<string, string>();
        (hist || []).forEach((row: any) => {
          const oid = String(row.original_id);
          if (!firstByLegacyId.has(oid)) {
            const caseHandlerIdAny = row.case_handler_id != null ? Number(row.case_handler_id) : null;
            if (caseHandlerIdAny != null) {
              const dAny = safeParseDate(row.changed_at);
              if (dAny) firstByLegacyId.set(oid, toYmd(dAny));
            }
          }
          const caseHandlerId = row.case_handler_id != null ? Number(row.case_handler_id) : null;
          const isAssignedToMe = caseHandlerId != null && caseHandlerId === params.employeeId;
          if (isAssignedToMe) {
            const d = safeParseDate(row.changed_at);
            if (!d) return;
            const prevNameRaw = lastHandlerNameByLead.get(oid) || null;
            const prevName = !prevNameRaw || isUnassignedLike(prevNameRaw) ? null : prevNameRaw;
            const prevDate = lastHandlerChangedAtByLead.get(oid) || null;
            if (prevName) prevNameByLegacyId.set(oid, prevName);
            else prevNameByLegacyId.delete(oid);
            if (prevDate) prevDateByLegacyId.set(oid, prevDate);
            else prevDateByLegacyId.delete(oid);
            assignedByLegacyId.set(oid, toYmd(d));
            return;
          }
          const anyHandlerDisplay = resolveHandlerDisplayName(row.case_handler_id);
          if (anyHandlerDisplay && !isUnassignedLike(anyHandlerDisplay)) {
            const dAny = safeParseDate(row.changed_at);
            if (dAny) {
              lastHandlerNameByLead.set(oid, anyHandlerDisplay);
              lastHandlerChangedAtByLead.set(oid, toYmd(dAny));
            }
          }
        });
      });
    }

    const loadStageDates = async (
      ids: Array<string | number>,
      column: 'newlead_id' | 'lead_id',
      stage: 105 | 110,
      target: Map<string, string>,
      keepEarliest: boolean,
    ) => {
      if (ids.length === 0) return;
      await forChunks(ids, 200, async (chunk) => {
        const { data: stages, error } = await supabase
          .from('leads_leadstage')
          .select(`${column}, date, cdate`)
          .eq('stage', stage)
          .in(column, chunk)
          .order('date', { ascending: true, nullsFirst: false })
          .order('cdate', { ascending: true, nullsFirst: false });
        if (error) throw error;
        (stages || []).forEach((row: any) => {
          const rawId = row?.[column];
          if (rawId == null) return;
          const d = safeParseDate(row.date) || safeParseDate(row.cdate);
          if (!d) return;
          const nextVal = toYmd(d);
          const prevVal = target.get(String(rawId));
          if (!prevVal) {
            target.set(String(rawId), nextVal);
            return;
          }
          const prevD = safeParseDate(prevVal);
          if (!prevD) return;
          if (keepEarliest ? d.getTime() < prevD.getTime() : d.getTime() > prevD.getTime()) {
            target.set(String(rawId), nextVal);
          }
        });
      });
    };

    await loadStageDates(params.newLeadIds, 'newlead_id', 105, stage105ByNewId, true);
    await loadStageDates(params.newLeadIds, 'newlead_id', 110, stage110ByNewId, false);
    await loadStageDates(legacyIds, 'lead_id', 105, stage105ByLegacyId, true);
    await loadStageDates(legacyIds, 'lead_id', 110, stage110ByLegacyId, false);

    stage105ByNewId.forEach((d, id) => {
      if (!assignedByNewId.has(id)) assignedByNewId.set(id, d);
    });
    stage105ByLegacyId.forEach((d, id) => {
      if (!assignedByLegacyId.has(id)) assignedByLegacyId.set(id, d);
    });
  } catch (e) {
    console.warn('Failed to fetch handler assigned date; falling back to created dates.', e);
  }

  const pack = (
    id: string,
    assigned: Map<string, string>,
    first: Map<string, string>,
    prevName: Map<string, string>,
    prevDate: Map<string, string>,
    s105: Map<string, string>,
    s110: Map<string, string>,
  ): HandlerAssignmentMeta => ({
    handlerAssignedDate: assigned.get(id) || null,
    firstHandlerAssignedDate: first.get(id) || null,
    previousHandlerName: prevName.get(id) || null,
    previousHandlerAssignedDate: prevDate.get(id) || null,
    stage105Date: s105.get(id) || null,
    stage110Date: s110.get(id) || null,
  });

  const byNewId = new Map<string, HandlerAssignmentMeta>();
  params.newLeadIds.forEach((id) => {
    byNewId.set(
      String(id),
      pack(String(id), assignedByNewId, firstByNewId, prevNameByNewId, prevDateByNewId, stage105ByNewId, stage110ByNewId),
    );
  });
  const byLegacyId = new Map<string, HandlerAssignmentMeta>();
  params.legacyLeadIds.forEach((id) => {
    byLegacyId.set(
      String(id),
      pack(String(id), assignedByLegacyId, firstByLegacyId, prevNameByLegacyId, prevDateByLegacyId, stage105ByLegacyId, stage110ByLegacyId),
    );
  });

  return { byNewId, byLegacyId };
}
