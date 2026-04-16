import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  UserIcon,
  UsersIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  StarIcon,
  LinkIcon,
  EnvelopeIcon,
  PhoneIcon,
  GlobeAltIcon,
  IdentificationIcon,
  DocumentTextIcon,
  SignalIcon,
  FunnelIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

type FirmTypeRow = { id: string; code: string | null; label: string | null };

type ChannelRow = { id: string; code: string; label: string };

/** Lightweight source meta kept in state after fetch */
type SourceMeta = { id: string; name: string; channel_id: string | null };

type UserRow = Record<string, any> & {
  id?: string | number;
  email?: string | null;
  auth_id?: string | null;
  extern_firm_id?: string | null;
  extern_source_id?: string | number | null;
  created_at?: string | null;
};

type FirmContactRow = {
  id: string;
  firm_id: string;
  name: string | null;
  email: string | null;
  second_email: string | null;
  phone: string | null;
  user_email: string | null;
  user_id: string | null;
  firm_owner: boolean | null;
  is_active: boolean | null;
  notes: string | null;
  profile_image_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  users?: UserRow | null;
};

type SavedView = {
  id: string;
  user_id: string;
  view_name: string;
  filters: {
    query: string;
    status: string;
    type: string;
  };
  sort_config: {
    key: string;
    dir: string;
  };
  is_default: boolean;
};

type ActivityLog = {
  id: string;
  firm_id: string | null;
  contact_id: string | null;
  action_type: string;
  description: string;
  performed_by_name?: string;
  created_at: string;
};

type FirmRow = {
  id: string;
  name: string;
  firm_type_id: string | null;
  legal_name: string | null;
  vat_number: string | null;
  website: string | null;
  address: string | null;
  contract: string | null;
  invoices: string | null;
  other_docs: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  firm_types?: FirmTypeRow | null;
  firm_contacts?: FirmContactRow[] | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseExternSourceIds(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => parseExternSourceIds(v)).map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') {
    if (value.includes(',')) return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [value.trim()].filter(Boolean);
  }
  try {
    const s = String(value).trim();
    return s ? [s] : [];
  } catch {
    return [];
  }
}

function initialsFromName(name?: string | null) {
  const s = (name || '').trim();
  if (!s) return 'U';
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileAvatar({
  name,
  imageUrl,
  size = 'md',
}: {
  name?: string | null;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials = initialsFromName(name);
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-16 w-16 text-lg' : 'h-11 w-11 text-sm';
  return (
    <div className={`relative shrink-0 ${sizeClass} overflow-hidden rounded-xl border border-base-300 bg-primary/10`}>
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-bold text-primary">
          {initials}
        </div>
      )}
    </div>
  );
}

/** Skeleton loading rows for the firms table */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
      {/* Fake header */}
      <div className="grid grid-cols-5 gap-4 border-b border-base-300 bg-base-200/40 px-4 py-3">
        {['Firm', 'Type', 'VAT', 'Website', 'Contacts'].map((h) => (
          <div key={h} className="h-3 w-20 animate-pulse rounded-full bg-base-300" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-5 gap-4 border-b border-base-300/50 px-4 py-3.5 last:border-0">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 animate-pulse rounded-lg bg-base-300" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-base-300" />
          </div>
          <div className="h-3 w-20 animate-pulse rounded-full bg-base-300 self-center" />
          <div className="h-3 w-16 animate-pulse rounded-full bg-base-300 self-center" />
          <div className="h-3 w-24 animate-pulse rounded-full bg-base-300 self-center" />
          <div className="h-5 w-10 animate-pulse rounded-full bg-base-300 self-center ml-auto" />
        </div>
      ))}
    </div>
  );
}

/** Reusable section header — Stripe-style label */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
      {children}
    </div>
  );
}

