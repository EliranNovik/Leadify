import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowPathIcon,
  BellAlertIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  Cog6ToothIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import {
  buildPublicBookingUrl,
  staffGetMeetingBookingGlobalSettings,
  staffListMeetingBookingLinks,
  staffUpsertMeetingBookingGlobalSettings,
  type CategoryAvailabilityRule,
  type MeetingBookingGlobalSettings,
  type MeetingBookingLinkRow,
} from '../../lib/clientBookingApi';
import BookingUnavailableCalendar from './BookingUnavailableCalendar';

const DAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

type SectionId = 'general' | 'availability' | 'closed-dates' | 'notifications' | 'links';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'general', label: 'General', description: 'Page, host & scheduling limits', icon: Cog6ToothIcon },
  { id: 'availability', label: 'Availability', description: 'Hours, days & categories', icon: ClockIcon },
  { id: 'closed-dates', label: 'Closed dates', description: 'Holidays & office closure', icon: CalendarDaysIcon },
  { id: 'notifications', label: 'Notifications', description: 'Email, WhatsApp & calendar', icon: BellAlertIcon },
  { id: 'links', label: 'Booking links', description: 'Generated client links', icon: LinkIcon },
];

const defaultForm: Partial<MeetingBookingGlobalSettings> = {
  title: 'Schedule a meeting',
  description: '',
  duration_minutes: 30,
  calendar_type: 'potential_client',
  buffer_minutes: 0,
  min_notice_hours: 24,
  max_days_ahead: 60,
  slot_interval_minutes: 1,
  business_hours_start: '09:00',
  business_hours_end: '21:00',
  days_of_week: [0, 1, 2, 3, 4],
  send_email: true,
  send_whatsapp: true,
  send_calendar_invite: true,
  timezone: 'Asia/Jerusalem',
  category_availability_rules: [],
  unavailable_dates: [],
};

type MainCategory = { id: number; name: string };

function newRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRules(rules: CategoryAvailabilityRule[] | undefined): CategoryAvailabilityRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule) => ({
    id: rule.id || newRuleId(),
    main_category_ids: Array.isArray(rule.main_category_ids)
      ? rule.main_category_ids.map(Number).filter(Number.isFinite)
      : [],
    business_hours_start: String(rule.business_hours_start || '09:00').substring(0, 5),
    business_hours_end: String(rule.business_hours_end || '21:00').substring(0, 5),
    days_of_week: Array.isArray(rule.days_of_week) ? [...rule.days_of_week].sort() : [0, 1, 2, 3, 4],
    max_meetings_per_hour:
      rule.max_meetings_per_hour != null && Number(rule.max_meetings_per_hour) >= 1
        ? Math.floor(Number(rule.max_meetings_per_hour))
        : null,
  }));
}

function normalizeUnavailableDates(dates: string[] | undefined): string[] {
  if (!Array.isArray(dates)) return [];
  return [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
      {children}
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <SectionLabel>{label}</SectionLabel>
      {children}
      {hint ? <p className="text-sm leading-relaxed text-base-content/50">{hint}</p> : null}
    </div>
  );
}

const FIELD_INPUT =
  'input input-bordered w-full min-h-[44px] rounded-xl border-gray-200 bg-white text-base text-base-content/90 shadow-sm transition-shadow focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10';
const FIELD_SELECT =
  'select select-bordered w-full min-h-[44px] rounded-xl border-gray-200 bg-white text-base shadow-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10';
const FIELD_TEXTAREA =
  'textarea textarea-bordered w-full min-h-[7rem] rounded-xl border-gray-200 bg-white text-base leading-relaxed shadow-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10';

function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight text-base-content/90">{title}</h3>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-base-content/55">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="space-y-5 p-6">{children}</div>
    </div>
  );
}

