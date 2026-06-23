import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/react/24/solid';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';
import {
  fetchProformaExchangeRateInfo,
  currencyInputFromNewPayment,
  currencyInputFromLegacyProforma,
} from '../lib/proformaExchangeRate';
import { loadAccountingCurrenciesMap } from '../lib/boiCurrencyConversion';

const EXPORT_COLUMNS = [
  'Lead',
  'create_date',
  'name',
  'email',
  'phone',
  'mobile',
  'language',
  'stage',
  'category',
  'source',
  'topic',
  'tags',
  'eligibility determined',
  'file_id',
  'status',
  'unactivation_reason',
  'deactivate_notes',
  'facts',
  'description',
] as const;

/** Columns for the downloadable Excel import template — only name is required. */
const IMPORT_COLUMNS = [
  'name',
  'email',
  'phone',
  'mobile',
  'language',
  'topic',
  'source_id',
  'file_id',
  'facts',
] as const;

const DEFAULT_IMPORT_LANGUAGE = 'HE';
const DEFAULT_IMPORT_SOURCE = 'Import';

/** Columns for the paid payments export (by date paid). */
const PAID_PAYMENTS_COLUMNS = [
  'Lead',
  'Client Name',
  'Paid At',
  'Total Amount (NIS)',
  'Order',
] as const;

type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;
type PaidPaymentRow = Record<(typeof PAID_PAYMENTS_COLUMNS)[number], string | number>;

const today = () => new Date().toISOString().slice(0, 10);

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Format a paid payment "order" value into a readable label. */
const orderLabel = (val: unknown): string => {
  if (val == null || String(val).trim() === '') return '';
  const s = String(val).trim();
  const num = Number(s);
  if (!Number.isFinite(num) || s !== String(num)) return s; // already descriptive text
  const labels: Record<number, string> = {
    1: 'First Payment',
    2: 'Second Payment',
    3: 'Third Payment',
    4: 'Fourth Payment',
    5: 'Fifth Payment',
    6: 'Sixth Payment',
    7: 'Seventh Payment',
    8: 'Eighth Payment',
    9: 'Ninth Payment',
    10: 'Tenth Payment',
  };
  return labels[num] ?? `Payment ${num}`;
};

const formatExportDate = (val: string | null | undefined): string => {
  if (val == null) return '';
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return String(val ?? '');
  }
};

