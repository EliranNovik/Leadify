import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { UserGroupIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { getStageColour, getStageName } from '../lib/stageUtils';

type Case = {
  id: any;
  isNewLead: boolean;
  lead_number?: string | null;
  manual_id?: string | null;
  legacy_master_id?: string | number | null;
  legacy_sublead_suffix?: string | number | null;
  linked_master_lead?: any;
  name?: string | null;
  stage?: string | number | null;
  stageId?: number | null;
  category?: string | null;
  category_id?: string | number | null;
  category_display?: string | null;
  active_handler_type?: number; // 2 default, 1 retention
  created_at?: string | null; // new
  cdate?: string | null; // legacy
  assigned_date?: string | null; // normalized created date string
  unactivated_at?: string | null;
  status?: string | null;
  paid_status?: 'paid' | 'unpaid' | null;

  handler_assigned_date?: string | null;
  first_handler_assigned_date?: string | null;
  previous_handler_name?: string | null;
  previous_handler_assigned_date?: string | null;
  stage_105_date?: string | null;
  stage_110_date?: string | null;
};

const safeParseDate = (dateString: string | null | undefined): Date | null => {
  if (!dateString) return null;
  try {
    if (typeof dateString === 'string' && dateString.trim() === '') return null;
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    if (year < 1900 || year > 2100) return null;
    return date;
  } catch {
    return null;
  }
};

const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827';
  let sanitized = String(hexColor).trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) sanitized = sanitized.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) return '#111827';
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#111827' : '#ffffff';
};

const formatDateDDMMYY = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
};

