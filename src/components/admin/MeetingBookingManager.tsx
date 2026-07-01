import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowPathIcon,
  BellAlertIcon,
  CalendarDaysIcon,
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

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-gray-500">{description}</p> : null}
      </div>
      <div className="p-5 space-y-4">{children}</div>
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
    update('category_availability_rules', [
      ...rules,
      {
        id: newRuleId(),
        main_category_ids: [],
        business_hours_start: form.business_hours_start || '09:00',
        business_hours_end: form.business_hours_end || '21:00',
        days_of_week: [...(form.days_of_week || [0, 1, 2, 3, 4])],
      },
    ]);
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
      <div className="flex justify-center py-16">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[32rem] flex-col gap-4 lg:flex-row lg:gap-6">
      {/* Section nav */}
      <nav className="shrink-0 lg:w-56">
        <div className="mb-4 lg:mb-6">
          <h2 className="text-lg font-bold text-gray-900">Meeting Booking</h2>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed">
            Configure self-scheduling for client booking links.
          </p>
        </div>

        <ul className="menu menu-sm rounded-xl border border-gray-200 bg-white p-2 shadow-sm lg:menu-vertical">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  className={`flex items-start gap-2 rounded-lg py-2.5 ${
                    isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-gray-700'
                  }`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-left">
                    <span className="block text-sm leading-tight">{section.label}</span>
                    <span className="mt-0.5 block text-[10px] font-normal text-base-content/45 leading-snug">
                      {section.description}
                    </span>
                  </span>
                  {section.id === 'links' && links.length > 0 ? (
                    <span className="badge badge-ghost badge-xs ml-auto">{links.length}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{activeMeta.label}</h3>
            <p className="text-sm text-gray-500">{activeMeta.description}</p>
          </div>
          {settingsSection ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-2"
              disabled={linksLoading}
              onClick={() => void loadLinks()}
            >
              <ArrowPathIcon className={`h-4 w-4 ${linksLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>

        {activeSection === 'general' ? (
          <div className="space-y-4">
            <SectionCard title="Booking page" description="What clients see on the public scheduling page.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label text-xs font-medium">Page title</label>
                  <input
                    className="input input-bordered input-sm w-full"
                    value={form.title || ''}
                    onChange={(e) => update('title', e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label text-xs font-medium">Description</label>
                  <textarea
                    className="textarea textarea-bordered w-full text-sm"
                    rows={3}
                    value={form.description || ''}
                    onChange={(e) => update('description', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label text-xs font-medium">Duration (minutes)</label>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    className="input input-bordered input-sm w-full"
                    value={form.duration_minutes ?? 30}
                    onChange={(e) => update('duration_minutes', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label text-xs font-medium">Timezone</label>
                  <input
                    className="input input-bordered input-sm w-full"
                    value={form.timezone || 'Asia/Jerusalem'}
                    onChange={(e) => update('timezone', e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Host & calendar" description="Who hosts meetings and which shared calendar is used.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label text-xs font-medium">Meeting manager</label>
                  <select
                    className="select select-bordered select-sm w-full"
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
                </div>
                <div>
                  <label className="label text-xs font-medium">Calendar type</label>
                  <select
                    className="select select-bordered select-sm w-full"
                    value={form.calendar_type || 'potential_client'}
                    onChange={(e) =>
                      update('calendar_type', e.target.value as 'potential_client' | 'active_client')
                    }
                  >
                    <option value="potential_client">Potential client</option>
                    <option value="active_client">Active client</option>
                  </select>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Scheduling limits">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="label text-xs font-medium">Min notice (hours)</label>
                  <input
                    type="number"
                    min={0}
                    className="input input-bordered input-sm w-full"
                    value={form.min_notice_hours ?? 24}
                    onChange={(e) => update('min_notice_hours', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label text-xs font-medium">Book up to (days ahead)</label>
                  <input
                    type="number"
                    min={1}
                    className="input input-bordered input-sm w-full"
                    value={form.max_days_ahead ?? 60}
                    onChange={(e) => update('max_days_ahead', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label text-xs font-medium">Buffer (minutes)</label>
                  <input
                    type="number"
                    min={0}
                    className="input input-bordered input-sm w-full"
                    value={form.buffer_minutes ?? 0}
                    onChange={(e) => update('buffer_minutes', Number(e.target.value))}
                  />
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeSection === 'availability' ? (
          <div className="space-y-4">
            <SectionCard
              title="Default availability"
              description="Used when the lead's main category has no specific rule."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label text-xs font-medium">Hours start</label>
                  <input
                    type="time"
                    className="input input-bordered input-sm w-full"
                    value={form.business_hours_start || '09:00'}
                    onChange={(e) => update('business_hours_start', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label text-xs font-medium">Last bookable time</label>
                  <input
                    type="time"
                    className="input input-bordered input-sm w-full"
                    value={form.business_hours_end || '21:00'}
                    onChange={(e) => update('business_hours_end', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <span className="label text-xs font-medium">Available days</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {DAY_OPTIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={`btn btn-xs ${(form.days_of_week || []).includes(d.value) ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => toggleDay(d.value)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="By main category"
              description="Override hours and days for selected main categories."
            >
              <div className="flex justify-end">
                <button type="button" className="btn btn-outline btn-sm gap-1" onClick={addCategoryRule}>
                  <PlusIcon className="h-4 w-4" />
                  Add rule
                </button>
              </div>

              {(form.category_availability_rules || []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-8 text-center text-sm text-gray-500">
                  No category rules — all leads use the default availability above.
                </p>
              ) : (
                <div className="space-y-3">
                  {normalizeRules(form.category_availability_rules).map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-lg border border-gray-200 bg-gray-50/40 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800">Category rule</p>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => removeCategoryRule(rule.id!)}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>

                      <div>
                        <span className="label text-xs font-medium">Main categories</span>
                        <div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                          {mainCategories.map((cat) => {
                            const selected = rule.main_category_ids.includes(cat.id);
                            const usedElsewhere = usedCategoryIds.has(cat.id) && !selected;
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                disabled={usedElsewhere}
                                title={usedElsewhere ? 'Already in another rule' : undefined}
                                className={`btn btn-xs ${
                                  selected ? 'btn-primary' : usedElsewhere ? 'btn-disabled' : 'btn-outline'
                                }`}
                                onClick={() => toggleRuleCategory(rule.id!, cat.id)}
                              >
                                {cat.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="label text-xs font-medium">Hours start</label>
                          <input
                            type="time"
                            className="input input-bordered input-sm w-full"
                            value={rule.business_hours_start}
                            onChange={(e) =>
                              updateCategoryRule(rule.id!, { business_hours_start: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="label text-xs font-medium">Last bookable time</label>
                          <input
                            type="time"
                            className="input input-bordered input-sm w-full"
                            value={rule.business_hours_end}
                            onChange={(e) =>
                              updateCategoryRule(rule.id!, { business_hours_end: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <span className="label text-xs font-medium">Available days</span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {DAY_OPTIONS.map((d) => (
                            <button
                              key={d.value}
                              type="button"
                              className={`btn btn-xs ${
                                (rule.days_of_week || []).includes(d.value) ? 'btn-primary' : 'btn-outline'
                              }`}
                              onClick={() => toggleRuleDay(rule.id!, d.value)}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        ) : null}

        {activeSection === 'closed-dates' ? (
          <SectionCard
            title="Office closed dates"
            description="Israel calendar dates blocked on the public booking page (holidays, team events)."
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <BookingUnavailableCalendar
                compact
                selectedDates={form.unavailable_dates || []}
                onChange={(dates) => update('unavailable_dates', dates)}
              />
              <div className="min-w-0 flex-1 text-sm text-gray-600">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Click dates on the mini calendar to toggle them as unavailable. Clients will not be able
                  to select those days when booking.
                </p>
                {(form.unavailable_dates || []).length > 0 ? (
                  <p className="mt-3 text-xs font-medium text-gray-700">
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
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={form.send_email !== false}
                  onChange={(e) => update('send_email', e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">Email confirmation</span>
                  <span className="text-xs text-gray-500">Send booking details to the contact&apos;s email</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={form.send_whatsapp !== false}
                  onChange={(e) => update('send_whatsapp', e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">WhatsApp confirmation</span>
                  <span className="text-xs text-gray-500">Send template message when a mobile number is on file</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50/80">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={form.send_calendar_invite !== false}
                  onChange={(e) => update('send_calendar_invite', e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">Outlook calendar invite</span>
                  <span className="text-xs text-gray-500">For contacts with Microsoft email addresses</span>
                </span>
              </label>
            </div>
          </SectionCard>
        ) : null}

        {activeSection === 'links' ? (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {linksLoading ? (
              <div className="flex justify-center py-16">
                <span className="loading loading-spinner loading-md text-primary" />
              </div>
            ) : links.length === 0 ? (
              <div className="py-16 text-center">
                <LinkIcon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-sm text-gray-500">No booking links generated yet.</p>
                <p className="mt-1 text-xs text-gray-400">Enable booking on a lead&apos;s meeting tab to create a link.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm table-zebra w-full">
                  <thead>
                    <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <th>Lead #</th>
                      <th>Client name</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th>Created</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((row) => (
                      <tr key={row.id} className="text-sm">
                        <td className="font-mono font-medium whitespace-nowrap">
                          {row.lead_number ? `#${row.lead_number}` : row.lead_id || '—'}
                        </td>
                        <td className="max-w-[12rem] truncate" title={row.lead_name || undefined}>
                          {row.lead_name || '—'}
                        </td>
                        <td>
                          {row.enabled ? (
                            <span className="badge badge-sm border-none bg-emerald-50 text-emerald-700">
                              Enabled
                            </span>
                          ) : (
                            <span className="badge badge-ghost badge-sm">Disabled</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-xs text-gray-600">
                          {formatDate(row.updated_at)}
                        </td>
                        <td className="whitespace-nowrap text-xs text-gray-500">
                          {formatDate(row.created_at)}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs gap-1"
                              onClick={() => void copyLink(row.booking_token)}
                            >
                              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                              Copy
                            </button>
                            <a
                              href={buildPublicBookingUrl(row.booking_token)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-ghost btn-xs"
                            >
                              Preview
                            </a>
                            {row.lead_number ? (
                              <a
                                href={`/clients/${encodeURIComponent(
                                  row.lead_type === 'legacy' ? `legacy_${row.lead_id}` : row.lead_id || '',
                                )}?tab=meeting`}
                                className="btn btn-ghost btn-xs"
                              >
                                Open
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default MeetingBookingManager;