/** Strip all HTML tags (e.g. <br>, <br/>, <p>, </div>) from text for export. */
const stripHtml = (val: string | null | undefined): string => {
  if (val == null || typeof val !== 'string') return '';
  return val
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const defaultFilters = {
  fromDate: today(),
  toDate: today(),
  stage: [] as string[],
  category: [] as string[],
  source: [] as string[],
  language: [] as string[],
  tags: [] as string[],
  topic: '',
  eligibilityDeterminedOnly: false,
  fileId: '',
  status: '', // '' = all, 'active', 'inactive'
};

type FilterField = keyof typeof defaultFilters;

function MultiSelectSearch({
  label,
  field,
  values,
  options,
  placeholder,
  onChange,
  onOpenChange,
  isOpen,
  searchTerm,
  onSearchChange,
}: {
  label: string;
  field: string;
  values: string[];
  options: string[];
  placeholder: string;
  onChange: (field: FilterField, value: string[]) => void;
  onOpenChange: (field: string | null) => void;
  isOpen: boolean;
  searchTerm: string;
  onSearchChange: (field: string, value: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const filtered = options.filter(
    (opt) => !values.includes(opt) && opt.toLowerCase().includes(searchTerm.toLowerCase())
  );

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(null);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onOpenChange]);

  const add = (opt: string) => {
    if (!values.includes(opt)) {
      onChange(field as FilterField, [...values, opt]);
      // Keep dropdown open: refocus input after state update so user can keep selecting
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };
  const remove = (opt: string) => {
    onChange(field as FilterField, values.filter((v) => v !== opt));
  };

  const clearAll = () => {
    onChange(field as FilterField, []);
  };

  return (
    <div ref={containerRef} className="form-control relative flex flex-col items-stretch">
      <div className="label justify-between py-1">
        <label className="cursor-default">
          <span className="label-text">{label}</span>
          {values.length > 0 && (
            <span className="label-text-alt text-base-content/60 ml-1">{values.length} selected</span>
          )}
        </label>
        {values.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content"
            onClick={clearAll}
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        className="input input-bordered w-full"
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => onSearchChange(field, e.target.value)}
        onFocus={() => onOpenChange(field)}
      />
      {isOpen && (
        <div className="w-full -mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-80 overflow-y-auto z-10 relative">
          {values.length > 0 && (
            <div className="p-2 border-b border-base-300 bg-primary/15 flex flex-col gap-1.5 rounded-t-lg">
              {values.map((v) => (
                <span key={v} className="flex items-center justify-between gap-2 w-full text-sm text-base-content">
                  <span>{v}</span>
                  <button
                    type="button"
                    className="btn btn-ghost p-0 min-h-0 h-8 w-8 rounded-full hover:bg-primary/20 shrink-0 flex items-center justify-center"
                    onClick={() => remove(v)}
                    aria-label={`Remove ${v}`}
                  >
                    <span className="text-xl leading-none font-bold">×</span>
                  </button>
                </span>
              ))}
            </div>
          )}
          {filtered.length === 0 && values.length === 0 ? (
            <div className="px-3 py-2 text-sm text-base-content/60">No options</div>
          ) : filtered.length === 0 ? null : (
            <div className="py-1">
              {filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-base-200"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    add(opt);
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadsReportPage() {
  const { instance } = useMsal();
  const [filters, setFilters] = useState(defaultFilters);
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [exportingPaid, setExportingPaid] = useState(false);
  const [paidFromDate, setPaidFromDate] = useState(daysAgo(30));
  const [paidToDate, setPaidToDate] = useState(today());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUserEmail = (instance?.getAllAccounts?.()?.[0]?.username as string) || null;

  const getDropdownSearch = (field: string) => dropdownSearch[field] ?? '';
  const setDropdownSearchFor = (field: string, value: string) => {
    setDropdownSearch((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [stagesRes, categoriesRes, sourcesRes, languagesRes, tagsRes] = await Promise.all([
          supabase.from('lead_stages').select('id, name').order('id', { ascending: true }),
          supabase.from('misc_category').select('id, name, parent_id, misc_maincategory!parent_id(id, name)').order('name'),
          supabase.from('misc_leadsource').select('id, name').eq('active', true).order('name'),
          supabase.from('misc_language').select('id, name').order('name'),
          supabase.from('misc_leadtag').select('name, order').eq('active', true).order('order', { ascending: true }).order('name'),
        ]);

        if (stagesRes.data) {
          setStageOptions(stagesRes.data.map((s: { name: string }) => s.name));
        }
        if (categoriesRes.data) {
          setCategoryOptions(
            (categoriesRes.data as any[]).map((c: any) => {
              const main = Array.isArray(c.misc_maincategory) ? c.misc_maincategory[0] : c.misc_maincategory;
              return main?.name ? `${c.name} (${main.name})` : c.name;
            })
          );
        }
        if (sourcesRes.data) {
          setSourceOptions(sourcesRes.data.map((s: { name: string }) => s.name));
        }
        if (languagesRes.data) {
          setLanguageOptions([...(languagesRes.data as { name: string }[]).map((l) => l.name), 'N/A']);
        }
        if (tagsRes.data) {
          setTagOptions((tagsRes.data as { name: string }[]).map((t) => t.name).filter(Boolean));
        }
      } catch (e) {
        console.error('Error fetching filter options:', e);
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: keyof typeof defaultFilters, value: string | boolean | string[]) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const mapNewLeadToRow = (lead: any, stageMap: Map<number, string>, categoryMap: Map<number, string>, tagsFromJunction?: string): ExportRow => {
    const isInactive = lead.unactivated_at != null;
    const status = isInactive ? 'inactive' : 'active';
    const eligibility = lead.expert_eligibility_assessed === true || lead.expert_eligibility_assessed === 'true' ? 'TRUE' : 'FALSE';
    const stageName = stageMap.get(Number(lead.stage_id)) ?? stageMap.get(Number(lead.stage)) ?? lead.stage ?? '';
    const categoryName = lead.category_id != null ? categoryMap.get(Number(lead.category_id)) : (lead.category ?? '');
    return {
      Lead: lead.lead_number ?? lead.manual_id ?? lead.id ?? '',
      create_date: formatExportDate(lead.created_at),
      name: lead.name ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      mobile: lead.mobile ?? '',
      language: lead.language ?? '',
      stage: String(stageName),
      category: String(categoryName ?? ''),
      source: lead.source ?? '',
      topic: lead.topic ?? '',
      tags: tagsFromJunction ?? (typeof lead.tags === 'string' ? lead.tags : Array.isArray(lead.tags) ? lead.tags.join(', ') : ''),
      'eligibility determined': eligibility,
      file_id: lead.file_id ?? '',
      status,
      unactivation_reason: lead.unactivation_reason ?? '',
      deactivate_notes: lead.deactivate_notes ?? '',
      facts: stripHtml(lead.facts),
      description: '',
    };
  };

  const mapLegacyLeadToRow = (lead: any, stageMap: Map<number, string>, categoryMap: Map<number, string>, languageMap: Map<number, string>, sourceMap: Map<number, string>, tagsFromJunction?: string): ExportRow => {
    const statusVal = lead.status != null && (Number(lead.status) === 10 || lead.status === '10') ? 'inactive' : 'active';
    const stageName = lead.stage != null ? (stageMap.get(Number(lead.stage)) ?? stageMap.get(lead.stage) ?? String(lead.stage)) : '';
    const catName = lead.category_id != null ? categoryMap.get(lead.category_id) : (lead.category ?? '');
    const langName = lead.language_id != null ? languageMap.get(lead.language_id) : (lead.language ?? '');
    const srcName = lead.source_id != null ? sourceMap.get(lead.source_id) : (lead.source ?? '');
    const eligibility = lead.expert_eligibility_assessed === true || lead.expert_eligibility_assessed === 'true' ? 'TRUE' : 'FALSE';
    const reasonName = lead.unactivation_reason ?? (lead.misc_reason?.name ?? (Array.isArray(lead.misc_reason) ? lead.misc_reason[0]?.name : null)) ?? '';
    return {
      Lead: lead.manual_id?.toString() ?? lead.id?.toString() ?? '',
      create_date: formatExportDate(lead.cdate),
      name: lead.name ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      mobile: lead.mobile ?? '',
      language: langName ?? '',
      stage: String(stageName ?? ''),
      category: catName ?? '',
      source: srcName ?? '',
      topic: lead.topic ?? '',
      tags: tagsFromJunction ?? '',
      'eligibility determined': eligibility,
      file_id: lead.file_id ?? '',
      status: statusVal,
      unactivation_reason: (reasonName || lead.deactivate_notes) ?? '',
      deactivate_notes: lead.deactivate_notes ?? '',
      facts: '',
      description: stripHtml(lead.description),
    };
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const fromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
      const toDate = filters.toDate ? `${filters.toDate}T23:59:59` : null;

      const stageMap = new Map<number, string>();
      const categoryMap = new Map<number, string>();
      const languageMap = new Map<number, string>();
      const sourceMap = new Map<number, string>();
      const stageNameToId = new Map<string, number>();
      const categoryNameToId = new Map<string, number>();
      const languageNameToId = new Map<string, number>();
      const sourceNameToId = new Map<string, number>();

      const [stagesRes, categoriesRes, languagesRes, sourcesRes, tagsRes] = await Promise.all([
        supabase.from('lead_stages').select('id, name'),
        supabase.from('misc_category').select('id, name, parent_id, misc_maincategory!parent_id(id, name)'),
        supabase.from('misc_language').select('id, name'),
        supabase.from('misc_leadsource').select('id, name'),
        supabase.from('misc_leadtag').select('id, name').eq('active', true),
      ]);
      const tagNameToId = new Map<string, number>();
      (tagsRes.data as { id: number; name: string }[])?.forEach((t) => tagNameToId.set(t.name, t.id));

      stagesRes.data?.forEach((s: any) => {
        stageMap.set(s.id, s.name);
        stageNameToId.set(s.name, s.id);
      });
      (categoriesRes.data as any[])?.forEach((c: any) => {
        const main = Array.isArray(c.misc_maincategory) ? c.misc_maincategory[0] : c.misc_maincategory;
        const displayName = main?.name ? `${c.name} (${main.name})` : c.name;
        categoryMap.set(c.id, displayName);
        categoryNameToId.set(displayName, c.id);
        categoryNameToId.set(c.name, c.id);
      });
      (languagesRes.data as { id: number; name: string }[])?.forEach((l) => {
        languageMap.set(l.id, l.name);
        languageNameToId.set(l.name, l.id);
      });
      (sourcesRes.data as { id: number; name: string }[])?.forEach((s) => {
        sourceMap.set(s.id, s.name);
        sourceNameToId.set(s.name, s.id);
      });

      const categoryIds = filters.category
        .map((c) => categoryNameToId.get(c) ?? categoryNameToId.get(c.split(' (')[0]))
        .filter((id): id is number => id != null);

      // Stage filter: both leads and leads_lead use numeric stage IDs (bigint), not names
      const stageIds = filters.stage
        .map((s) => stageNameToId.get(s))
        .filter((id): id is number => id != null);

      // Tag filter via junction table leads_lead_tags + misc_leadtag (for both new and legacy)
      let newLeadIdsWithTags: number[] | null = null;
      let legacyLeadIdsWithTags: number[] | null = null;
      if (filters.tags.length > 0) {
        const tagIds = filters.tags.map((t) => tagNameToId.get(t)).filter((id): id is number => id != null);
        if (tagIds.length > 0) {
          const { data: newTagRows } = await supabase
            .from('leads_lead_tags')
            .select('newlead_id')
            .in('leadtag_id', tagIds)
            .not('newlead_id', 'is', null);
          newLeadIdsWithTags = [...new Set((newTagRows || []).map((r: any) => r.newlead_id).filter(Boolean))];
          const { data: legacyTagRows } = await supabase
            .from('leads_lead_tags')
            .select('lead_id')
            .in('leadtag_id', tagIds)
            .not('lead_id', 'is', null);
          legacyLeadIdsWithTags = [...new Set((legacyTagRows || []).map((r: any) => r.lead_id).filter(Boolean))];
        }
      }

      let newQuery = supabase
        .from('leads')
        .select('id, lead_number, manual_id, name, email, phone, mobile, topic, file_id, unactivated_at, unactivation_reason, deactivate_notes, expert_eligibility_assessed, stage, category_id, category, source, language, created_at, facts')
        .order('created_at', { ascending: false });

      if (fromDate) newQuery = newQuery.gte('created_at', fromDate);
      if (toDate) newQuery = newQuery.lte('created_at', toDate);
      if (stageIds.length > 0) newQuery = newQuery.in('stage', stageIds);
      if (categoryIds.length > 0) newQuery = newQuery.in('category_id', categoryIds);
      if (filters.source.length > 0) newQuery = newQuery.in('source', filters.source);
      if (filters.language.length > 0) {
        const hasNA = filters.language.includes('N/A');
        const rest = filters.language.filter((l) => l !== 'N/A');
        if (hasNA && rest.length === 0) newQuery = newQuery.is('language_id', null);
        else if (hasNA && rest.length > 0) newQuery = newQuery.or(`language_id.is.null,language.in.(${rest.join(',')})`);
        else newQuery = newQuery.in('language', rest);
      }
      if (filters.topic) newQuery = newQuery.ilike('topic', `%${filters.topic}%`);
      if (newLeadIdsWithTags !== null) {
        if (newLeadIdsWithTags.length === 0) newQuery = newQuery.in('id', [-1]);
        else newQuery = newQuery.in('id', newLeadIdsWithTags);
      }
      if (filters.fileId) newQuery = newQuery.ilike('file_id', `%${filters.fileId}%`);
      if (filters.eligibilityDeterminedOnly) newQuery = newQuery.eq('expert_eligibility_assessed', true);
      if (filters.status === 'active') newQuery = newQuery.is('unactivated_at', null);
      if (filters.status === 'inactive') newQuery = newQuery.not('unactivated_at', 'is', null);

      const { data: newLeads, error: newError } = await newQuery;

      if (newError) throw newError;

      let legacyQuery = supabase
        .from('leads_lead')
        .select('id, manual_id, name, email, phone, mobile, topic, file_id, status, stage, category_id, language_id, source_id, unactivation_reason, deactivate_notes, expert_eligibility_assessed, cdate, description, misc_reason!fk_leads_lead_reason_id(name)')
        .order('cdate', { ascending: false });

      if (fromDate) legacyQuery = legacyQuery.gte('cdate', fromDate);
      if (toDate) legacyQuery = legacyQuery.lte('cdate', toDate);
      if (filters.status === 'active') legacyQuery = legacyQuery.neq('status', 10);
      if (filters.status === 'inactive') legacyQuery = legacyQuery.eq('status', 10);
      if (stageIds.length > 0) legacyQuery = legacyQuery.in('stage', stageIds);
      if (categoryIds.length > 0) legacyQuery = legacyQuery.in('category_id', categoryIds);
      const hasNALang = filters.language.includes('N/A');
      const languageIds = filters.language.filter((l) => l !== 'N/A').map((l) => languageNameToId.get(l)).filter((id): id is number => id != null);
      if (hasNALang && languageIds.length === 0) legacyQuery = legacyQuery.is('language_id', null);
      else if (hasNALang && languageIds.length > 0) legacyQuery = legacyQuery.or(`language_id.is.null,language_id.in.(${languageIds.join(',')})`);
      else if (languageIds.length > 0) legacyQuery = legacyQuery.in('language_id', languageIds);
      const sourceIds = filters.source.map((s) => sourceNameToId.get(s)).filter((id): id is number => id != null);
      if (sourceIds.length > 0) legacyQuery = legacyQuery.in('source_id', sourceIds);
      if (filters.topic) legacyQuery = legacyQuery.ilike('topic', `%${filters.topic}%`);
      if (legacyLeadIdsWithTags !== null) {
        if (legacyLeadIdsWithTags.length === 0) legacyQuery = legacyQuery.in('id', [-1]);
        else legacyQuery = legacyQuery.in('id', legacyLeadIdsWithTags);
      }
      if (filters.fileId) legacyQuery = legacyQuery.ilike('file_id', `%${filters.fileId}%`);
      if (filters.eligibilityDeterminedOnly) legacyQuery = legacyQuery.eq('expert_eligibility_assessed', true);

      const { data: legacyLeads, error: legacyError } = await legacyQuery;

      if (legacyError) {
        console.warn('Legacy leads fetch failed (may not have access):', legacyError);
      }

      const newLeadIds = (newLeads || []).map((l: any) => l.id).filter(Boolean);
      const legacyLeadIds = (legacyLeads || []).map((l: any) => l.id).filter(Boolean);

      const tagMapNew: Record<string, string> = {};
      const tagMapLegacy: Record<string, string> = {};

      if (newLeadIds.length > 0) {
        const { data: newTagRows } = await supabase
          .from('leads_lead_tags')
          .select('newlead_id, misc_leadtag(name)')
          .in('newlead_id', newLeadIds);
        (newTagRows || []).forEach((r: any) => {
          const id = String(r.newlead_id);
          const name = r.misc_leadtag?.name ?? (Array.isArray(r.misc_leadtag) ? r.misc_leadtag[0]?.name : null);
          if (name) tagMapNew[id] = (tagMapNew[id] ? `${tagMapNew[id]}, ${name}` : name);
        });
      }
      if (legacyLeadIds.length > 0) {
        const { data: legacyTagRows } = await supabase
          .from('leads_lead_tags')
          .select('lead_id, misc_leadtag(name)')
          .in('lead_id', legacyLeadIds);
        (legacyTagRows || []).forEach((r: any) => {
          const id = String(r.lead_id);
          const name = r.misc_leadtag?.name ?? (Array.isArray(r.misc_leadtag) ? r.misc_leadtag[0]?.name : null);
          if (name) tagMapLegacy[id] = (tagMapLegacy[id] ? `${tagMapLegacy[id]}, ${name}` : name);
        });
      }

      const rows: ExportRow[] = [];
      (newLeads || []).forEach((lead) => rows.push(mapNewLeadToRow(lead, stageMap, categoryMap, tagMapNew[String(lead.id)])));
      (legacyLeads || []).forEach((lead) => rows.push(mapLegacyLeadToRow(lead, stageMap, categoryMap, languageMap, sourceMap, tagMapLegacy[String(lead.id)])));

      if (rows.length === 0) {
        toast('No leads match the current filters.', { icon: '⚠️' });
        setExporting(false);
        return;
      }

      const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_COLUMNS] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      XLSX.writeFile(wb, `leads_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Exported ${rows.length} lead(s) to Excel.`);
    } catch (err) {
      console.error('Export error:', err);
      toast.error(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const runImport = async () => {
    if (!importFile) {
      toast.error('Please select an Excel file first.');
      return;
    }
    setImporting(true);
    try {
      const data = await importFile.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });

      if (json.length === 0) {
        toast.error('The file has no data rows.');
        setImporting(false);
        return;
      }

      const getVal = (row: Record<string, unknown>, ...keys: string[]): string => {
        for (const key of keys) {
          const raw = row[key];
          if (raw != null && String(raw).trim() !== '') return String(raw).trim();
        }
        return '';
      };

      let created = 0;
      let failed = 0;
      let skipped = 0;

      const optionalString = (value: string): string | null => (value.trim() !== '' ? value.trim() : null);

      const { data: leadSources, error: leadSourcesError } = await supabase
        .from('misc_leadsource')
        .select('id, name, active')
        .eq('active', true)
        .order('name');
      if (leadSourcesError) throw leadSourcesError;

      const sourceByNameLower = new Map<string, { id: number; name: string }>();
      const sourceById = new Map<number, { id: number; name: string }>();
      (leadSources || []).forEach((s: { id: number; name: string }) => {
        if (s.name) sourceByNameLower.set(s.name.trim().toLowerCase(), { id: s.id, name: s.name });
        sourceById.set(s.id, { id: s.id, name: s.name });
      });

      /** Column is named source_id in Excel, but users enter the source name text — resolved to misc_leadsource.id */
      const resolveSourceFromCell = (
        cellValue: string
      ): { id: number; name: string } | null | 'misspelled' => {
        const trimmed = cellValue.trim();
        if (!trimmed) return null;

        if (/^\d+$/.test(trimmed)) {
          const byId = sourceById.get(Number(trimmed));
          if (byId) return byId;
        }

        const byName = sourceByNameLower.get(trimmed.toLowerCase());
        if (byName) return byName;

        return 'misspelled';
      };

      for (let i = 0; i < json.length; i++) {
        const row = json[i] as Record<string, unknown>;
        const rowNum = i + 2; // Excel row (1-based header + data offset)
        const name = getVal(row, 'name', 'Name');
        const email = getVal(row, 'email', 'Email');
        const phone = getVal(row, 'phone', 'Phone');
        const mobile = getVal(row, 'mobile', 'Mobile');
        const topic = getVal(row, 'topic', 'Topic');
        const language = getVal(row, 'language', 'Language') || DEFAULT_IMPORT_LANGUAGE;
        const sourceCell = getVal(row, 'source_id', 'source_id', 'Source ID', 'Source_ID');
        const resolvedSource = resolveSourceFromCell(sourceCell);
        if (resolvedSource === 'misspelled') {
          toast.error(`Row ${rowNum}: source "${sourceCell}" not found — check spelling (use exact lead source name).`);
          failed++;
          continue;
        }
        const sourceId = resolvedSource?.id ?? null;
        const sourceName = resolvedSource?.name ?? DEFAULT_IMPORT_SOURCE;
        const fileId = getVal(row, 'file_id', 'file_id', 'File ID', 'File_ID');
        const facts = getVal(row, 'facts', 'Facts');

        if (!name) {
          skipped++;
          continue;
        }

        const rpcBase = {
          p_lead_name: name,
          p_lead_email: optionalString(email),
          p_lead_phone: optionalString(phone || mobile),
          p_lead_topic: optionalString(topic),
          p_lead_language: language,
          p_lead_source: sourceName,
          p_created_by: currentUserEmail,
          p_balance_currency: 'NIS',
          p_proposal_currency: 'NIS',
        };

        try {
          let lastError: { message?: string } | null = null;
          let createdLeadId: string | null = null;
          let usedValidatedRpc = false;

          const validated = await supabase.rpc('create_lead_with_source_validation', {
            ...rpcBase,
            p_source_code: sourceId,
            p_language_id: null,
            p_country_id: null,
            p_source_url: null,
          });
          lastError = validated.error;
          if (!lastError && validated.data?.[0]?.id) {
            createdLeadId = String(validated.data[0].id);
            usedValidatedRpc = true;
          }

          if (lastError?.message?.includes('does not exist')) {
            const v4 = await supabase.rpc('create_new_lead_v4', rpcBase);
            lastError = v4.error;
            if (!lastError && v4.data?.[0]?.id) {
              createdLeadId = String(v4.data[0].id);
            }

            if (lastError?.message?.includes('does not exist')) {
              const v3 = await supabase.rpc('create_new_lead_v3', {
                p_lead_name: rpcBase.p_lead_name,
                p_lead_email: rpcBase.p_lead_email,
                p_lead_phone: rpcBase.p_lead_phone,
                p_lead_topic: rpcBase.p_lead_topic,
                p_lead_language: rpcBase.p_lead_language,
                p_lead_source: rpcBase.p_lead_source,
                p_created_by: rpcBase.p_created_by,
              });
              lastError = v3.error;
              if (!lastError && v3.data?.[0]?.id) {
                createdLeadId = String(v3.data[0].id);
              }
            }
          }

          if (lastError) throw lastError;

          const extraFields: Record<string, string | number> = {};
          if (phone) extraFields.phone = phone;
          if (mobile) extraFields.mobile = mobile;
          if (fileId) extraFields.file_id = fileId;
          if (facts) extraFields.facts = facts;

          if (sourceId && !usedValidatedRpc) {
            extraFields.source_id = sourceId;
            extraFields.source = sourceName;
          }

          if (createdLeadId && Object.keys(extraFields).length > 0) {
            const { error: updateError } = await supabase
              .from('leads')
              .update(extraFields)
              .eq('id', createdLeadId);
            if (updateError) throw updateError;
          }

          created++;
        } catch (e) {
          console.error('Row import error:', e);
          failed++;
        }
      }

      const parts = [`${created} created`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} skipped (missing name)`);
      toast.success(`Import complete: ${parts.join(', ')}.`);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('Import error:', err);
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const downloadImportTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [...IMPORT_COLUMNS],
      [
        'Example Lead',
        'client@example.com',
        '0501234567',
        '0527654321',
        'HE',
        'German Citizenship',
        'Teams',
        'FILE-123',
        'Brief case facts for this lead',
      ],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    XLSX.writeFile(wb, 'leads_import_template.xlsx');
    toast.success('Template downloaded. Only name is required; source_id column accepts lead source name text.');
  };

  const runPaidPaymentsExport = async () => {
    setExportingPaid(true);
    try {
      await loadAccountingCurrenciesMap();

      const fromTs = paidFromDate ? `${paidFromDate}T00:00:00` : null;
      const toTs = paidToDate ? `${paidToDate}T23:59:59` : null;

      // New leads — paid payment_plans (filter by date paid)
      let newQuery = supabase
        .from('payment_plans')
        .select('id, lead_id, value, value_vat, paid_at, payment_order, "order", currency, currency_id, leads:lead_id(name, lead_number)')
        .eq('paid', true)
        .is('cancel_date', null)
        .not('paid_at', 'is', null)
        .order('paid_at', { ascending: false });
      if (fromTs) newQuery = newQuery.gte('paid_at', fromTs);
      if (toTs) newQuery = newQuery.lte('paid_at', toTs);
      const { data: newPaid, error: newError } = await newQuery;
      if (newError) throw newError;

      // Legacy leads — paid finances_paymentplanrow (paid = actual_date set)
      let legacyQuery = supabase
        .from('finances_paymentplanrow')
        .select('id, lead_id, value, vat_value, actual_date, "order", currency_id')
        .is('cancel_date', null)
        .not('actual_date', 'is', null)
        .order('actual_date', { ascending: false });
      if (fromTs) legacyQuery = legacyQuery.gte('actual_date', fromTs);
      if (toTs) legacyQuery = legacyQuery.lte('actual_date', toTs);
      const { data: legacyPaid, error: legacyError } = await legacyQuery;
      if (legacyError) {
        console.warn('Legacy paid payments fetch failed (may not have access):', legacyError);
      }

      // Resolve legacy lead names / numbers
      const legacyLeadIds = [...new Set((legacyPaid || []).map((r: any) => r.lead_id).filter(Boolean))];
      const legacyLeadMap = new Map<string, { name: string; manual_id: string }>();
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeads } = await supabase
          .from('leads_lead')
          .select('id, name, manual_id')
          .in('id', legacyLeadIds);
        (legacyLeads || []).forEach((l: any) => {
          legacyLeadMap.set(String(l.id), {
            name: l.name ?? '',
            manual_id: l.manual_id != null ? String(l.manual_id) : '',
          });
        });
      }

      const rows: PaidPaymentRow[] = [];

      for (const p of (newPaid || []) as any[]) {
        const value = Number(p.value) || 0;
        const vat = Number(p.value_vat) || 0;
        const lead = Array.isArray(p.leads) ? p.leads[0] : p.leads;
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromNewPayment({ currency: p.currency, currency_id: p.currency_id }, null),
          paid: true,
          paidAt: p.paid_at,
          subtotal: value,
          vat,
          total: value + vat,
        });
        const nis = info ? Math.round(info.totalNis) : Math.round(value + vat);
        rows.push({
          Lead: lead?.lead_number ?? '',
          'Client Name': lead?.name ?? '',
          'Paid At': formatExportDate(p.paid_at),
          'Total Amount (NIS)': nis,
          Order: orderLabel(p.payment_order ?? p.order),
        });
      }

      for (const p of (legacyPaid || []) as any[]) {
        const value = Number(p.value) || 0;
        const vat = Number(p.vat_value) || 0;
        const lead = legacyLeadMap.get(String(p.lead_id));
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromLegacyProforma({ currency_id: p.currency_id, currency_code: null }),
          paid: true,
          paidAt: p.actual_date,
          subtotal: value,
          vat,
          total: value + vat,
        });
        const nis = info ? Math.round(info.totalNis) : Math.round(value + vat);
        rows.push({
          Lead: lead?.manual_id ?? '',
          'Client Name': lead?.name ?? '',
          'Paid At': formatExportDate(p.actual_date),
          'Total Amount (NIS)': nis,
          Order: orderLabel(p.order),
        });
      }

      if (rows.length === 0) {
        toast('No paid payments match the selected date range.', { icon: '⚠️' });
        setExportingPaid(false);
        return;
      }

      // Newest paid first across both sources
      rows.sort((a, b) => String(b['Paid At']).localeCompare(String(a['Paid At'])));

      const ws = XLSX.utils.json_to_sheet(rows, { header: [...PAID_PAYMENTS_COLUMNS] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Paid Payments');
      XLSX.writeFile(wb, `paid_payments_export_${today()}.xlsx`);
      toast.success(`Exported ${rows.length} paid payment(s) to Excel.`);
    } catch (err) {
      console.error('Paid payments export error:', err);
      toast.error(err instanceof Error ? err.message : 'Paid payments export failed.');
    } finally {
      setExportingPaid(false);
    }
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-3xl font-bold">Leads Report</h1>
        <Link to="/reports" className="btn btn-ghost btn-sm self-start sm:self-auto">
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Back to Reports
        </Link>
      </div>

      <div className="grid gap-8 mt-8">
        <section>
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-2">
            <ArrowDownTrayIcon className="w-5 h-5" />
            Export leads to Excel
          </h2>
         
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* From date + To date on same row (mobile and up) */}
              <div className="form-control flex flex-col items-stretch">
                <label className="label justify-start py-1"><span className="label-text">From date</span></label>
                <input type="date" className="input input-bordered" value={filters.fromDate} onChange={(e) => handleFilterChange('fromDate', e.target.value)} />
              </div>
              <div className="form-control flex flex-col items-stretch">
                <label className="label justify-start py-1"><span className="label-text">To date</span></label>
                <input type="date" className="input input-bordered" value={filters.toDate} onChange={(e) => handleFilterChange('toDate', e.target.value)} />
              </div>
              <div className="col-span-2 lg:col-span-1">
                <MultiSelectSearch
                  label="Stage"
                  field="stage"
                  values={filters.stage}
                  options={stageOptions}
                  placeholder="Type and select stages…"
                  onChange={handleFilterChange}
                  onOpenChange={setOpenDropdown}
                  isOpen={openDropdown === 'stage'}
                  searchTerm={getDropdownSearch('stage')}
                  onSearchChange={setDropdownSearchFor}
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <MultiSelectSearch
                  label="Category"
                  field="category"
                  values={filters.category}
                  options={categoryOptions}
                  placeholder="Type and select categories…"
                  onChange={handleFilterChange}
                  onOpenChange={setOpenDropdown}
                  isOpen={openDropdown === 'category'}
                  searchTerm={getDropdownSearch('category')}
                  onSearchChange={setDropdownSearchFor}
                />
              </div>
              <div className="form-control flex flex-row items-center gap-2 col-span-2 lg:col-span-1 pt-2 lg:pt-0 lg:justify-start">
                <input type="checkbox" className="checkbox checkbox-sm" checked={filters.eligibilityDeterminedOnly} onChange={(e) => handleFilterChange('eligibilityDeterminedOnly', e.target.checked)} />
                <label className="label cursor-pointer py-0 min-h-0"><span className="label-text">Eligibility determined only</span></label>
              </div>
              <div className="col-span-2 md:col-span-1">
                <MultiSelectSearch
                  label="Source"
                  field="source"
                  values={filters.source}
                  options={sourceOptions}
                  placeholder="Type and select sources…"
                  onChange={handleFilterChange}
                  onOpenChange={setOpenDropdown}
                  isOpen={openDropdown === 'source'}
                  searchTerm={getDropdownSearch('source')}
                  onSearchChange={setDropdownSearchFor}
                />
              </div>
              {/* Language + Topic on same row */}
              <div>
                <MultiSelectSearch
                  label="Language"
                  field="language"
                  values={filters.language}
                  options={languageOptions}
                  placeholder="Type and select languages…"
                  onChange={handleFilterChange}
                  onOpenChange={setOpenDropdown}
                  isOpen={openDropdown === 'language'}
                  searchTerm={getDropdownSearch('language')}
                  onSearchChange={setDropdownSearchFor}
                />
              </div>
              <div className="form-control flex flex-col items-stretch">
                <label className="label justify-start py-1"><span className="label-text">Topic (contains)</span></label>
                <input type="text" className="input input-bordered" placeholder="Filter by topic" value={filters.topic} onChange={(e) => handleFilterChange('topic', e.target.value)} />
              </div>
              {/* Tags + File ID on same row */}
              <div>
                <MultiSelectSearch
                  label="Tags"
                  field="tags"
                  values={filters.tags}
                  options={tagOptions}
                  placeholder="Type and select tags…"
                  onChange={handleFilterChange}
                  onOpenChange={setOpenDropdown}
                  isOpen={openDropdown === 'tags'}
                  searchTerm={getDropdownSearch('tags')}
                  onSearchChange={setDropdownSearchFor}
                />
              </div>
              <div className="form-control flex flex-col items-stretch">
                <label className="label justify-start py-1"><span className="label-text">File ID (contains)</span></label>
                <input type="text" className="input input-bordered" placeholder="Filter by file_id" value={filters.fileId} onChange={(e) => handleFilterChange('fileId', e.target.value)} />
              </div>
              <div className="form-control flex flex-col items-stretch col-span-2 md:col-span-1">
                <label className="label justify-start py-1"><span className="label-text">Status</span></label>
                <select className="select select-bordered" value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          <div className="flex justify-end mt-4">
            <button
              type="button"
              className="btn btn-primary btn-circle"
              onClick={runExport}
              disabled={exporting}
              title="Export to Excel"
              aria-label="Export to Excel"
            >
              {exporting ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <ArrowDownTrayIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-2">
            <ArrowUpTrayIcon className="w-5 h-5" />
            Import leads from Excel
          </h2>
          <p className="text-sm text-base-content/70 mb-4">
            Upload an Excel file to create new leads. Only <strong>name</strong> is required per row.
            Template columns: name, email, phone, mobile, language, topic, source_id, file_id, facts.
            In <strong>source_id</strong>, enter the lead source <em>name</em> (e.g. Teams) — it is matched to <code>source_id</code> automatically.
            If the name is misspelled, that row fails with a toast error.
            Lead number and create date are assigned automatically; language defaults to Hebrew (HE) if omitted.
          </p>
          <div className="form-control max-w-md">
            <label className="label"><span className="label-text">Select Excel file</span></label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setImportDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImportDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setImportDragOver(false);
                const file = e.dataTransfer?.files?.[0];
                if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
                  setImportFile(file);
                } else if (file) {
                  toast.error('Please drop an Excel file (.xlsx or .xls).');
                }
              }}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${importDragOver ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary/50 hover:bg-base-200/50'}
                ${importFile ? 'bg-base-200/50' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
              <ArrowUpTrayIcon className="w-10 h-10 mx-auto mb-2 text-base-content/50" />
              {importFile ? (
                <p className="text-sm font-medium text-base-content/80">{importFile.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-base-content/80">Drag and drop an Excel file here</p>
                  <p className="text-xs text-base-content/60 mt-1">or click to choose a file</p>
                </>
              )}
            </div>
          </div>
          <div className="flex justify-end items-center gap-2 mt-4">
            <button
              type="button"
              className="btn btn-ghost btn-circle btn-lg"
              onClick={downloadImportTemplate}
              title="Download empty template with column headers (fill in data and upload)"
              aria-label="Download import template"
            >
              <QuestionMarkCircleIcon className="w-8 h-8" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="btn btn-primary btn-circle"
              onClick={runImport}
              disabled={importing || !importFile}
              title="Import from Excel"
              aria-label="Import from Excel"
            >
              {importing ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <ArrowUpTrayIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-2">
            <ArrowDownTrayIcon className="w-5 h-5" />
            Export paid payments to Excel
          </h2>
          <p className="text-sm text-base-content/70 mb-4">
            Export all paid client payments (new and legacy leads) within a date range, filtered by
            the date the payment was paid. Columns: Lead, Client Name, Paid At, Total Amount (NIS), Order.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div className="form-control flex flex-col items-stretch">
              <label className="label justify-start py-1"><span className="label-text">From date (paid)</span></label>
              <input type="date" className="input input-bordered" value={paidFromDate} onChange={(e) => setPaidFromDate(e.target.value)} />
            </div>
            <div className="form-control flex flex-col items-stretch">
              <label className="label justify-start py-1"><span className="label-text">To date (paid)</span></label>
              <input type="date" className="input input-bordered" value={paidToDate} onChange={(e) => setPaidToDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button
              type="button"
              className="btn btn-primary btn-circle"
              onClick={runPaidPaymentsExport}
              disabled={exportingPaid}
              title="Export paid payments to Excel"
              aria-label="Export paid payments to Excel"
            >
              {exportingPaid ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <ArrowDownTrayIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