const NewHandlerCasesWidget: React.FC<{ maxItems?: number }> = ({ maxItems = 10 }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<Case[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const handleCaseClick = (caseItem: Case) => {
    if (!caseItem) return;
    if (caseItem.isNewLead) {
      const leadNumber = String(caseItem.lead_number || '').trim();
      if (!leadNumber) return;
      navigate(`/clients/${encodeURIComponent(leadNumber)}`);
      return;
    }
    const legacyId = String(caseItem.id || '').replace(/^legacy_/, '');
    const legacyLeadNumber = String((caseItem as any).lead_number || '');
    if (legacyLeadNumber.includes('/')) {
      navigate(`/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(legacyLeadNumber)}`);
    } else {
      navigate(`/clients/${encodeURIComponent(legacyId)}`);
    }
  };

  const formatLeadNumberForList = (caseItem: Case): string => {
    const hasLinkedMasterLead =
      (caseItem as any).linked_master_lead != null &&
      (typeof (caseItem as any).linked_master_lead === 'number' ||
        (typeof (caseItem as any).linked_master_lead === 'string' && String((caseItem as any).linked_master_lead).trim() !== ''));

    if (hasLinkedMasterLead) {
      let raw = (caseItem as any).lead_number || (caseItem as any).manual_id || caseItem.id || '---';
      let rawStr = String(raw || '---');
      if (rawStr.startsWith('legacy_')) rawStr = rawStr.replace(/^legacy_/, '');
      if (rawStr.includes('/')) {
        const idStr = String(caseItem.id ?? '').replace(/^legacy_/, '');
        const idLooksLikeUuid = idStr.includes('-') && idStr.length >= 24;
        if (!caseItem.isNewLead && idStr && idStr !== '---' && !idLooksLikeUuid) rawStr = idStr;
        else rawStr = rawStr.split('/')[0];
      }
      const isSuccessStage = String(caseItem.stage) === '100' || Number(caseItem.stage) === 100;
      if (isSuccessStage && rawStr && !rawStr.startsWith('C')) return rawStr.replace(/^L/, 'C');
      return rawStr;
    }

    if (!caseItem.isNewLead) {
      const idStr = String(caseItem.id || '').replace(/^legacy_/, '');
      const masterId = caseItem.legacy_master_id != null ? String(caseItem.legacy_master_id).trim() : '';
      const hasLinkedMasterLeadLegacy =
        (caseItem as any).linked_master_lead != null &&
        String((caseItem as any).linked_master_lead).trim() !== '' &&
        (!masterId || masterId === '');
      if (hasLinkedMasterLeadLegacy) return idStr || '---';
      if (!masterId) return idStr || '---';
      const suffix = caseItem.legacy_sublead_suffix != null ? String(caseItem.legacy_sublead_suffix) : '?';
      const display = `${masterId}/${suffix}`;
      const isSuccessStage = String(caseItem.stage) === '100' || Number(caseItem.stage) === 100;
      if (isSuccessStage && display && !display.startsWith('C')) return display.replace(/^L/, 'C');
      return display;
    }

    let displayNumber: any = (caseItem as any).lead_number || (caseItem as any).manual_id || caseItem.id || '---';
    const displayStr = String(displayNumber || '---');
    const hasExistingSuffix = displayStr.includes('/');
    let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
    const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;
    const isSuccessStage = String(caseItem.stage) === '100' || Number(caseItem.stage) === 100;
    if (isSuccessStage && baseNumber && !String(baseNumber).startsWith('C')) baseNumber = String(baseNumber).replace(/^L/, 'C');
    if (hasExistingSuffix) return `${baseNumber}/${existingSuffix}`;
    return String(baseNumber);
  };

  const formatCategoryDisplay = (categoryId: any, categoryName: any, categoryMap: Map<string, any>): string => {
    const name = String(categoryName || '').trim();
    if (name) return name;
    if (categoryId == null) return '—';
    const rec = categoryMap.get(String(categoryId));
    if (!rec) return String(categoryId);
    const main = rec?.misc_maincategory?.name ? String(rec.misc_maincategory.name).trim() : '';
    const cat = rec?.name ? String(rec.name).trim() : '';
    if (main && cat) return `${main} / ${cat}`;
    return cat || main || String(categoryId);
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const authId = auth?.user?.id;
        if (!authId) return;

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, employee_id, full_name')
          .eq('auth_id', authId)
          .single();
        if (userError || !userData?.employee_id) throw new Error('Employee not found for current user');

        const employeeId = userData.employee_id;
        const userFullName = userData.full_name;

        const [newLeadsResult, legacyLeadsResult, allEmployeesResult, categoriesResult] = await Promise.all([
          supabase
            .from('leads')
            .select('id, lead_number, name, stage, created_at, handler, case_handler_id, active_handler_type, linked_master_lead, unactivated_at, category_id, category')
            .or(
              userFullName
                ? `handler.eq.${userFullName},handler.eq.${employeeId},case_handler_id.eq.${employeeId}`
                : `handler.eq.${employeeId},case_handler_id.eq.${employeeId}`
            )
            .order('created_at', { ascending: false })
            .limit(1000),
          supabase
            .from('leads_lead')
            .select('id, manual_id, master_id, name, stage, cdate, active_handler_type, linked_master_lead, status, category_id, category')
            .eq('case_handler_id', employeeId)
            .order('cdate', { ascending: false })
            .limit(1000),
          supabase.from('tenants_employee').select('id, display_name'),
          supabase
            .from('misc_category')
            .select(
              `
              id,
              name,
              parent_id,
              misc_maincategory!parent_id (
                id,
                name
              )
            `
            )
        ]);

        if (newLeadsResult.error) throw newLeadsResult.error;
        if (legacyLeadsResult.error) throw legacyLeadsResult.error;
        if (allEmployeesResult.error) throw allEmployeesResult.error;
        if (categoriesResult.error) throw categoriesResult.error;

        const employeesById = new Map<string, string>();
        (allEmployeesResult.data || []).forEach((e: any) => {
          const label = (e?.display_name || '').trim();
          if (!label) return;
          if (e?.id != null) employeesById.set(String(e.id), label);
        });

        const resolveHandlerDisplayName = (maybeIdOrName: any): string | null => {
          if (maybeIdOrName == null) return null;
          const s = String(maybeIdOrName).trim();
          if (!s || s === '---' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
          const n = Number(s);
          if (!Number.isNaN(n) && Number.isFinite(n) && n > 0) return employeesById.get(String(n)) || null;
          return s;
        };

        const isUnassignedLike = (nameOrId: any): boolean => {
          if (nameOrId == null) return true;
          const s = String(nameOrId).trim().toLowerCase();
          if (!s) return true;
          if (s === '---' || s === '--') return true;
          if (s === '(empty)' || s === 'empty') return true;
          if (s === 'unassigned' || s === 'not assigned') return true;
          if (s === 'null' || s === 'undefined') return true;
          if (s === '0') return true;
          return false;
        };

        const newLeads = newLeadsResult.data || [];
        const legacyLeads = legacyLeadsResult.data || [];
        const newLeadIds = newLeads.map((l: any) => l.id);
        const legacyLeadIds = legacyLeads.map((l: any) => l.id);

        const categoryMap = new Map<string, any>();
        (categoriesResult.data || []).forEach((c: any) => {
          if (c?.id != null) categoryMap.set(String(c.id), c);
        });

        // Payment plans (new leads only) for paid/unpaid icon in "New cases"
        const paymentByLeadId = new Map<string, 'paid' | 'unpaid'>();
        if (newLeadIds.length > 0) {
          const { data: plans, error: pErr } = await supabase
            .from('payment_plans')
            .select('lead_id, paid, cancel_date')
            .in('lead_id', newLeadIds)
            .is('cancel_date', null);
          if (pErr) throw pErr;
          (plans || []).forEach((p: any) => {
            if (!p?.lead_id) return;
            const key = String(p.lead_id);
            const isPaid = !!p.paid;
            const prev = paymentByLeadId.get(key);
            if (isPaid) paymentByLeadId.set(key, 'paid');
            else if (!prev) paymentByLeadId.set(key, 'unpaid');
          });
          // Leads with no plan rows should be "unpaid" for the icon.
          newLeadIds.forEach((id: any) => {
            const key = String(id);
            if (!paymentByLeadId.has(key)) paymentByLeadId.set(key, 'unpaid');
          });
        }

        const handlerAssignedDateByNewLeadId = new Map<string, string>();
        const handlerAssignedDateByLegacyLeadId = new Map<string, string>();
        const firstHandlerAssignedDateByNewLeadId = new Map<string, string>();
        const firstHandlerAssignedDateByLegacyLeadId = new Map<string, string>();
        const previousHandlerNameByNewLeadId = new Map<string, string>();
        const previousHandlerAssignedDateByNewLeadId = new Map<string, string>();
        const previousHandlerNameByLegacyLeadId = new Map<string, string>();
        const previousHandlerAssignedDateByLegacyLeadId = new Map<string, string>();
        const stage105DateByNewLeadId = new Map<string, string>();
        const stage105DateByLegacyLeadId = new Map<string, string>();
        const stage110DateByNewLeadId = new Map<string, string>();
        const stage110DateByLegacyLeadId = new Map<string, string>();

        const normalizedUserFullName = String(userFullName || '').trim().toLowerCase();
        const employeeIdStr = String(employeeId);

        // History: new
        if (newLeadIds.length > 0) {
          const chunkSize = 100;
          for (let i = 0; i < newLeadIds.length; i += chunkSize) {
            const chunk = newLeadIds.slice(i, i + chunkSize);
            const { data: hist, error: hErr } = await supabase
              .from('history_leads')
              .select('original_id, changed_at, handler, case_handler_id')
              .in('original_id', chunk)
              .order('changed_at', { ascending: true });
            if (hErr) throw hErr;
            const lastHandlerNameByLead = new Map<string, string>();
            const lastHandlerChangedAtByLead = new Map<string, string>();
            (hist || []).forEach((row: any) => {
              const oid = String(row.original_id);
              if (!firstHandlerAssignedDateByNewLeadId.has(oid)) {
                const caseHandlerIdAny = row.case_handler_id != null ? String(row.case_handler_id) : '';
                const handlerNameAny = row.handler != null ? String(row.handler).trim().toLowerCase() : '';
                const hasAnyHandler =
                  (caseHandlerIdAny !== '' && caseHandlerIdAny !== '0') ||
                  (handlerNameAny !== '' && handlerNameAny !== '---' && handlerNameAny !== '--');
                if (hasAnyHandler) {
                  const dAny = safeParseDate(row.changed_at);
                  if (dAny) firstHandlerAssignedDateByNewLeadId.set(oid, dAny.toISOString().split('T')[0]);
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
                if (prevName) previousHandlerNameByNewLeadId.set(oid, prevName);
                else previousHandlerNameByNewLeadId.delete(oid);
                if (prevDate) previousHandlerAssignedDateByNewLeadId.set(oid, prevDate);
                else previousHandlerAssignedDateByNewLeadId.delete(oid);
                handlerAssignedDateByNewLeadId.set(oid, d.toISOString().split('T')[0]);
              }

              if (isAssignedToMe) return;
              const anyHandlerDisplay =
                resolveHandlerDisplayName(row.case_handler_id) || resolveHandlerDisplayName(row.handler);
              if (anyHandlerDisplay && !isUnassignedLike(anyHandlerDisplay)) {
                const dAny = safeParseDate(row.changed_at);
                if (dAny) {
                  lastHandlerNameByLead.set(oid, anyHandlerDisplay);
                  lastHandlerChangedAtByLead.set(oid, dAny.toISOString().split('T')[0]);
                }
              }
            });
          }
        }

        // History: legacy
        if (legacyLeadIds.length > 0) {
          const chunkSize = 100;
          for (let i = 0; i < legacyLeadIds.length; i += chunkSize) {
            const chunk = legacyLeadIds.slice(i, i + chunkSize);
            const { data: hist, error: hErr } = await supabase
              .from('history_leads_lead')
              .select('original_id, changed_at, case_handler_id')
              .in('original_id', chunk)
              .order('changed_at', { ascending: true });
            if (hErr) throw hErr;
            const lastHandlerNameByLead = new Map<string, string>();
            const lastHandlerChangedAtByLead = new Map<string, string>();
            (hist || []).forEach((row: any) => {
              const oid = String(row.original_id);
              if (!firstHandlerAssignedDateByLegacyLeadId.has(oid)) {
                const caseHandlerIdAny = row.case_handler_id != null ? String(row.case_handler_id) : '';
                const hasAnyHandler = caseHandlerIdAny !== '' && caseHandlerIdAny !== '0';
                if (hasAnyHandler) {
                  const dAny = safeParseDate(row.changed_at);
                  if (dAny) firstHandlerAssignedDateByLegacyLeadId.set(oid, dAny.toISOString().split('T')[0]);
                }
              }

              const caseHandlerId = row.case_handler_id != null ? String(row.case_handler_id) : '';
              const isAssignedToMe = caseHandlerId !== '' && caseHandlerId === employeeIdStr;
              if (isAssignedToMe) {
                const d = safeParseDate(row.changed_at);
                if (!d) return;
                const prevNameRaw = lastHandlerNameByLead.get(oid) || null;
                const prevName = !prevNameRaw || isUnassignedLike(prevNameRaw) ? null : prevNameRaw;
                const prevDate = lastHandlerChangedAtByLead.get(oid) || null;
                if (prevName) previousHandlerNameByLegacyLeadId.set(oid, prevName);
                else previousHandlerNameByLegacyLeadId.delete(oid);
                if (prevDate) previousHandlerAssignedDateByLegacyLeadId.set(oid, prevDate);
                else previousHandlerAssignedDateByLegacyLeadId.delete(oid);
                handlerAssignedDateByLegacyLeadId.set(oid, d.toISOString().split('T')[0]);
              }

              if (isAssignedToMe) return;
              const anyHandlerDisplay = resolveHandlerDisplayName(row.case_handler_id);
              if (anyHandlerDisplay && !isUnassignedLike(anyHandlerDisplay)) {
                const dAny = safeParseDate(row.changed_at);
                if (dAny) {
                  lastHandlerNameByLead.set(oid, anyHandlerDisplay);
                  lastHandlerChangedAtByLead.set(oid, dAny.toISOString().split('T')[0]);
                }
              }
            });
          }
        }

        // Stage dates
        const fetchStageDates = async (stage: number, ids: any[], column: 'newlead_id' | 'lead_id', target: Map<string, string>, pick: 'earliest' | 'latest') => {
          const chunkSize = 200;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const q = supabase
              .from('leads_leadstage')
              .select(`${column}, date, cdate`)
              .eq('stage', stage)
              .in(column, chunk)
              .order('date', { ascending: true, nullsFirst: false })
              .order('cdate', { ascending: true, nullsFirst: false });
            const { data, error } = await q;
            if (error) throw error;
            (data || []).forEach((row: any) => {
              const idVal = row?.[column];
              if (!idVal) return;
              const lid = String(idVal);
              const d = safeParseDate(row.date) || safeParseDate(row.cdate);
              if (!d) return;
              const nextVal = d.toISOString().split('T')[0];
              const prevVal = target.get(lid);
              if (!prevVal) {
                target.set(lid, nextVal);
                return;
              }
              const prevD = safeParseDate(prevVal);
              if (!prevD) {
                target.set(lid, nextVal);
                return;
              }
              if (pick === 'earliest' ? d.getTime() < prevD.getTime() : d.getTime() > prevD.getTime()) {
                target.set(lid, nextVal);
              }
            });
          }
        };

        if (newLeadIds.length > 0) {
          await fetchStageDates(105, newLeadIds, 'newlead_id', stage105DateByNewLeadId, 'earliest');
          await fetchStageDates(110, newLeadIds, 'newlead_id', stage110DateByNewLeadId, 'latest');
        }
        if (legacyLeadIds.length > 0) {
          await fetchStageDates(105, legacyLeadIds, 'lead_id', stage105DateByLegacyLeadId, 'earliest');
          await fetchStageDates(110, legacyLeadIds, 'lead_id', stage110DateByLegacyLeadId, 'latest');
        }

        stage105DateByNewLeadId.forEach((d, id) => {
          if (!handlerAssignedDateByNewLeadId.has(id)) handlerAssignedDateByNewLeadId.set(id, d);
        });
        stage105DateByLegacyLeadId.forEach((d, id) => {
          if (!handlerAssignedDateByLegacyLeadId.has(id)) handlerAssignedDateByLegacyLeadId.set(id, d);
        });

        const processedNew: Case[] = newLeads.map((lead: any) => {
          const stageId = lead.stage != null ? Number(lead.stage) : null;
          const created = lead.created_at || null;
          const createdDateOnly = created ? String(created).split('T')[0] : null;
          return {
            id: lead.id,
            isNewLead: true,
            lead_number: lead.lead_number,
            name: lead.name,
            stage: lead.stage,
            stageId,
            category: lead.category ?? null,
            category_id: lead.category_id ?? null,
            category_display: formatCategoryDisplay(lead.category_id, lead.category, categoryMap),
            active_handler_type: Number(lead.active_handler_type) === 1 ? 1 : 2,
            created_at: created,
            assigned_date: createdDateOnly,
            linked_master_lead: lead.linked_master_lead,
            unactivated_at: lead.unactivated_at,
            paid_status: paymentByLeadId.get(String(lead.id)) || null,
            handler_assigned_date: handlerAssignedDateByNewLeadId.get(String(lead.id)) || null,
            first_handler_assigned_date: firstHandlerAssignedDateByNewLeadId.get(String(lead.id)) || null,
            previous_handler_name: previousHandlerNameByNewLeadId.get(String(lead.id)) || null,
            previous_handler_assigned_date: previousHandlerAssignedDateByNewLeadId.get(String(lead.id)) || null,
            stage_105_date: stage105DateByNewLeadId.get(String(lead.id)) || null,
            stage_110_date: stage110DateByNewLeadId.get(String(lead.id)) || null,
          };
        });

        const processedLegacy: Case[] = legacyLeads.map((lead: any) => {
          const stageId = lead.stage != null ? Number(lead.stage) : null;
          const cdate = lead.cdate || null;
          const createdDateOnly = cdate ? String(cdate).split('T')[0] : null;
          const masterId = lead.master_id != null ? String(lead.master_id).trim() : '';
          let legacySubleadSuffix: string | null = null;
          if (masterId) {
            const manual = String(lead.manual_id || '');
            if (manual.includes('/')) legacySubleadSuffix = manual.split('/').slice(1).join('/') || null;
          }
          return {
            id: `legacy_${lead.id}`,
            isNewLead: false,
            manual_id: lead.manual_id,
            legacy_master_id: lead.master_id,
            legacy_sublead_suffix: legacySubleadSuffix,
            name: lead.name,
            stage: lead.stage,
            stageId,
            category: lead.category ?? null,
            category_id: lead.category_id ?? null,
            category_display: formatCategoryDisplay(lead.category_id, lead.category, categoryMap),
            active_handler_type: Number(lead.active_handler_type) === 1 ? 1 : 2,
            cdate,
            assigned_date: createdDateOnly,
            linked_master_lead: lead.linked_master_lead,
            status: lead.status,
            paid_status: null,
            handler_assigned_date: handlerAssignedDateByLegacyLeadId.get(String(lead.id)) || null,
            first_handler_assigned_date: firstHandlerAssignedDateByLegacyLeadId.get(String(lead.id)) || null,
            previous_handler_name: previousHandlerNameByLegacyLeadId.get(String(lead.id)) || null,
            previous_handler_assigned_date: previousHandlerAssignedDateByLegacyLeadId.get(String(lead.id)) || null,
            stage_105_date: stage105DateByLegacyLeadId.get(String(lead.id)) || null,
            stage_110_date: stage110DateByLegacyLeadId.get(String(lead.id)) || null,
          };
        });

        const all = [...processedNew, ...processedLegacy];

        const newCases = all.filter((c) => {
          const stageId = c.stageId;
          const isInactive = !!c.unactivated_at;
          return !isInactive && stageId != null && stageId <= 105 && Number(c.active_handler_type) === 2;
        });
        const activeCases = all.filter((c) => {
          const stageId = c.stageId;
          const isInactive = !!c.unactivated_at;
          if (isInactive || stageId == null || Number(stageId) === 200 || Number(c.active_handler_type) === 1) return false;
          return Number(stageId) >= 110;
        });
        const nonActiveCases = all.filter((c) => Number(c.active_handler_type) === 1 && Number(c.stageId) !== 200);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const withBadges = (c: Case, bucket: 'new' | 'active' | 'nonActive') => {
          const assignedBase = safeParseDate(c.handler_assigned_date || c.stage_105_date || c.assigned_date);
          const assignedDate = assignedBase || safeParseDate(c.assigned_date || undefined);
          const prevHandlerName = (c.previous_handler_name || '').trim();
          const myHandler = safeParseDate(c.handler_assigned_date || undefined);
          let isNewBadge = false;
          if (bucket === 'new') {
            if (assignedBase) {
              const base = new Date(assignedBase);
              base.setHours(0, 0, 0, 0);
              const daysSince = Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
              isNewBadge = daysSince >= 0 && daysSince <= 7;
            }
          } else {
            const s110 = safeParseDate(c.stage_110_date || undefined);
            if (s110) {
              const base = new Date(s110);
              base.setHours(0, 0, 0, 0);
              const daysSince = Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
              isNewBadge = daysSince >= 0 && daysSince <= 7;
            }
          }
          const isReassigned = !!myHandler && !!prevHandlerName;
          const isReassignedRecent = (() => {
            if (!isReassigned || !myHandler) return false;
            const base = new Date(myHandler);
            base.setHours(0, 0, 0, 0);
            const daysSince = Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
            return daysSince >= 0 && daysSince <= 7;
          })();
          const displayDate = assignedDate ? formatDateDDMMYY(assignedDate) : '—';
          const sortMs = assignedDate ? assignedDate.getTime() : 0;
          return { isNewBadge, isReassignedRecent, displayDate, sortMs };
        };

        const important = [
          ...newCases.map((c) => ({ c, bucket: 'new' as const, b: withBadges(c, 'new') })),
          ...activeCases.map((c) => ({ c, bucket: 'active' as const, b: withBadges(c, 'active') })),
          ...nonActiveCases.map((c) => ({ c, bucket: 'nonActive' as const, b: withBadges(c, 'nonActive') })),
        ]
          .filter((x) => x.b.isNewBadge || x.b.isReassignedRecent)
          .sort((a, b) => (b.b.sortMs || 0) - (a.b.sortMs || 0));

        setCases(important.map((x) => x.c));
        setPage(1);
      } catch (e: any) {
        toast.error(typeof e?.message === 'string' ? e.message : 'Failed to load handler cases');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  const orderedItems = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const withMeta = cases.map((c) => {
      const isNewCasesBucket = c.stageId != null && c.stageId <= 105 && Number(c.active_handler_type) === 2 && !c.unactivated_at;
      const isNonActiveBucket = Number(c.active_handler_type) === 1 && Number(c.stageId) !== 200;
      const bucket: 'new' | 'active' | 'nonActive' = isNewCasesBucket ? 'new' : isNonActiveBucket ? 'nonActive' : 'active';

      const assignedBase = safeParseDate(c.handler_assigned_date || c.stage_105_date || c.assigned_date);
      const assignedDate = assignedBase || safeParseDate(c.assigned_date || undefined);
      const displayDate = assignedDate ? formatDateDDMMYY(assignedDate) : '—';
      const sortMs = assignedDate ? assignedDate.getTime() : 0;

      let isNewBadge = false;
      if (bucket === 'new') {
        if (assignedBase) {
          const base = new Date(assignedBase);
          base.setHours(0, 0, 0, 0);
          const daysSince = Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
          isNewBadge = daysSince >= 0 && daysSince <= 7;
        }
      } else {
        const s110 = safeParseDate(c.stage_110_date || undefined);
        if (s110) {
          const base = new Date(s110);
          base.setHours(0, 0, 0, 0);
          const daysSince = Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
          isNewBadge = daysSince >= 0 && daysSince <= 7;
        }
      }

      const prevHandlerName = (c.previous_handler_name || '').trim();
      const myHandler = safeParseDate(c.handler_assigned_date || undefined);
      const isReassigned = !!myHandler && !!prevHandlerName;
      const isReassignedRecent = (() => {
        if (!isReassigned || !myHandler) return false;
        const base = new Date(myHandler);
        base.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
        return daysSince >= 0 && daysSince <= 7;
      })();

      const showNewBadge = isNewBadge && !isReassignedRecent;

      return { c, bucket, displayDate, sortMs, prevHandlerName, isReassignedRecent, showNewBadge };
    });

    const sortDesc = (a: any, b: any) => (b.sortMs || 0) - (a.sortMs || 0);
    const newItems = withMeta.filter((x) => x.bucket === 'new').sort(sortDesc);
    const activeItems = withMeta.filter((x) => x.bucket === 'active').sort(sortDesc);
    const nonActiveItems = withMeta.filter((x) => x.bucket === 'nonActive').sort(sortDesc);
    return [...newItems, ...activeItems, ...nonActiveItems];
  }, [cases]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(orderedItems.length / pageSize)), [orderedItems.length]);
  const safePage = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);
  const visible = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return orderedItems.slice(start, start + pageSize);
  }, [orderedItems, safePage]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage]);

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 w-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
            <UserGroupIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">New handler cases</h3>
            <p className="text-sm text-gray-500">Cases marked New or Re-assigned for you</p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
          <div className="badge badge-neutral badge-outline">{cases.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-500">
          <span className="loading loading-spinner loading-lg text-purple-600" />
          <p>Loading handler cases...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No new or re-assigned cases.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead className="bg-white border-b border-gray-200">
              <tr>
                <th className="text-gray-700 font-medium">Case</th>
                <th className="text-gray-700 font-medium">Stage</th>
                <th className="text-gray-700 font-medium">Category</th>
                <th className="text-gray-700 font-medium">Assigned</th>
                <th className="text-gray-700 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const cols = 5; // Case, Stage, Category, Assigned, Paid
                const groups: Array<{ key: 'new' | 'active' | 'nonActive'; label: string }> = [
                  { key: 'new', label: 'New cases' },
                  { key: 'active', label: 'Active cases' },
                  { key: 'nonActive', label: 'Non-active cases' },
                ];

                const out: React.ReactNode[] = [];
                groups.forEach((g) => {
                  const groupRows = visible.filter((v) => v.bucket === g.key);
                  if (groupRows.length === 0) return;
                  out.push(
                    <tr key={`group-${g.key}`}>
                      <td colSpan={cols} className="bg-gray-50 text-gray-700 font-semibold">
                        {g.label}
                      </td>
                    </tr>
                  );

                  groupRows.forEach(({ c, bucket, displayDate, prevHandlerName, isReassignedRecent, showNewBadge }) => {
                    out.push(
                  <tr
                    key={String(c.id)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => handleCaseClick(c)}
                    title="Open client"
                  >
                    <td>
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-900">{c.name || 'No name'}</span>
                        <span className="text-sm text-gray-500">#{formatLeadNumberForList(c)}</span>
                      </div>
                    </td>
                    <td className="text-sm text-gray-700">
                      {(() => {
                        const stageRaw = c.stageId != null ? c.stageId : c.stage;
                        if (stageRaw == null || stageRaw === '') {
                          return <span className="text-gray-300">—</span>;
                        }
                        const stageKey = String(stageRaw);
                        const label = getStageName(stageKey) || stageKey;
                        const stageColour = getStageColour(stageKey) || '#e5e7eb';
                        const textColour = getContrastingTextColor(stageColour);
                        return (
                          <span
                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold shadow-sm"
                            style={{ backgroundColor: stageColour, color: textColour, border: `1px solid ${stageColour}` }}
                            title={label}
                          >
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-sm text-gray-700">
                      <span className="truncate block max-w-[240px]">{c.category_display || '—'}</span>
                    </td>
                    <td className="text-sm text-gray-700">
                      <div
                        className={`relative inline-flex items-center ${
                          isReassignedRecent ? 'tooltip tooltip-top' : ''
                        }`}
                        {...(isReassignedRecent ? { 'data-tip': `Re-assigned from ${prevHandlerName} to you` } : {})}
                      >
                        <span className="badge badge-ghost badge-outline font-semibold pr-3">
                          {displayDate}
                        </span>
                        {showNewBadge ? (
                          <span
                            className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase text-white shadow-md border border-white/40 bg-gradient-to-r from-emerald-500 to-teal-500"
                            style={{ lineHeight: 1 }}
                          >
                            New
                          </span>
                        ) : null}
                        {isReassignedRecent ? (
                          <span
                            className={`absolute -right-2 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase text-white shadow-md border border-white/40 bg-gradient-to-r from-amber-500 to-orange-500 ${
                              showNewBadge ? 'top-3' : '-top-2'
                            }`}
                            style={{ lineHeight: 1 }}
                          >
                            Re-assigned
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {bucket !== 'new' ? (
                        <span className="text-gray-300">—</span>
                      ) : c.paid_status === 'paid' ? (
                        <span className="tooltip tooltip-top" data-tip="Paid">
                          <CheckCircleIcon className="w-5 h-5 text-emerald-600" />
                        </span>
                      ) : (
                        <span className="tooltip tooltip-top" data-tip="Not paid">
                          <XCircleIcon className="w-5 h-5 text-rose-500" />
                        </span>
                      )}
                    </td>
                  </tr>
                    );
                  });
                });
                return out;
              })()}
            </tbody>
          </table>
          <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-gray-500">
            <div>
              Showing {(safePage - 1) * pageSize + (visible.length ? 1 : 0)}-
              {(safePage - 1) * pageSize + visible.length} of {cases.length} important cases
            </div>
            <div className="join">
              <button
                type="button"
                className="join-item btn btn-sm btn-outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                Prev
              </button>
              <button type="button" className="join-item btn btn-sm btn-ghost pointer-events-none">
                Page {safePage} / {totalPages}
              </button>
              <button
                type="button"
                className="join-item btn btn-sm btn-outline"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewHandlerCasesWidget;

