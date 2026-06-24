import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ClipboardDocumentIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import {
  buildPublicBookingUrl,
  staffGetMeetingBookingGlobalSettings,
  staffListMeetingBookingLinks,
  staffUpsertMeetingBookingGlobalSettings,
  type MeetingBookingGlobalSettings,
  type MeetingBookingLinkRow,
} from '../../lib/clientBookingApi';

const DAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const defaultForm: Partial<MeetingBookingGlobalSettings> = {
  title: 'Schedule a meeting',
  description: '',
  duration_minutes: 30,
  calendar_type: 'potential_client',
  buffer_minutes: 0,
  min_notice_hours: 24,
  max_days_ahead: 60,
  slot_interval_minutes: 30,
  business_hours_start: '09:00',
  business_hours_end: '21:00',
  days_of_week: [0, 1, 2, 3, 4],
  send_email: true,
  send_whatsapp: true,
  send_calendar_invite: true,
  timezone: 'Asia/Jerusalem',
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const MeetingBookingManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<MeetingBookingGlobalSettings>>(defaultForm);
  const [employees, setEmployees] = useState<Array<{ id: number; display_name?: string | null }>>([]);

  const [linksLoading, setLinksLoading] = useState(true);
  const [links, setLinks] = useState<MeetingBookingLinkRow[]>([]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const result = await staffGetMeetingBookingGlobalSettings();
      if (result.settings) {
        setForm({ ...defaultForm, ...result.settings });
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
    void loadLinks();
  }, [loadSettings, loadEmployees, loadLinks]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await staffUpsertMeetingBookingGlobalSettings({
        ...form,
        business_hours_start: '09:00',
        business_hours_end: '21:00',
      });
      setForm({ ...defaultForm, ...result.settings });
      toast.success('Global booking settings saved');
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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CalendarDaysIcon className="h-7 w-7 text-primary" />
          Meeting Booking Manager
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Global defaults for all client self-scheduling links. Per-lead links only control enable/disable.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-6 space-y-5">
          <h3 className="text-base font-semibold text-gray-900">Global settings</h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label text-xs font-medium">Page title</label>
              <input
                className="input input-bordered input-sm w-full"
                value={form.title || ''}
                onChange={(e) => update('title', e.target.value)}
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
              <label className="label text-xs font-medium">Slot interval (minutes)</label>
              <input
                type="number"
                min={1}
                className="input input-bordered input-sm w-full"
                value={form.slot_interval_minutes ?? 30}
                onChange={(e) => update('slot_interval_minutes', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label text-xs font-medium">Buffer between meetings (minutes)</label>
              <input
                type="number"
                min={0}
                className="input input-bordered input-sm w-full"
                value={form.buffer_minutes ?? 0}
                onChange={(e) => update('buffer_minutes', Number(e.target.value))}
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

          <div>
            <label className="label text-xs font-medium">Description (shown on booking page)</label>
            <textarea
              className="textarea textarea-bordered w-full text-sm"
              rows={3}
              value={form.description || ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          <div>
            <span className="label text-xs font-medium">Available days</span>
            <div className="flex flex-wrap gap-2 mt-1">
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

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={form.send_email !== false}
                onChange={(e) => update('send_email', e.target.checked)}
              />
              Send email confirmation
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={form.send_whatsapp !== false}
                onChange={(e) => update('send_whatsapp', e.target.checked)}
              />
              Send WhatsApp confirmation
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={form.send_calendar_invite !== false}
                onChange={(e) => update('send_calendar_invite', e.target.checked)}
              />
              Outlook calendar invite (Microsoft emails)
            </label>
          </div>

          <div className="pt-2">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Saving…' : 'Save global settings'}
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-gray-900">Generated booking links</h3>
            <span className="badge badge-ghost badge-sm">{links.length}</span>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm gap-2"
            disabled={linksLoading}
            onClick={() => void loadLinks()}
          >
            <ArrowPathIcon className={`h-4 w-4 ${linksLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {linksLoading ? (
          <div className="flex justify-center py-12">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : links.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white/60 py-12 text-center">
            <LinkIcon className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">No booking links generated yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {links.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-w-0">
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-0.5">Lead</p>
                      <p className="font-mono text-sm font-semibold text-gray-900">
                        {row.lead_number ? `#${row.lead_number}` : row.lead_id || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-0.5">Name</p>
                      <p className="text-sm text-gray-900">{row.lead_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-0.5">Status</p>
                      {row.enabled ? (
                        <span className="badge badge-sm border-none bg-emerald-50 text-emerald-600">
                          Enabled
                        </span>
                      ) : (
                        <span className="badge badge-ghost badge-sm">Disabled</span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-0.5">Updated</p>
                      <p className="text-xs text-gray-600">{formatDate(row.updated_at)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Created {formatDate(row.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm gap-1"
                      onClick={() => void copyLink(row.booking_token)}
                    >
                      <ClipboardDocumentIcon className="h-4 w-4" />
                      Copy
                    </button>
                    <a
                      href={buildPublicBookingUrl(row.booking_token)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                    >
                      Preview
                    </a>
                    {row.lead_number ? (
                      <a
                        href={`/clients/${encodeURIComponent(
                          row.lead_type === 'legacy' ? `legacy_${row.lead_id}` : row.lead_id || '',
                        )}?tab=meeting`}
                        className="btn btn-ghost btn-sm"
                      >
                        Open lead
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingBookingManager;