/** Reusable detail field block */
function DetailField({ label, value, mono = false }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <SectionLabel>{label}</SectionLabel>
      <div className={`text-sm text-base-content/90 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {value || '—'}
      </div>
    </div>
  );
}

/** Empty state with icon + message */
function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-base-300 bg-base-100 py-16 text-center">
      <BuildingOffice2Icon className="h-10 w-10 text-base-content/20" />
      <div>
        <div className="text-sm font-semibold text-base-content/60">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-base-content/40">{subtitle}</div>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Breadcrumb navigation */
function Breadcrumb({
  items,
}: {
  items: { label: string; onClick?: () => void }[];
}) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-base-content/30" />}
            {isLast ? (
              <span className="font-semibold text-base-content/90 truncate max-w-[16rem]">{item.label}</span>
            ) : (
              <button
                type="button"
                onClick={item.onClick}
                className="text-base-content/50 hover:text-base-content/80 transition-colors duration-150 truncate max-w-[12rem]"
              >
                {item.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function ExternalFirmsReportPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [query, setQuery] = useState('');
  
  // Sorting & Filtering
  const [sortKey, setSortKey] = useState<'name' | 'type' | 'contacts'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  
  const handleSort = (key: 'name' | 'type' | 'contacts') => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  
  // Editing state
  const [editingFirm, setEditingFirm] = useState<FirmRow | null>(null);
  const [editingContact, setEditingContact] = useState<FirmContactRow | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Phase 3 State
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeLogs, setActiveLogs] = useState<ActivityLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const [externSourceNameById, setExternSourceNameById] = useState<Record<string, string>>({});
  const [sourcesById, setSourcesById] = useState<Record<string, SourceMeta>>({});
  const [channelsById, setChannelsById] = useState<Record<string, ChannelRow>>({});

  const fetchData = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const { data, error } = await supabase
        .from('firms')
        .select(
          `
          id,
          name,
          firm_type_id,
          legal_name,
          vat_number,
          website,
          address,
          contract,
          invoices,
          other_docs,
          notes,
          is_active,
          created_at,
          updated_at,
          firm_types:firm_type_id(id, code, label),
          firm_contacts(
            id,
            firm_id,
            name,
            email,
            second_email,
            phone,
            user_email,
            user_id,
            firm_owner,
            is_active,
            notes,
            profile_image_url,
            created_at,
            updated_at,
            users:user_id(*)
          )
        `,
        )
        .order('name', { ascending: true });

      if (error) throw error;
      const nextFirms = (data as any as FirmRow[]) || [];
      setFirms(nextFirms);

      const sourceIds = Array.from(
        new Set(
          nextFirms
            .flatMap((f) => f.firm_contacts || [])
            .flatMap((c) => parseExternSourceIds((c as any).users?.extern_source_id)),
        ),
      );

      if (sourceIds.length > 0) {
        const { data: sourcesData, error: sourcesErr } = await supabase
          .from('misc_leadsource')
          .select('id, name, channel_id')
          .in('id', sourceIds as any);
        if (!sourcesErr && sourcesData) {
          const nameMap: Record<string, string> = {};
          const metaMap: Record<string, SourceMeta> = {};
          const channelUuids = new Set<string>();
          sourcesData.forEach((row: any) => {
            if (row?.id != null) {
              const sid = String(row.id);
              nameMap[sid] = String(row.name || row.id);
              metaMap[sid] = { id: sid, name: String(row.name || row.id), channel_id: row.channel_id ?? null };
              if (row.channel_id) channelUuids.add(row.channel_id);
            }
          });
          setExternSourceNameById(nameMap);
          setSourcesById(metaMap);

          // Fetch channel labels
          if (channelUuids.size > 0) {
            const { data: chData, error: chErr } = await supabase
              .from('channels')
              .select('id, code, label')
              .in('id', Array.from(channelUuids));
            if (!chErr && chData) {
              const chMap: Record<string, ChannelRow> = {};
              chData.forEach((ch: any) => { if (ch?.id) chMap[ch.id] = ch as ChannelRow; });
              setChannelsById(chMap);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  };

  const fetchSavedViews = async () => {
    try {
      const { data, error } = await supabase
        .from('user_saved_views')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSavedViews(data || []);
    } catch (err) {
      console.error('Error fetching views:', err);
    }
  };

  const fetchActivityLogs = async (firmId: string) => {
    setIsLoadingLogs(true);
    try {
      const { data, error } = await supabase
        .from('firm_activity_log')
        .select('*')
        .eq('firm_id', firmId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActiveLogs(data || []);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const logActivity = async (payload: Omit<ActivityLog, 'id' | 'created_at'>) => {
    try {
      await supabase.from('firm_activity_log').insert([payload]);
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSavedViews();
  }, []);

  useEffect(() => {
    if (selectedFirmId) {
      fetchActivityLogs(selectedFirmId);
    }
  }, [selectedFirmId]);

  const availableTypes = useMemo(() => {
    const typesMap = new Map<string, string>();
    firms.forEach(f => {
      if (f.firm_types?.id) typesMap.set(f.firm_types.id, f.firm_types.label || 'Unknown');
    });
    return Array.from(typesMap.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [firms]);

  const filtered = useMemo(() => {
    let result = firms;

    // Apply Faceted Filters
    if (statusFilter !== 'all') {
      const wantActive = statusFilter === 'active';
      result = result.filter(f => f.is_active === wantActive);
    }
    if (typeFilter !== 'all') {
      result = result.filter(f => f.firm_types?.id === typeFilter);
    }

    // Apply Search Query
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((f) => {
        const inFirm =
          f.name?.toLowerCase().includes(q) ||
          (f.legal_name || '').toLowerCase().includes(q) ||
          (f.vat_number || '').toLowerCase().includes(q) ||
          (f.website || '').toLowerCase().includes(q);
        if (inFirm) return true;
        return (f.firm_contacts || []).some((c) => {
          const u = (c as any).users as UserRow | null | undefined;
          return (
            (c.name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.second_email || '').toLowerCase().includes(q) ||
            (c.phone || '').toLowerCase().includes(q) ||
            (c.user_email || '').toLowerCase().includes(q) ||
            (u?.email || '').toLowerCase().includes(q) ||
            (u?.auth_id || '').toLowerCase().includes(q)
          );
        });
      });
    }

    // Apply Sorting
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '');
      } else if (sortKey === 'type') {
        const typeA = a.firm_types?.label || '';
        const typeB = b.firm_types?.label || '';
        cmp = typeA.localeCompare(typeB);
      } else if (sortKey === 'contacts') {
        const countA = a.firm_contacts?.length || 0;
        const countB = b.firm_contacts?.length || 0;
        cmp = countA - countB;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [firms, query, statusFilter, typeFilter, sortKey, sortDir]);

  const stats = useMemo(() => {
    const firmsCount = filtered.length;
    const contactsCount = filtered.reduce((sum, f) => sum + (f.firm_contacts?.length || 0), 0);
    const usersCount = filtered.reduce((sum, f) => {
      const uniq = new Set<string>();
      (f.firm_contacts || []).forEach((c) => {
        const u = (c as any).users as UserRow | null | undefined;
        if (u?.id != null) uniq.add(String(u.id));
      });
      return sum + uniq.size;
    }, 0);
    const firmsWithoutContacts = filtered.filter(f => (f.firm_contacts?.length || 0) === 0).length;
    const inactiveFirms = filtered.filter(f => f.is_active === false).length;
    const firmsMissingData = filtered.filter(f => !f.vat_number || !f.website || !f.firm_types?.id).length;
    return { firmsCount, contactsCount, usersCount, firmsWithoutContacts, inactiveFirms, firmsMissingData };
  }, [filtered]);

  const selectedFirm = useMemo(
    () => (selectedFirmId ? firms.find((f) => f.id === selectedFirmId) || null : null),
    [firms, selectedFirmId],
  );

  const selectedContact = useMemo(() => {
    if (!selectedFirm || !selectedContactId) return null;
    return (selectedFirm.firm_contacts || []).find((c) => c.id === selectedContactId) || null;
  }, [selectedFirm, selectedContactId]);

  const handleUpdateFirm = async (formData: Partial<FirmRow>) => {
    if (!editingFirm) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('firms')
        .update(formData)
        .eq('id', editingFirm.id);

      if (error) throw error;

      // Optimistic Update
      setFirms(prev => prev.map(f => f.id === editingFirm.id ? { ...f, ...formData } : f));
      toast.success('Firm updated successfully');
      setEditingFirm(null);

      // Log Activity
      logActivity({
        firm_id: editingFirm.id,
        contact_id: null,
        action_type: 'UPDATE_FIRM',
        description: `Modified firm details via slide-over.`
      });
      fetchActivityLogs(editingFirm.id);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update firm');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdateContact = async (formData: Partial<FirmContactRow>) => {
    if (!editingContact) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('firm_contacts')
        .update(formData)
        .eq('id', editingContact.id);

      if (error) throw error;

      // Optimistic Update
      setFirms(prev => prev.map(f => {
        if (f.id !== editingContact.firm_id) return f;
        return {
          ...f,
          firm_contacts: (f.firm_contacts || []).map(c => c.id === editingContact.id ? { ...c, ...formData } : c)
        };
      }));
      
      toast.success('Contact updated successfully');
      setEditingContact(null);

      // Log Activity
      logActivity({
        firm_id: editingContact.firm_id,
        contact_id: editingContact.id,
        action_type: 'UPDATE_CONTACT',
        description: `Modified contact ${editingContact.name} via slide-over.`
      });
      if (selectedFirmId) fetchActivityLogs(selectedFirmId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update contact');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveView = async () => {
    const name = window.prompt('Enter a name for this view:');
    if (!name) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return toast.error('Check your login session.');

      const { error } = await supabase.from('user_saved_views').insert([{
        user_id: user.id,
        view_name: name,
        filters: { query, status: statusFilter, type: typeFilter },
        sort_config: { key: sortKey, dir: sortDir }
      }]);

      if (error) throw error;
      toast.success('View saved successfully');
      fetchSavedViews();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save view');
    }
  };

  const applyView = (view: SavedView) => {
    setQuery(view.filters?.query || '');
    setStatusFilter((view.filters?.status as any) || 'all');
    setTypeFilter(view.filters?.type || 'all');
    setSortKey((view.sort_config?.key as any) || 'name');
    setSortDir((view.sort_config?.dir as any) || 'asc');
    toast.success(`Applied view: ${view.view_name}`);
  };

  const view: 'firms' | 'firm' | 'contact' = selectedContactId
    ? 'contact'
    : selectedFirmId
      ? 'firm'
      : 'firms';

  const allSelected = filtered.length > 0 && selectedRowIds.size === filtered.length;
  const someSelected = selectedRowIds.size > 0 && !allSelected;
  
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filtered.map(f => String(f.id))));
    }
  };

  const toggleRowSelect = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const next = new Set(selectedRowIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRowIds(next);
  };

  const handleExportCSV = () => {
    const dataToExport = selectedRowIds.size > 0 
      ? filtered.filter(f => selectedRowIds.has(String(f.id)))
      : filtered;

    if (dataToExport.length === 0) return;

    const rows = [
      ['Firm Name', 'Legal Name', 'Type', 'VAT', 'Website', 'Contacts Count', 'Status'],
      ...dataToExport.map(f => [
        `"${(f.name || '').replace(/"/g, '""')}"`,
        `"${(f.legal_name || '').replace(/"/g, '""')}"`,
        `"${(f.firm_types?.label || '').replace(/"/g, '""')}"`,
        `"${(f.vat_number || '').replace(/"/g, '""')}"`,
        `"${(f.website || '').replace(/"/g, '""')}"`,
        String(f.firm_contacts?.length || 0),
        f.is_active ? 'Active' : 'Inactive'
      ])
    ];

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Firms_Export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${dataToExport.length} firms to CSV`);
  };

  // ── Breadcrumb items by view ──────────────────────────────────────────────
  const breadcrumbItems = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [
      {
        label: 'External Firms',
        onClick:
          view !== 'firms'
            ? () => {
                setSelectedFirmId(null);
                setSelectedContactId(null);
              }
            : undefined,
      },
    ];
    if (selectedFirm) {
      items.push({
        label: selectedFirm.name,
        onClick:
          view === 'contact'
            ? () => setSelectedContactId(null)
            : undefined,
      });
    }
    if (selectedContact) {
      items.push({ label: selectedContact.name || 'Contact' });
    }
    return items;
  }, [view, selectedFirm, selectedContact]);

  // ─────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-base-100 px-4 py-6 md:px-10 md:py-8">
      <div className="mx-auto w-full max-w-6xl space-y-5">

        {/* ── Page Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BuildingOffice2Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-base-content/95">
                  External Firms
                </h1>
                <p className="text-sm text-base-content/45 mt-0.5">
                  Firms, types, contacts, and linked platform users
                </p>
              </div>
            </div>
          </div>
          {/* Top-right actions */}
          <div className="flex items-center gap-2 self-start">
            {view !== 'firms' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-1.5"
                onClick={() => {
                  if (view === 'contact') { setSelectedContactId(null); return; }
                  setSelectedFirmId(null);
                  setSelectedContactId(null);
                }}
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </button>
            )}
            <Link to="/reports" className="btn btn-ghost btn-sm text-base-content/60">
              Reports
            </Link>
          </div>
        </div>

        {/* ── Breadcrumb (sub-views only) ───────────────────────────────── */}
        {view !== 'firms' && (
          <div className="rounded-lg border border-base-300/60 bg-base-200/30 px-3 py-2">
            <Breadcrumb items={breadcrumbItems} />
          </div>
        )}

        {/* ── Toolbar: search + stats (firms list only) ────────────────── */}
        {view === 'firms' && (
          <div className="sticky top-0 z-30 -mx-4 px-4 py-3 md:-mx-10 md:px-10 bg-base-100/95 backdrop-blur flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-base-300/50 shadow-sm md:border-b-0 md:shadow-none">
            {/* Search + Faceted Filters */}
            <div className="flex flex-wrap flex-1 items-center gap-2">
              <label className="flex items-center gap-2.5 rounded-lg border border-base-300 bg-base-100 px-3 py-2 w-full md:max-w-[20rem] focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-150 cursor-text">
                <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-base-content/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="grow bg-transparent text-sm outline-none placeholder:text-base-content/35"
                  placeholder="Search firms, contacts, email, VAT…"
                  spellCheck={false}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-base-content/35 hover:text-base-content/70 transition-colors"
                  >
                    ×
                  </button>
                )}
              </label>

              <select 
                className="select select-bordered border-base-300 bg-base-100 font-medium text-sm h-[42px] min-h-[42px]"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <select 
                className="select select-bordered border-base-300 bg-base-100 font-medium text-sm h-[42px] min-h-[42px]"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All Types</option>
                {availableTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>

              <button 
                className="btn btn-sm btn-outline gap-1.5 h-[42px] min-h-[42px] border-base-300 text-base-content/60 hover:text-primary hover:border-primary px-3"
                onClick={handleSaveView}
              >
                <StarIcon className="h-4 w-4" />
                Save View
              </button>

              {savedViews.length > 0 && (
                <div className="dropdown dropdown-end">
                  <div tabIndex={0} role="button" className="btn btn-sm btn-ghost h-[42px] border border-base-300 px-3 flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-base-content/50">Views</span>
                    <ChevronDownIcon className="h-4 w-4 opacity-50" />
                  </div>
                  <ul tabIndex={0} className="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-box w-52 mt-1 border border-base-300">
                    <li className="menu-title px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-40">Your Presets</li>
                    {savedViews.map(v => (
                      <li key={v.id}>
                        <button 
                          type="button"
                          onClick={() => applyView(v)} 
                          className="flex items-center justify-between text-sm py-2.5 w-full hover:bg-base-200 px-3 rounded-lg"
                        >
                          {v.view_name}
                          {v.is_default && <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded">Default</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right side: stats + refresh */}
            <div className="flex items-center gap-3">
              {/* Compact stat chips */}
              {!loading && (
                <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-base-content/60">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-md bg-base-200 px-3 py-1.5 font-semibold">
                      <BuildingOffice2Icon className="h-4 w-4" />
                      {stats.firmsCount} 
                    </span>
                    <span className="flex items-center gap-1.5 rounded-md bg-base-200 px-3 py-1.5 font-semibold">
                      <UsersIcon className="h-4 w-4" />
                      {stats.contactsCount} 
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {stats.inactiveFirms > 0 && (
                      <span className="flex items-center gap-1.5 rounded-md bg-red-500/10 text-red-600 px-3 py-1.5 font-semibold">
                         <XCircleIcon className="h-4 w-4" />
                         {stats.inactiveFirms} inactive
                      </span>
                    )}
                    {stats.firmsMissingData > 0 && (
                      <span className="flex items-center gap-1.5 rounded-md bg-amber-500/10 text-amber-600 px-3 py-1.5 font-semibold">
                         <ExclamationTriangleIcon className="h-4 w-4" />
                         {stats.firmsMissingData} missing data
                      </span>
                    )}
                  </div>
                </div>
              )}
              <button
                type="button"
                title="Refresh"
                onClick={() => void fetchData(true)}
                disabled={refreshing}
                className="btn btn-ghost btn-sm btn-square text-base-content/50 hover:text-base-content/80"
              >
                <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        )}

        {/* ── Main content area ─────────────────────────────────────────── */}
        <div key={`${view}-${selectedFirmId}-${selectedContactId}`} className="fade-in">
          {loading ? (
            <TableSkeleton rows={7} />
          ) : view === 'firms' ? (
            filtered.length === 0 ? (
              <EmptyState
                title={query ? 'No firms match your search' : 'No firms found'}
                subtitle={query ? 'Try searching by name, email, VAT, or auth ID.' : undefined}
                action={
                  query ? (
                    <button type="button" onClick={() => setQuery('')} className="btn btn-sm btn-outline">
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              // ── Firms table ─────────────────────────────────────────────
              <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b border-base-300 bg-base-200/95 backdrop-blur sticky top-0 z-20">
                      <th 
                        className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider w-[38%] sticky left-0 z-30 bg-base-200/95 shadow-[1px_0_0_0_var(--fallback-b3,oklch(var(--b3)))] cursor-pointer hover:bg-base-300/50 transition-colors select-none group/th"
                        onClick={() => handleSort('name')}
                      >
                        <div className={`flex items-center gap-2.5 ${sortKey === 'name' ? 'text-primary' : 'text-base-content/40 group-hover/th:text-base-content/70'}`}>
                          <div className="flex pl-1" onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              className="checkbox checkbox-sm checkbox-primary rounded transition-all duration-150"
                              checked={allSelected}
                              ref={(input) => { if (input) input.indeterminate = someSelected; }}
                              onChange={toggleSelectAll} 
                            />
                          </div>
                          Firm
                          {sortKey === 'name' ? (sortDir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />) : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-100 transition-opacity" />}
                        </div>
                      </th>
                      <th 
                        className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-base-300/50 transition-colors select-none group/th"
                        onClick={() => handleSort('type')}
                      >
                        <div className={`flex items-center gap-1 ${sortKey === 'type' ? 'text-primary' : 'text-base-content/40 group-hover/th:text-base-content/70'}`}>
                          Type
                          {sortKey === 'type' ? (sortDir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />) : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-100 transition-opacity" />}
                        </div>
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 hidden md:table-cell">VAT</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40 hidden lg:table-cell">Website</th>
                      <th 
                        className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-base-300/50 transition-colors select-none group/th"
                        onClick={() => handleSort('contacts')}
                      >
                        <div className={`flex items-center justify-end gap-1 ${sortKey === 'contacts' ? 'text-primary' : 'text-base-content/40 group-hover/th:text-base-content/70'}`}>
                          {sortKey === 'contacts' ? (sortDir === 'asc' ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />) : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-0 group-hover/th:opacity-100 transition-opacity" />}
                          Contacts
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-300/50">
                    {filtered.map((firm) => {
                      const firmTypeLabel = firm.firm_types?.label || null;
                      const contacts = firm.firm_contacts || [];
                      const isInactive = firm.is_active === false;
                      return (
                        <tr
                          key={firm.id}
                          className="group cursor-pointer transition-colors duration-150 hover:bg-base-200/50"
                          onClick={() => { setSelectedFirmId(firm.id); setSelectedContactId(null); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedFirmId(firm.id);
                              setSelectedContactId(null);
                            }
                          }}
                        >
                          <td className="px-5 py-3 sticky left-0 z-10 bg-base-100 group-hover:bg-base-200/50 transition-colors duration-150 shadow-[1px_0_0_0_var(--fallback-b3,oklch(var(--b3)))]">
                            <div className="flex items-center gap-3">
                              <div className="flex pl-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <input 
                                  type="checkbox" 
                                  className="checkbox checkbox-sm checkbox-primary rounded transition-all duration-150 border-base-content/20"
                                  checked={selectedRowIds.has(String(firm.id))}
                                  onChange={(e) => toggleRowSelect(String(firm.id), e)} 
                                />
                              </div>
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-bold">
                                {firm.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <span className={`font-semibold truncate block max-w-[18rem] ${isInactive ? 'text-base-content/45 line-through' : 'text-base-content/90'}`}>
                                  {firm.name}
                                </span>
                                {firm.legal_name && firm.legal_name !== firm.name && (
                                  <span className="text-sm text-base-content/40 truncate block">{firm.legal_name}</span>
                                )}
                              </div>
                              {isInactive && (
                                <span className="shrink-0 rounded-md bg-red-500 px-2.5 py-1 text-xs font-semibold text-white">Inactive</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            {firmTypeLabel ? (
                              <span className="rounded-md border border-base-300 bg-base-200/60 px-2.5 py-1 text-sm font-medium text-base-content/65">
                                {firmTypeLabel}
                              </span>
                            ) : (
                              <span className="text-base-content/30">—</span>
                            )}
                          </td>
                          <td className="px-5 py-4 hidden md:table-cell">
                            <span className="font-mono text-sm text-base-content/55">{firm.vat_number || '—'}</span>
                          </td>
                          <td className="px-5 py-4 hidden lg:table-cell max-w-[18rem]">
                            {firm.website ? (
                              <a
                                href={firm.website.startsWith('http') ? firm.website : `https://${firm.website}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="truncate block text-sm text-base-content/55 hover:text-primary transition-colors hover:underline"
                              >
                                {firm.website}
                              </a>
                            ) : (
                              <span className="text-base-content/30">—</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold
                                ${contacts.length > 0 ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/40'}`}>
                                <UsersIcon className="h-3.5 w-3.5" />
                                {contacts.length}
                              </span>
                              <button 
                                type="button" 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingFirm(firm);
                                }} 
                                className="opacity-0 group-hover:opacity-100 p-1 text-base-content/40 hover:text-base-content/80 transition-all duration-150 rounded-md hover:bg-base-300"
                              >
                                <EllipsisHorizontalIcon className="h-5 w-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : view === 'firm' ? (
            // ── Firm detail ──────────────────────────────────────────────
            selectedFirm ? (
              <div className="space-y-4">
                {/* Firm header card */}
                <div className="rounded-xl border border-base-300 bg-base-100 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary text-sm font-bold">
                        {selectedFirm.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-bold text-base-content/95 truncate max-w-[22rem]">
                            {selectedFirm.name}
                          </h2>
                          {selectedFirm.is_active === false ? (
                            <span className="rounded-md bg-red-500 px-3 py-1 text-xs font-semibold text-white">Inactive</span>
                          ) : (
                            <span className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">Active</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-base-content/50">
                          {selectedFirm.firm_types?.label && (
                            <span className="rounded-md border border-base-300 bg-base-200/60 px-2 py-0.5 font-medium">
                              {selectedFirm.firm_types.label}
                            </span>
                          )}
                          {selectedFirm.vat_number && (
                            <span className="font-mono">VAT {selectedFirm.vat_number}</span>
                          )}
                          {selectedFirm.website && (
                            <span className="flex items-center gap-1 text-base-content/40">
                              <GlobeAltIcon className="h-3.5 w-3.5" />
                              {selectedFirm.website}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-xs text-base-content/35">
                          Created {formatDate(selectedFirm.created_at)} · Updated {formatDate(selectedFirm.updated_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contacts section */}
                <div className="rounded-xl border border-base-300 bg-base-100 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-base-300 bg-base-200/30 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <UsersIcon className="h-4 w-4 text-base-content/50" />
                      <span className="text-sm font-semibold text-base-content/80">Contacts</span>
                    </div>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      (selectedFirm.firm_contacts || []).length > 0
                        ? 'bg-primary/8 text-primary'
                        : 'bg-base-200 text-base-content/40'
                    }`}>
                      {(selectedFirm.firm_contacts || []).length}
                    </span>
                  </div>

                  {(selectedFirm.firm_contacts || []).length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-base-content/40">
                      <UsersIcon className="h-5 w-5" />
                      No contacts linked to this firm
                    </div>
                  ) : (
                    <table className="w-full text-base">
                      <thead>
                        <tr className="border-b border-base-300/50">
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 w-[28%]">Contact</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">Email</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden md:table-cell">Phone</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden sm:table-cell">Owner</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35">Status</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-base-content/35 hidden lg:table-cell">Linked user</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-base-300/50">
                        {(selectedFirm.firm_contacts || []).map((c) => {
                          const u = (c as any).users as UserRow | null | undefined;
                          return (
                            <tr
                              key={c.id}
                              className="cursor-pointer transition-colors duration-150 hover:bg-base-200/50"
                              onClick={() => setSelectedContactId(c.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedContactId(c.id); }
                              }}
                            >
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <ProfileAvatar name={c.name} imageUrl={c.profile_image_url} size="sm" />
                                  <span className="font-semibold text-base-content/90 truncate max-w-[12rem]">{c.name || '—'}</span>
                                </div>
                              </td>
                              <td className="px-5 py-4 max-w-[16rem]">
                                <div className="flex flex-col gap-0.5">
                                  {c.email ? (
                                    <a
                                      href={`mailto:${c.email}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="truncate text-base-content/75 hover:text-primary transition-colors hover:underline"
                                    >
                                      {c.email}
                                    </a>
                                  ) : (
                                    <span className="truncate text-base-content/75">—</span>
                                  )}
                                  {c.user_email && (
                                    <span className="truncate text-xs text-base-content/40">
                                      Login:{' '}
                                      <a
                                        href={`mailto:${c.user_email}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="hover:text-primary transition-colors hover:underline"
                                      >
                                        {c.user_email}
                                      </a>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-4 hidden md:table-cell text-base-content/60">
                                {c.phone ? (
                                  <a
                                    href={`tel:${c.phone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="hover:text-primary transition-colors hover:underline"
                                  >
                                    {c.phone}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-5 py-4 hidden sm:table-cell">
                                {c.firm_owner ? (
                                  <span className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white">
                                    Owner
                                  </span>
                                ) : (
                                  <span className="text-sm text-base-content/30">—</span>
                                )}
                              </td>
                              <td className="px-5 py-4">
                                {c.is_active === false ? (
                                  <span className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-semibold text-white">Inactive</span>
                                ) : (
                                  <span className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white">Active</span>
                                )}
                              </td>
                              <td className="px-5 py-4 hidden lg:table-cell">
                                {u?.email ? (
                                  <a 
                                    href={`mailto:${u.email}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1.5 text-sm text-base-content/55 hover:text-primary transition-colors hover:underline"
                                  >
                                    <LinkIcon className="h-3.5 w-3.5" />
                                    {u.email}
                                  </a>
                                ) : c.user_id ? (
                                  <span className="text-sm text-base-content/35 italic">Linked (no email)</span>
                                ) : (
                                  <span className="text-sm text-base-content/25">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState title="Firm not found" subtitle="This firm may have been removed." />
            )
          ) : (
            // ── Contact detail ───────────────────────────────────────────
            selectedFirm && selectedContact ? (() => {
              const linkedUser = (selectedContact as any).users as UserRow | null | undefined;
              const userPhoto = (linkedUser as any)?.photo_url || (linkedUser as any)?.photo || selectedContact.profile_image_url || null;
              // Resolve sources for this contact from the globally-fetched sourcesById
              const externSourceIds = parseExternSourceIds(linkedUser?.extern_source_id);
              // Group sources by channel
              const channelGroups: { channel: ChannelRow | null; sources: SourceMeta[] }[] = [];
              const seenChannels: Record<string, number> = {}; // channel uuid | '__none__' → index in channelGroups
              externSourceIds.forEach((sid) => {
                const meta = sourcesById[sid] ?? { id: sid, name: externSourceNameById[sid] ?? sid, channel_id: null };
                const key = meta.channel_id ?? '__none__';
                if (seenChannels[key] == null) {
                  seenChannels[key] = channelGroups.length;
                  channelGroups.push({
                    channel: meta.channel_id ? (channelsById[meta.channel_id] ?? null) : null,
                    sources: [],
                  });
                }
                channelGroups[seenChannels[key]].sources.push(meta);
              });

              return (
                <div className="space-y-4">
                  {/* Contact hero card */}
                  <div className="rounded-xl border border-base-300 bg-base-100 p-5">
                    <div className="flex items-start gap-4">
                      <ProfileAvatar name={selectedContact.name} imageUrl={userPhoto ? String(userPhoto) : null} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-2xl font-bold text-base-content/95">{selectedContact.name || 'Contact'}</h2>
                          {selectedContact.is_active === false ? (
                            <span className="rounded-md bg-red-500 px-3 py-1 text-xs font-semibold text-white">Inactive</span>
                          ) : (
                            <span className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">Active</span>
                          )}
                          {selectedContact.firm_owner && (
                            <span className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white">Owner</span>
                          )}
                          {linkedUser && (
                            <span className="rounded-md border border-base-300 bg-base-200 px-3 py-1 text-xs font-semibold text-base-content/65">Linked user</span>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-base-content/45">
                          {selectedFirm.name}
                          {selectedFirm.firm_types?.label && ` · ${selectedFirm.firm_types.label}`}
                        </div>
                        <div className="mt-2 text-xs text-base-content/35">
                          Created {formatDate(selectedContact.created_at)} · Updated {formatDate(selectedContact.updated_at)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detail grid */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    {/* Contact info */}
                    <div className="lg:col-span-2 rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300/50">
                      <div className="flex items-center gap-2 px-5 py-3.5 bg-base-200/30">
                        <IdentificationIcon className="h-4 w-4 text-base-content/40" />
                        <span className="text-base font-semibold text-base-content/75">Contact info</span>
                      </div>
                      <div className="px-5 py-4 space-y-4">
                        <div className="flex items-start gap-3">
                          <EnvelopeIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                          <div className="min-w-0">
                            <SectionLabel>Email</SectionLabel>
                            <div className="mt-0.5 text-base font-medium text-base-content/85 break-all">
                              {selectedContact.email ? (
                                <a href={`mailto:${selectedContact.email}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.email}
                                </a>
                              ) : (
                                '—'
                              )}
                            </div>
                            {selectedContact.second_email && (
                              <div className="mt-0.5 text-xs text-base-content/45 break-all">
                                <a href={`mailto:${selectedContact.second_email}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.second_email}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <PhoneIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                          <div>
                            <SectionLabel>Phone</SectionLabel>
                            <div className="mt-0.5 text-sm font-medium text-base-content/85">
                              {selectedContact.phone ? (
                                <a href={`tel:${selectedContact.phone}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.phone}
                                </a>
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <EnvelopeIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                          <div>
                            <SectionLabel>Login email</SectionLabel>
                            <div className="mt-0.5 text-sm font-medium text-base-content/85 break-all">
                              {selectedContact.user_email ? (
                                <a href={`mailto:${selectedContact.user_email}`} className="hover:text-primary transition-colors hover:underline">
                                  {selectedContact.user_email}
                                </a>
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>
                        </div>
                        {selectedContact.notes && (
                          <div className="flex items-start gap-3">
                            <DocumentTextIcon className="h-4 w-4 mt-0.5 shrink-0 text-base-content/35" />
                            <div>
                              <SectionLabel>Notes</SectionLabel>
                              <div className="mt-0.5 text-sm text-base-content/75 whitespace-pre-wrap">{selectedContact.notes}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sources & Channels panel */}
                    <div className="lg:col-span-3 rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300/50">
                      <div className="flex items-center gap-2 px-5 py-3 bg-base-200/30">
                        <SignalIcon className="h-4 w-4 text-base-content/40" />
                        <span className="text-sm font-semibold text-base-content/75">Sources & Channels</span>
                        {externSourceIds.length > 0 && (
                          <span className="ml-auto rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            {externSourceIds.length} source{externSourceIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {externSourceIds.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                          <FunnelIcon className="h-6 w-6 text-base-content/20" />
                          <div className="text-sm text-base-content/40">No sources linked</div>
                          <div className="text-xs text-base-content/30">This contact has no lead sources assigned</div>
                        </div>
                      ) : (
                        <div className="divide-y divide-base-300/50">
                          {channelGroups.map((group, gi) => (
                            <div key={group.channel?.id ?? `__none__${gi}`} className="px-5 py-4">
                              {/* Channel header */}
                              <div className="flex items-center gap-2 mb-2.5">
                                <SignalIcon className="h-3.5 w-3.5 text-base-content/35" />
                                {group.channel ? (
                                  <>
                                    <span className="text-xs font-semibold text-base-content/70">{group.channel.label}</span>
                                    <span className="rounded border border-base-300 bg-base-200/60 px-1.5 py-0.5 text-[10px] font-mono text-base-content/40">
                                      {group.channel.code}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-xs font-semibold text-base-content/40 italic">No channel</span>
                                )}
                              </div>
                              {/* Source chips under this channel */}
                              <div className="flex flex-wrap gap-1.5 pl-5">
                                {group.sources.map((src) => (
                                  <span
                                    key={src.id}
                                    className="inline-flex items-center gap-1 rounded-md border border-base-300/70 bg-base-100 px-2 py-1 text-[11px] font-medium text-base-content/70 hover:border-primary/30 hover:bg-primary/5 transition-colors duration-150"
                                  >
                                    <FunnelIcon className="h-3 w-3 text-base-content/35" />
                                    {src.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Firm context strip */}
                  <div className="rounded-xl border border-base-300 bg-base-100 px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BuildingOffice2Icon className="h-4 w-4 text-base-content/40" />
                      <span className="text-sm font-semibold text-base-content/75">Firm context</span>
                      {selectedFirm.firm_types?.label && (
                        <span className="ml-auto rounded-md border border-base-300 bg-base-200/60 px-2 py-0.5 text-xs font-medium text-base-content/55">
                          {selectedFirm.firm_types.label}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
                      <DetailField label="Firm name" value={selectedFirm.name} />
                      <DetailField label="VAT" value={selectedFirm.vat_number} mono />
                      <DetailField 
                        label="Website" 
                        value={
                          selectedFirm.website ? (
                            <a
                              href={selectedFirm.website.startsWith('http') ? selectedFirm.website : `https://${selectedFirm.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-primary transition-colors hover:underline"
                            >
                              {selectedFirm.website}
                            </a>
                          ) : null
                        } 
                      />
                      <DetailField label="Address" value={selectedFirm.address} />
                    </div>
                  </div>

                  {/* Activity Timeline */}
                  <div className="rounded-xl border border-base-300 bg-base-100 overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 bg-base-200/30 border-b border-base-300/50">
                      <ArrowPathIcon className="h-4 w-4 text-base-content/40" />
                      <span className="text-sm font-semibold text-base-content/75">Activity Timeline</span>
                    </div>
                    <div className="p-6">
                      {isLoadingLogs ? (
                        <div className="flex items-center justify-center py-10">
                          <span className="loading loading-spinner text-primary" />
                        </div>
                      ) : activeLogs.length === 0 ? (
                        <div className="text-center py-10 space-y-2">
                          <p className="text-sm text-base-content/40">No activity recorded yet.</p>
                        </div>
                      ) : (
                        <div className="relative border-l-2 border-base-300 ml-3 space-y-8 pb-4">
                          {activeLogs.map((item) => {
                            const isFirmUpdate = item.action_type === 'UPDATE_FIRM';
                            return (
                              <div key={item.id} className="relative pl-8">
                                <span className={`absolute -left-[11px] top-0 flex h-5 w-5 items-center justify-center rounded-full ${isFirmUpdate ? 'bg-primary' : 'bg-blue-500'} text-white ring-4 ring-base-100`}>
                                  {isFirmUpdate ? <ArrowPathIcon className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                                </span>
                                <div>
                                  <div className="flex items-center justify-between text-sm">
                                    <p className="font-bold text-base-content/80">{item.action_type.replace(/_/g, ' ')}</p>
                                    <span className="text-xs text-base-content/40">
                                      {new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                    </span>
                                  </div>
                                  <p className="text-xs text-base-content/50 mt-1">{item.description}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      
                      {activeLogs.length > 0 && (
                        <div className="mt-2 text-center">
                          <button className="text-xs font-bold text-primary hover:underline" onClick={() => toast.success('Showing recent activity.')}>
                            View full audit log
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })() : (
              <EmptyState title="Contact not found" subtitle="This contact may have been removed." />
            )
          )}
        </div>

        {/* Floating Action Bar */}
        {selectedRowIds.size > 0 && view === 'firms' && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-xl bg-base-content px-5 py-3 text-base-100 shadow-2xl transition-all duration-300 transform animate-in slide-in-from-bottom-5">
            <div className="flex items-center gap-3 border-r border-base-100/20 pr-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-base-100/20 text-xs font-bold font-mono">
                {selectedRowIds.size}
              </span>
              <span className="text-sm font-medium">selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                type="button" 
                onClick={handleExportCSV}
                className="btn btn-sm hover:bg-base-100/20 text-base-100 border-none bg-transparent transition-colors shadow-none"
              >
                Export CSV
              </button>
              <button 
                type="button"
                onClick={() => setSelectedRowIds(new Set())}
                className="btn btn-sm hover:bg-base-100/20 text-base-100/60 border-none bg-transparent transition-colors px-2 shadow-none"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Firm Edit Slide-over */}
        {editingFirm && (
          <div className="fixed inset-0 z-[100] overflow-hidden">
            <div 
              className="absolute inset-0 bg-base-content/20 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-300" 
              onClick={() => !isUpdating && setEditingFirm(null)} 
            />
            <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
              <div className="w-screen max-w-md transform transition-transform animate-in slide-in-from-right duration-300 ease-in-out bg-base-100 shadow-2xl">
                <div className="flex h-full flex-col divide-y divide-base-300">
                  <div className="flex items-center justify-between px-6 py-5 bg-base-200/50">
                    <div>
                      <h2 className="text-lg font-bold text-base-content">Edit Firm</h2>
                      <p className="text-xs text-base-content/50 uppercase tracking-widest font-semibold mt-0.5">Firm ID: {editingFirm.id.slice(0,8)}…</p>
                    </div>
                    <button 
                      onClick={() => setEditingFirm(null)}
                      className="rounded-md p-1 text-base-content/40 hover:text-base-content/80 hover:bg-base-300 transition-all"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-8">
                    <form 
                      id="edit-firm-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const updates = {
                          name: String(formData.get('name')),
                          legal_name: String(formData.get('legal_name')),
                          vat_number: String(formData.get('vat_number')),
                          website: String(formData.get('website')),
                          address: String(formData.get('address')),
                          notes: String(formData.get('notes')),
                          firm_type_id: String(formData.get('firm_type_id')),
                          is_active: formData.get('is_active') === 'on'
                        };
                        await handleUpdateFirm(updates);
                      }}
                      className="space-y-6"
                    >
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Firm Name</label>
                        <input name="name" defaultValue={editingFirm.name || ''} className="input input-bordered w-full bg-base-100" required />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Legal Name</label>
                        <input name="legal_name" defaultValue={editingFirm.legal_name || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">VAT Number</label>
                          <input name="vat_number" defaultValue={editingFirm.vat_number || ''} className="input input-bordered w-full font-mono bg-base-100" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Firm Type</label>
                          <select name="firm_type_id" defaultValue={editingFirm.firm_type_id || ''} className="select select-bordered w-full bg-base-100">
                            <option value="">Select Type</option>
                            {availableTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Website URL</label>
                        <input name="website" defaultValue={editingFirm.website || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Office Address</label>
                        <textarea name="address" defaultValue={editingFirm.address || ''} className="textarea textarea-bordered w-full bg-base-100 h-20" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Internal Notes</label>
                        <textarea name="notes" defaultValue={editingFirm.notes || ''} className="textarea textarea-bordered w-full bg-base-100 h-24" />
                      </div>
                      <div className="flex items-center gap-3 pt-2">
                        <input type="checkbox" name="is_active" defaultChecked={editingFirm.is_active ?? undefined} className="checkbox checkbox-primary rounded" />
                        <span className="text-sm font-semibold text-base-content/75">Firm is currently active</span>
                      </div>
                    </form>
                  </div>

                  <div className="px-6 py-5 bg-base-50/50 flex items-center justify-end gap-3">
                    <button 
                      type="button" 
                      onClick={() => setEditingFirm(null)} 
                      disabled={isUpdating}
                      className="btn btn-ghost"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      form="edit-firm-form"
                      disabled={isUpdating}
                      className="btn btn-primary px-8"
                    >
                      {isUpdating ? <span className="loading loading-spinner loading-sm" /> : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Contact Edit Slide-over */}
        {editingContact && (
          <div className="fixed inset-0 z-[100] overflow-hidden">
            <div 
              className="absolute inset-0 bg-base-content/20 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-300" 
              onClick={() => !isUpdating && setEditingContact(null)} 
            />
            <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
              <div className="w-screen max-w-md transform transition-transform animate-in slide-in-from-right duration-300 ease-in-out bg-base-100 shadow-2xl">
                <div className="flex h-full flex-col divide-y divide-base-300">
                  <div className="flex items-center justify-between px-6 py-5 bg-base-200/50">
                    <div>
                      <h2 className="text-lg font-bold text-base-content">Edit Contact</h2>
                      <p className="text-xs text-base-content/50 uppercase tracking-widest font-semibold mt-0.5">{editingContact.name}</p>
                    </div>
                    <button 
                      onClick={() => setEditingContact(null)}
                      className="rounded-md p-1 text-base-content/40 hover:text-base-content/80 hover:bg-base-300 transition-all"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-8">
                    <form 
                      id="edit-contact-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        const updates = {
                          name: String(formData.get('name')),
                          email: String(formData.get('email')),
                          second_email: String(formData.get('second_email')),
                          phone: String(formData.get('phone')),
                          user_email: String(formData.get('user_email')),
                          notes: String(formData.get('notes')),
                        };
                        await handleUpdateContact(updates);
                      }}
                      className="space-y-6"
                    >
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Full Name</label>
                        <input name="name" defaultValue={editingContact.name || ''} className="input input-bordered w-full bg-base-100" required />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Primary Email</label>
                          <input name="email" type="email" defaultValue={editingContact.email || ''} className="input input-bordered w-full bg-base-100" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Second Email</label>
                          <input name="second_email" type="email" defaultValue={editingContact.second_email || ''} className="input input-bordered w-full bg-base-100" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Phone Number</label>
                        <input name="phone" defaultValue={editingContact.phone || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">User Login Email</label>
                        <input name="user_email" defaultValue={editingContact.user_email || ''} className="input input-bordered w-full bg-base-100" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-base-content/40 ml-1">Private Notes</label>
                        <textarea name="notes" defaultValue={editingContact.notes || ''} className="textarea textarea-bordered w-full bg-base-100 h-32" />
                      </div>
                    </form>
                  </div>

                  <div className="px-6 py-5 bg-base-50/50 flex items-center justify-end gap-3">
                    <button 
                      type="button" 
                      onClick={() => setEditingContact(null)} 
                      disabled={isUpdating}
                      className="btn btn-ghost"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      form="edit-contact-form"
                      disabled={isUpdating}
                      className="btn btn-primary px-8"
                    >
                      {isUpdating ? <span className="loading loading-spinner loading-sm" /> : 'Save Contact'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