function formatRuleCategorySummary(
  rule: CategoryAvailabilityRule,
  categories: MainCategory[],
): string {
  const names = rule.main_category_ids
    .map((id) => categories.find((c) => c.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return 'No categories';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function formatRuleDaysSummary(days: number[]): string {
  const labels = [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_OPTIONS.find((o) => o.value === d)?.label)
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) return 'No days';
  if (labels.length === 7) return 'Every day';
  return labels.join(', ');
}

function CategoryRuleCard({
  rule,
  mainCategories,
  usedCategoryIds,
  expanded,
  onToggleExpand,
  onRemove,
  onToggleCategory,
  onUpdate,
  onToggleDay,
}: {
  rule: CategoryAvailabilityRule;
  mainCategories: MainCategory[];
  usedCategoryIds: Set<number>;
  expanded: boolean;
  onToggleExpand: () => void;
  onRemove: () => void;
  onToggleCategory: (categoryId: number) => void;
  onUpdate: (patch: Partial<CategoryAvailabilityRule>) => void;
  onToggleDay: (day: number) => void;
}) {
  const categorySummary = formatRuleCategorySummary(rule, mainCategories);
  const capLabel =
    rule.max_meetings_per_hour != null && rule.max_meetings_per_hour >= 1
      ? ` · max ${rule.max_meetings_per_hour}/hr`
      : '';
  const scheduleSummary = `${rule.business_hours_start}–${rule.business_hours_end} · ${formatRuleDaysSummary(rule.days_of_week || [])}${capLabel}`;

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left sm:gap-3"
          onClick={onToggleExpand}
          aria-expanded={expanded}
        >
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 text-base-content/40 transition-transform sm:h-5 sm:w-5 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-base-content/90">{categorySummary}</p>
            <p className="truncate text-xs text-base-content/50">{scheduleSummary}</p>
          </div>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square shrink-0 text-error"
          aria-label="Remove rule"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      {expanded ? (
        <div className="space-y-5 border-t border-gray-100 p-4 sm:p-5">
          <div>
            <SectionLabel>Main categories</SectionLabel>
            <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {mainCategories.map((cat) => {
                const selected = rule.main_category_ids.includes(cat.id);
                const usedElsewhere = usedCategoryIds.has(cat.id) && !selected;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    disabled={usedElsewhere}
                    title={usedElsewhere ? 'Already in another rule' : undefined}
                    className={`min-h-[34px] rounded-full px-3 text-sm ${
                      selected
                        ? 'btn btn-sm btn-primary'
                        : usedElsewhere
                          ? 'btn btn-sm btn-disabled'
                          : 'btn btn-sm btn-outline border-gray-200 bg-white'
                    }`}
                    onClick={() => onToggleCategory(cat.id)}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Hours start">
              <input
                type="time"
                className={FIELD_INPUT}
                value={rule.business_hours_start}
                onChange={(e) => onUpdate({ business_hours_start: e.target.value })}
              />
            </FormField>
            <FormField label="Last bookable time">
              <input
                type="time"
                className={FIELD_INPUT}
                value={rule.business_hours_end}
                onChange={(e) => onUpdate({ business_hours_end: e.target.value })}
              />
            </FormField>
            <FormField
              label="Max meetings per hour"
              hint="Per day, for all selected categories combined in the same clock hour (e.g. 10:00–10:59). Leave empty for no limit."
            >
              <input
                type="number"
                min={1}
                step={1}
                className={FIELD_INPUT}
                placeholder="No limit"
                value={rule.max_meetings_per_hour ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  onUpdate({
                    max_meetings_per_hour: raw === '' ? null : Math.max(1, Math.floor(Number(raw))),
                  });
                }}
              />
            </FormField>
          </div>

          <div>
            <SectionLabel>Available days</SectionLabel>
            <div className="mt-3 flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`min-h-[36px] rounded-full px-4 ${
                    (rule.days_of_week || []).includes(d.value)
                      ? 'btn btn-sm btn-primary'
                      : 'btn btn-sm btn-outline border-gray-200 bg-white'
                  }`}
                  onClick={() => onToggleDay(d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MeetingBookingManager: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<MeetingBookingGlobalSettings>>(defaultForm);
  const [employees, setEmployees] = useState<Array<{ id: number; display_name?: string | null }>>([]);
  const [mainCategories, setMainCategories] = useState<MainCategory[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [links, setLinks] = useState<MeetingBookingLinkRow[]>([]);
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(() => new Set());

  const activeMeta = SECTIONS.find((s) => s.id === activeSection)!;
  const settingsSection = activeSection !== 'links';

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const result = await staffGetMeetingBookingGlobalSettings();
      if (result.settings) {
        const settings = result.settings;
        setForm({
          ...defaultForm,
          ...settings,
          business_hours_start: String(settings.business_hours_start || '09:00').substring(0, 5),
          business_hours_end: String(settings.business_hours_end || '21:00').substring(0, 5),
          category_availability_rules: normalizeRules(settings.category_availability_rules),
          unavailable_dates: normalizeUnavailableDates(settings.unavailable_dates),
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase
      .from('tenants_employee')
      .select('id, display_name')
      .eq('is_active', true)
      .order('display_name');
    setEmployees(data || []);
  }, []);

  const loadMainCategories = useCallback(async () => {
    const { data } = await supabase
      .from('misc_maincategory')
      .select('id, name')
      .order('name');
    setMainCategories((data || []) as MainCategory[]);
  }, []);

  const loadLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const result = await staffListMeetingBookingLinks();
      setLinks(result.links || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load links');
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadEmployees();
    void loadMainCategories();
    void loadLinks();
  }, [loadSettings, loadEmployees, loadMainCategories, loadLinks]);

  const usedCategoryIds = useMemo(() => {
    const set = new Set<number>();
    for (const rule of form.category_availability_rules || []) {
      for (const id of rule.main_category_ids) set.add(id);
    }
    return set;
  }, [form.category_availability_rules]);

  const handleSave = async () => {
    const rules = normalizeRules(form.category_availability_rules);
    const duplicateCheck = new Set<number>();
    for (const rule of rules) {
      if (rule.main_category_ids.length === 0) {
        toast.error('Each category rule must include at least one main category');
        return;
      }
      for (const id of rule.main_category_ids) {
        if (duplicateCheck.has(id)) {
          toast.error('A main category can only appear in one availability rule');
          return;
        }
        duplicateCheck.add(id);
      }
      if (
        rule.max_meetings_per_hour != null &&
        (!Number.isFinite(rule.max_meetings_per_hour) || rule.max_meetings_per_hour < 1)
      ) {
        toast.error('Max meetings per hour must be at least 1, or left empty for no limit');
        return;
      }
    }

    setSaving(true);
    try {
      const result = await staffUpsertMeetingBookingGlobalSettings({
        ...form,
        business_hours_start: form.business_hours_start || '09:00',
        business_hours_end: form.business_hours_end || '21:00',
        category_availability_rules: rules.map(({ id, ...rule }) => rule),
        unavailable_dates: normalizeUnavailableDates(form.unavailable_dates),
      });
      setForm({
        ...defaultForm,
        ...result.settings,
        business_hours_start: String(result.settings.business_hours_start || '09:00').substring(0, 5),
        business_hours_end: String(result.settings.business_hours_end || '21:00').substring(0, 5),
        category_availability_rules: normalizeRules(result.settings.category_availability_rules),
        unavailable_dates: normalizeUnavailableDates(result.settings.unavailable_dates),
      });
      toast.success('Settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildPublicBookingUrl(token));
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const update = <K extends keyof MeetingBookingGlobalSettings>(
    key: K,
    value: MeetingBookingGlobalSettings[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleDay = (day: number) => {
    const current = form.days_of_week || [];
    update(
      'days_of_week',
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  };

  const addCategoryRule = () => {
    const rules = normalizeRules(form.category_availability_rules);
    const newId = newRuleId();
    update('category_availability_rules', [
      ...rules,
      {
        id: newId,
        main_category_ids: [],
        business_hours_start: form.business_hours_start || '09:00',
        business_hours_end: form.business_hours_end || '21:00',
        days_of_week: [...(form.days_of_week || [0, 1, 2, 3, 4])],
      },
    ]);
    setExpandedRuleIds((prev) => new Set([...prev, newId]));
  };

  const updateCategoryRule = (ruleId: string, patch: Partial<CategoryAvailabilityRule>) => {
    const rules = normalizeRules(form.category_availability_rules).map((rule) =>
      rule.id === ruleId ? { ...rule, ...patch } : rule,
    );
    update('category_availability_rules', rules);
  };

  const removeCategoryRule = (ruleId: string) => {
    update(
      'category_availability_rules',
      normalizeRules(form.category_availability_rules).filter((rule) => rule.id !== ruleId),
    );
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      next.delete(ruleId);
      return next;
    });
  };

  const toggleRuleExpanded = (ruleId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const toggleRuleCategory = (ruleId: string, categoryId: number) => {
    const rules = normalizeRules(form.category_availability_rules);
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    const ids = rule.main_category_ids.includes(categoryId)
      ? rule.main_category_ids.filter((id) => id !== categoryId)
      : [...rule.main_category_ids, categoryId].sort((a, b) => a - b);
    updateCategoryRule(ruleId, { main_category_ids: ids });
  };

  const toggleRuleDay = (ruleId: string, day: number) => {
    const rule = normalizeRules(form.category_availability_rules).find((r) => r.id === ruleId);
    if (!rule) return;
    const current = rule.days_of_week || [];
    const days = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    updateCategoryRule(ruleId, { days_of_week: days });
  };

  if (loading) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  const tabBase =
    'inline-flex shrink-0 items-center gap-2.5 rounded-full px-5 py-3 text-base font-medium transition-colors whitespace-nowrap';
  const tabActive = `${tabBase} bg-primary text-primary-content shadow-sm`;
  const tabIdle = `${tabBase} border border-gray-200 bg-white text-base-content/70 hover:bg-gray-50`;

  return (
    <div className="meeting-booking-manager space-y-6 md:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarDaysIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-base-content/95">Meeting Booking</h1>
            <p className="mt-0.5 text-sm text-base-content/55 md:text-base">
              Configure self-scheduling for client booking links
            </p>
          </div>
        </div>
        {settingsSection ? (
          <button
            type="button"
            className="btn btn-primary min-h-[42px] shrink-0 rounded-full px-6 shadow-sm"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline min-h-[42px] shrink-0 gap-2 rounded-full border-gray-200 bg-white px-5 shadow-sm"
            disabled={linksLoading}
            onClick={() => void loadLinks()}
          >
            <ArrowPathIcon className={`h-5 w-5 ${linksLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      <nav className="-mx-1 overflow-x-auto px-1 pb-1" aria-label="Meeting booking sections">
        <div className="flex min-w-max items-center gap-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={isActive ? tabActive : tabIdle}
                onClick={() => setActiveSection(section.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className={`h-6 w-6 shrink-0 ${isActive ? 'text-primary-content' : 'text-base-content/45'}`} />
                <span>{section.label}</span>
                {section.id === 'links' && links.length > 0 ? (
                  <span
                    className={`badge badge-sm border-none ${
                      isActive ? 'bg-white/20 text-primary-content' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {links.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-base-content/90">{activeMeta.label}</h2>
          <p className="mt-1 text-sm text-base-content/55 md:text-base">{activeMeta.description}</p>
        </div>

        {activeSection === 'general' ? (
          <div className="space-y-6">
            <SectionCard title="Booking page" description="What clients see on the public scheduling page.">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FormField label="Page title">
                    <input
                      className={FIELD_INPUT}
                      value={form.title || ''}
                      onChange={(e) => update('title', e.target.value)}
                    />
                  </FormField>
                </div>
                <div className="sm:col-span-2">
                  <FormField label="Description">
                    <textarea
                      className={FIELD_TEXTAREA}
                      rows={3}
                      value={form.description || ''}
                      onChange={(e) => update('description', e.target.value)}
                    />
                  </FormField>
                </div>
                <FormField label="Duration (minutes)">
                  <input
                    type="number"
                    min={15}
                    step={15}
                    className={FIELD_INPUT}
                    value={form.duration_minutes ?? 30}
                    onChange={(e) => update('duration_minutes', Number(e.target.value))}
                  />
                </FormField>
                <FormField label="Timezone">
                  <input
                    className={FIELD_INPUT}
                    value={form.timezone || 'Asia/Jerusalem'}
                    onChange={(e) => update('timezone', e.target.value)}
                  />
                </FormField>
              </div>
            </SectionCard>

            <SectionCard title="Host & calendar" description="Who hosts meetings and which shared calendar is used.">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Meeting manager">
                  <select
                    className={FIELD_SELECT}
                    value={form.meeting_manager || ''}
                    onChange={(e) => {
                      const name = e.target.value;
                      const emp = employees.find((x) => x.display_name === name);
                      update('meeting_manager', name);
                      if (emp) update('host_employee_id', emp.id);
                    }}
                  >
                    <option value="">— Select —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.display_name || ''}>{emp.display_name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Calendar type">
                  <select
                    className={FIELD_SELECT}
                    value={form.calendar_type || 'potential_client'}
                    onChange={(e) =>
                      update('calendar_type', e.target.value as 'potential_client' | 'active_client')
                    }
                  >
                    <option value="potential_client">Potential client</option>
                    <option value="active_client">Active client</option>
                  </select>
                </FormField>
              </div>
            </SectionCard>

            <SectionCard title="Scheduling limits">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Min notice (hours)">
                  <input
                    type="number"
                    min={0}
                    className={FIELD_INPUT}
                    value={form.min_notice_hours ?? 24}
                    onChange={(e) => update('min_notice_hours', Number(e.target.value))}
                  />
                </FormField>
                <FormField label="Book up to (days ahead)">
                  <input
                    type="number"
                    min={1}
                    className={FIELD_INPUT}
                    value={form.max_days_ahead ?? 60}
                    onChange={(e) => update('max_days_ahead', Number(e.target.value))}
                  />
                </FormField>
                <FormField label="Buffer (minutes)">
                  <input
                    type="number"
                    min={0}
                    className={FIELD_INPUT}
                    value={form.buffer_minutes ?? 0}
                    onChange={(e) => update('buffer_minutes', Number(e.target.value))}
                  />
                </FormField>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeSection === 'availability' ? (
          <div className="space-y-6">
            <SectionCard
              title="Default availability"
              description="Used when the lead's main category has no specific rule."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Hours start">
                  <input
                    type="time"
                    className={FIELD_INPUT}
                    value={form.business_hours_start || '09:00'}
                    onChange={(e) => update('business_hours_start', e.target.value)}
                  />
                </FormField>
                <FormField label="Last bookable time">
                  <input
                    type="time"
                    className={FIELD_INPUT}
                    value={form.business_hours_end || '21:00'}
                    onChange={(e) => update('business_hours_end', e.target.value)}
                  />
                </FormField>
              </div>
              <div>
                <SectionLabel>Available days</SectionLabel>
                <div className="mt-3 flex flex-wrap gap-2">
                  {DAY_OPTIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={`min-h-[36px] rounded-full px-4 ${
                        (form.days_of_week || []).includes(d.value)
                          ? 'btn btn-sm btn-primary'
                          : 'btn btn-sm btn-outline border-gray-200'
                      }`}
                      onClick={() => toggleDay(d.value)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </SectionCard>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-base-content/90">By main category</h3>
                <p className="mt-1 text-sm text-base-content/55">
                  Override hours and days for selected main categories.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline min-h-[40px] gap-2 rounded-full border-gray-200 bg-white px-5 shadow-sm"
                onClick={addCategoryRule}
              >
                <PlusIcon className="h-5 w-5" />
                Add rule
              </button>
            </div>

            {(form.category_availability_rules || []).length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-300 bg-white/50 px-6 py-12 text-center text-base text-base-content/55">
                No category rules — all leads use the default availability above.
              </p>
            ) : (
              <div className="space-y-2">
                {normalizeRules(form.category_availability_rules).map((rule) => (
                  <CategoryRuleCard
                    key={rule.id}
                    rule={rule}
                    mainCategories={mainCategories}
                    usedCategoryIds={usedCategoryIds}
                    expanded={expandedRuleIds.has(rule.id!)}
                    onToggleExpand={() => toggleRuleExpanded(rule.id!)}
                    onRemove={() => removeCategoryRule(rule.id!)}
                    onToggleCategory={(categoryId) => toggleRuleCategory(rule.id!, categoryId)}
                    onUpdate={(patch) => updateCategoryRule(rule.id!, patch)}
                    onToggleDay={(day) => toggleRuleDay(rule.id!, day)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {activeSection === 'closed-dates' ? (
          <SectionCard
            title="Office closed dates"
            description="Israel calendar dates blocked on the public booking page (holidays, team events)."
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <BookingUnavailableCalendar
                compact
                selectedDates={form.unavailable_dates || []}
                onChange={(dates) => update('unavailable_dates', dates)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-base leading-relaxed text-base-content/55">
                  Click dates on the mini calendar to toggle them as unavailable. Clients will not be able
                  to select those days when booking.
                </p>
                {(form.unavailable_dates || []).length > 0 ? (
                  <p className="mt-4 text-sm font-semibold text-base-content/75">
                    {(form.unavailable_dates || []).length} closed date
                    {(form.unavailable_dates || []).length === 1 ? '' : 's'} selected
                  </p>
                ) : null}
              </div>
            </div>
          </SectionCard>
        ) : null}

        {activeSection === 'notifications' ? (
          <SectionCard title="Client confirmations" description="Sent automatically after a client books.">
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-100 px-5 py-4 transition-colors hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={form.send_email !== false}
                  onChange={(e) => update('send_email', e.target.checked)}
                />
                <span>
                  <span className="block text-base font-semibold text-base-content/90">Email confirmation</span>
                  <span className="text-sm text-base-content/55">Send booking details to the contact&apos;s email</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-100 px-5 py-4 transition-colors hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={form.send_whatsapp !== false}
                  onChange={(e) => update('send_whatsapp', e.target.checked)}
                />
                <span>
                  <span className="block text-base font-semibold text-base-content/90">WhatsApp confirmation</span>
                  <span className="text-sm text-base-content/55">Send template message when a mobile number is on file</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-100 px-5 py-4 transition-colors hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={form.send_calendar_invite !== false}
                  onChange={(e) => update('send_calendar_invite', e.target.checked)}
                />
                <span>
                  <span className="block text-base font-semibold text-base-content/90">Outlook calendar invite</span>
                  <span className="text-sm text-base-content/55">For contacts with Microsoft email addresses</span>
                </span>
              </label>
            </div>
          </SectionCard>
        ) : null}

        {activeSection === 'links' ? (
          <>
            {linksLoading ? (
              <div className="flex justify-center py-16">
                <span className="loading loading-spinner loading-lg text-primary" />
              </div>
            ) : links.length === 0 ? (
              <div className="rounded-[2rem] border border-dashed border-gray-300 bg-white/50 px-6 py-16 text-center">
                <LinkIcon className="mx-auto mb-4 h-12 w-12 text-base-content/20" />
                <p className="text-base font-semibold text-base-content/60">No booking links generated yet.</p>
                <p className="mt-2 text-sm text-base-content/45">
                  Enable booking on a lead&apos;s meeting tab to create a link.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {links.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-col gap-4 rounded-[2rem] border border-gray-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:gap-6 sm:px-6 sm:py-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-base font-bold text-base-content/90">
                          {row.lead_number ? `#${row.lead_number}` : row.lead_id || '—'}
                        </span>
                        {row.enabled ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-0.5 text-sm font-semibold text-emerald-700">
                            Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-0.5 text-sm font-medium text-base-content/55">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-lg font-semibold text-base-content/90" title={row.lead_name || undefined}>
                        {row.lead_name || '—'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-base-content/50">
                        <span>
                          <span className="font-medium text-base-content/40">Updated </span>
                          {formatDate(row.updated_at)}
                        </span>
                        <span>
                          <span className="font-medium text-base-content/40">Created </span>
                          {formatDate(row.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        className="btn btn-ghost min-h-[40px] gap-1.5 rounded-full border border-gray-200 bg-gray-50/80 px-4"
                        onClick={() => void copyLink(row.booking_token)}
                      >
                        <ClipboardDocumentIcon className="h-4 w-4" />
                        Copy
                      </button>
                      <a
                        href={buildPublicBookingUrl(row.booking_token)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost min-h-[40px] rounded-full border border-gray-200 bg-gray-50/80 px-4"
                      >
                        Preview
                      </a>
                      {row.lead_number ? (
                        <a
                          href={`/clients/${encodeURIComponent(
                            row.lead_type === 'legacy' ? `legacy_${row.lead_id}` : row.lead_id || '',
                          )}?tab=meeting`}
                          className="btn btn-primary min-h-[40px] rounded-full px-5"
                        >
                          Open
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};

export default MeetingBookingManager;
