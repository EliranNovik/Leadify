import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  CakeIcon,
  CloudIcon,
  ComputerDesktopIcon,
  MegaphoneIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  createEntryKioskAnnouncement,
  createEntryKioskGadget,
  deleteEntryKioskAnnouncement,
  deleteEntryKioskGadget,
  fetchEntryKioskAnnouncements,
  fetchEntryKioskGadgets,
  fetchEntryKioskSettings,
  saveEntryKioskSettings,
  updateEntryKioskAnnouncement,
  updateEntryKioskGadget,
  type EntryKioskAnnouncement,
  type EntryKioskGadget,
  type EntryKioskSettings,
} from '../../lib/entryKioskHr';
import {
  cancelKioskDisplaySession,
  listKioskDevices,
  pairKioskDevice,
  updateKioskDevice,
  type KioskDevice,
} from '../../lib/kioskDisplayApi';

type ToggleKey =
  | 'show_clock_date'
  | 'show_weather'
  | 'show_meetings_today'
  | 'show_birthdays'
  | 'show_announcements'
  | 'show_gadgets';

const TOGGLE_OPTIONS: Array<{ key: ToggleKey; label: string; hint: string }> = [
  { key: 'show_clock_date', label: 'Clock & date', hint: 'Header time and date on the kiosk' },
  { key: 'show_weather', label: 'Weather', hint: 'Current weather for the configured city' },
  { key: 'show_meetings_today', label: 'Meetings today', hint: 'Scheduled client meetings for today' },
  { key: 'show_birthdays', label: 'Employee birthdays', hint: 'Staff birthdays today (set on employee profile)' },
  { key: 'show_announcements', label: 'Announcements', hint: 'Messages you add below' },
  { key: 'show_gadgets', label: 'Gadgets & extras', hint: 'Custom info cards on the kiosk' },
];

const emptyAnnouncement = (): Omit<EntryKioskAnnouncement, 'id' | 'location_id' | 'created_at'> => ({
  title: '',
  body: '',
  sort_order: 0,
  start_date: null,
  end_date: null,
  is_active: true,
});

const emptyGadget = (): Omit<EntryKioskGadget, 'id' | 'location_id' | 'created_at'> => ({
  label: '',
  body: '',
  icon_key: 'sparkles',
  sort_order: 0,
  is_active: true,
});

export default function HrEntryKioskPanel() {
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settings, setSettings] = useState<EntryKioskSettings | null>(null);
  const [announcements, setAnnouncements] = useState<EntryKioskAnnouncement[]>([]);
  const [gadgets, setGadgets] = useState<EntryKioskGadget[]>([]);
  const [announcementForm, setAnnouncementForm] = useState(emptyAnnouncement);
  const [gadgetForm, setGadgetForm] = useState(emptyGadget);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<number | null>(null);
  const [editingGadgetId, setEditingGadgetId] = useState<number | null>(null);
  const [kioskDevices, setKioskDevices] = useState<KioskDevice[]>([]);
  const [kioskDevicesLoading, setKioskDevicesLoading] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingName, setPairingName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairedTokenHint, setPairedTokenHint] = useState<string | null>(null);

  const loadKioskDevices = useCallback(async () => {
    setKioskDevicesLoading(true);
    try {
      const result = await listKioskDevices();
      if (!result.success) throw new Error(result.error || 'Failed to load kiosks');
      setKioskDevices(result.devices || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load kiosks');
    } finally {
      setKioskDevicesLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRow, announcementRows, gadgetRows] = await Promise.all([
        fetchEntryKioskSettings(),
        fetchEntryKioskAnnouncements(),
        fetchEntryKioskGadgets(),
      ]);
      setSettings(settingsRow);
      setAnnouncements(announcementRows);
      setGadgets(gadgetRows);
      await loadKioskDevices();
    } catch (err) {
      console.error('HrEntryKioskPanel load:', err);
      toast.error('Failed to load entry kiosk settings');
    } finally {
      setLoading(false);
    }
  }, [loadKioskDevices]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const persistSettings = async (patch: Partial<EntryKioskSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSettings(true);
    try {
      await saveEntryKioskSettings(patch);
      toast.success('Kiosk settings saved');
    } catch (err) {
      console.error('HrEntryKioskPanel settings:', err);
      setSettings(settings);
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleToggle = (key: ToggleKey) => {
    if (!settings) return;
    void persistSettings({ [key]: !settings[key] });
  };

  const resetAnnouncementForm = () => {
    setAnnouncementForm(emptyAnnouncement());
    setEditingAnnouncementId(null);
  };

  const resetGadgetForm = () => {
    setGadgetForm(emptyGadget());
    setEditingGadgetId(null);
  };

  const handleSaveAnnouncement = async () => {
    if (!announcementForm.body.trim()) {
      toast.error('Announcement body is required');
      return;
    }
    try {
      if (editingAnnouncementId) {
        await updateEntryKioskAnnouncement(editingAnnouncementId, announcementForm);
        toast.success('Announcement updated');
      } else {
        await createEntryKioskAnnouncement(announcementForm);
        toast.success('Announcement added');
      }
      resetAnnouncementForm();
      await loadAll();
    } catch (err) {
      console.error('HrEntryKioskPanel announcement:', err);
      toast.error('Failed to save announcement');
    }
  };

  const handleSaveGadget = async () => {
    if (!gadgetForm.label.trim()) {
      toast.error('Gadget label is required');
      return;
    }
    try {
      if (editingGadgetId) {
        await updateEntryKioskGadget(editingGadgetId, gadgetForm);
        toast.success('Gadget updated');
      } else {
        await createEntryKioskGadget(gadgetForm);
        toast.success('Gadget added');
      }
      resetGadgetForm();
      await loadAll();
    } catch (err) {
      console.error('HrEntryKioskPanel gadget:', err);
      toast.error('Failed to save gadget');
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="loading loading-spinner loading-lg text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Entry kiosk</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure the office tablet display at{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">/entry-kiosk</code>.
          </p>
        </div>
        <a
          href="/entry-kiosk"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm rounded-full border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
        >
          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          Open kiosk preview
        </a>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 md:p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">Display settings</h3>
        <p className="mt-1 text-sm text-gray-500">Turn widgets on or off on the kiosk screen.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {TOGGLE_OPTIONS.map((opt) => (
            <label
              key={opt.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
            >
              <input
                type="checkbox"
                className="toggle toggle-success mt-0.5"
                checked={Boolean(settings[opt.key])}
                disabled={savingSettings}
                onChange={() => handleToggle(opt.key)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="form-control">
            <span className="label-text font-medium text-gray-700">Office label</span>
            <input
              type="text"
              className="input input-bordered rounded-xl"
              value={settings.office_label}
              disabled={savingSettings}
              onChange={(e) => setSettings({ ...settings, office_label: e.target.value })}
              onBlur={() => {
                if (settings.office_label.trim()) {
                  void persistSettings({ office_label: settings.office_label.trim() });
                }
              }}
            />
          </label>
          <label className="form-control">
            <span className="label-text font-medium text-gray-700">Weather city</span>
            <input
              type="text"
              className="input input-bordered rounded-xl"
              value={settings.weather_city}
              disabled={savingSettings || !settings.show_weather}
              onChange={(e) => setSettings({ ...settings, weather_city: e.target.value })}
              onBlur={() => {
                if (settings.weather_city.trim()) {
                  void persistSettings({ weather_city: settings.weather_city.trim() });
                }
              }}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <MegaphoneIcon className="h-5 w-5 text-emerald-600" />
          <h3 className="text-lg font-semibold text-gray-900">Announcements</h3>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="form-control md:col-span-2">
            <span className="label-text">Title (optional)</span>
            <input
              type="text"
              className="input input-bordered rounded-xl"
              value={announcementForm.title || ''}
              onChange={(e) => setAnnouncementForm((p) => ({ ...p, title: e.target.value }))}
            />
          </label>
          <label className="form-control md:col-span-2">
            <span className="label-text">Message</span>
            <textarea
              className="textarea textarea-bordered min-h-[88px] rounded-xl"
              value={announcementForm.body}
              onChange={(e) => setAnnouncementForm((p) => ({ ...p, body: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text">Start date</span>
            <input
              type="date"
              className="input input-bordered rounded-xl"
              value={announcementForm.start_date || ''}
              onChange={(e) =>
                setAnnouncementForm((p) => ({ ...p, start_date: e.target.value || null }))
              }
            />
          </label>
          <label className="form-control">
            <span className="label-text">End date</span>
            <input
              type="date"
              className="input input-bordered rounded-xl"
              value={announcementForm.end_date || ''}
              onChange={(e) =>
                setAnnouncementForm((p) => ({ ...p, end_date: e.target.value || null }))
              }
            />
          </label>
          <label className="form-control">
            <span className="label-text">Sort order</span>
            <input
              type="number"
              className="input input-bordered rounded-xl"
              value={announcementForm.sort_order}
              onChange={(e) =>
                setAnnouncementForm((p) => ({ ...p, sort_order: Number(e.target.value) || 0 }))
              }
            />
          </label>
          <label className="form-control justify-end">
            <span className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-success"
                checked={announcementForm.is_active}
                onChange={(e) =>
                  setAnnouncementForm((p) => ({ ...p, is_active: e.target.checked }))
                }
              />
              <span className="label-text">Active</span>
            </span>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm rounded-full bg-emerald-600 text-white" onClick={() => void handleSaveAnnouncement()}>
            {editingAnnouncementId ? 'Update announcement' : 'Add announcement'}
          </button>
          {editingAnnouncementId ? (
            <button type="button" className="btn btn-sm btn-ghost rounded-full" onClick={resetAnnouncementForm}>
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200">
          <table className="table table-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase text-gray-500">
                <th>Title</th>
                <th>Message</th>
                <th>Dates</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {announcements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-gray-500">
                    No announcements yet
                  </td>
                </tr>
              ) : (
                announcements.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="max-w-[10rem] truncate font-medium">{row.title || '—'}</td>
                    <td className="max-w-[16rem] truncate text-sm text-gray-600">{row.body}</td>
                    <td className="whitespace-nowrap text-xs text-gray-500">
                      {row.start_date || '…'} – {row.end_date || '…'}
                    </td>
                    <td>
                      <span className={`badge badge-sm ${row.is_active ? 'badge-success' : 'badge-ghost'}`}>
                        {row.is_active ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => {
                          setEditingAnnouncementId(row.id);
                          setAnnouncementForm({
                            title: row.title,
                            body: row.body,
                            sort_order: row.sort_order,
                            start_date: row.start_date,
                            end_date: row.end_date,
                            is_active: row.is_active,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost text-red-600"
                        onClick={async () => {
                          if (!window.confirm('Remove this announcement?')) return;
                          try {
                            await deleteEntryKioskAnnouncement(row.id);
                            toast.success('Announcement removed');
                            if (editingAnnouncementId === row.id) resetAnnouncementForm();
                            await loadAll();
                          } catch {
                            toast.error('Failed to remove announcement');
                          }
                        }}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-semibold text-gray-900">Gadgets & extras</h3>
        </div>
        <p className="mt-1 text-sm text-gray-500">Optional info cards shown on the kiosk when enabled above.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="form-control">
            <span className="label-text">Label</span>
            <input
              type="text"
              className="input input-bordered rounded-xl"
              value={gadgetForm.label}
              onChange={(e) => setGadgetForm((p) => ({ ...p, label: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text">Icon key</span>
            <input
              type="text"
              className="input input-bordered rounded-xl"
              placeholder="sparkles, cloud, cake…"
              value={gadgetForm.icon_key || ''}
              onChange={(e) => setGadgetForm((p) => ({ ...p, icon_key: e.target.value }))}
            />
          </label>
          <label className="form-control md:col-span-2">
            <span className="label-text">Content</span>
            <textarea
              className="textarea textarea-bordered min-h-[72px] rounded-xl"
              value={gadgetForm.body || ''}
              onChange={(e) => setGadgetForm((p) => ({ ...p, body: e.target.value }))}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm rounded-full" onClick={() => void handleSaveGadget()}>
            <PlusIcon className="h-4 w-4" />
            {editingGadgetId ? 'Update gadget' : 'Add gadget'}
          </button>
          {editingGadgetId ? (
            <button type="button" className="btn btn-sm btn-ghost rounded-full" onClick={resetGadgetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>

        <ul className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {gadgets.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-gray-500">No gadgets yet</li>
          ) : (
            gadgets.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{g.label}</p>
                  {g.body ? <p className="text-sm text-gray-500">{g.body}</p> : null}
                  <p className="mt-1 text-xs text-gray-400">
                    {g.is_active ? 'Active' : 'Hidden'} · icon: {g.icon_key || 'default'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => {
                      setEditingGadgetId(g.id);
                      setGadgetForm({
                        label: g.label,
                        body: g.body,
                        icon_key: g.icon_key,
                        sort_order: g.sort_order,
                        is_active: g.is_active,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-red-600"
                    onClick={async () => {
                      if (!window.confirm('Remove this gadget?')) return;
                      try {
                        await deleteEntryKioskGadget(g.id);
                        toast.success('Gadget removed');
                        if (editingGadgetId === g.id) resetGadgetForm();
                        await loadAll();
                      } catch {
                        toast.error('Failed to remove gadget');
                      }
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <ComputerDesktopIcon className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Kiosk devices</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Pair lobby tablets using the 6-digit code shown on the unregistered kiosk screen.
        </p>

        <div className="grid gap-3 sm:grid-cols-[7rem_1fr_auto] items-end">
          <label className="form-control">
            <span className="label-text text-xs font-medium text-gray-600">Pairing code</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input input-bordered input-sm font-mono"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs font-medium text-gray-600">Device name</span>
            <input
              type="text"
              className="input input-bordered input-sm"
              value={pairingName}
              onChange={(e) => setPairingName(e.target.value)}
              placeholder="Ramat Gan lobby"
            />
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm rounded-full"
            disabled={pairing || pairingCode.length < 6 || !pairingName.trim()}
            onClick={async () => {
              setPairing(true);
              setPairedTokenHint(null);
              try {
                const result = await pairKioskDevice({
                  code: pairingCode.trim(),
                  name: pairingName.trim(),
                  locationId: settings?.location_id ?? 1,
                });
                if (!result.success) throw new Error(result.error || 'Pairing failed');
                toast.success(`Paired ${result.device?.name || 'kiosk'}`);
                setPairingCode('');
                setPairingName('');
                if (result.deviceToken) {
                  setPairedTokenHint(
                    'Tablet should register automatically. If not, refresh the kiosk page within a few seconds.',
                  );
                }
                await loadKioskDevices();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Pairing failed');
              } finally {
                setPairing(false);
              }
            }}
          >
            {pairing ? <span className="loading loading-spinner loading-xs" /> : 'Pair device'}
          </button>
        </div>

        {pairedTokenHint ? (
          <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{pairedTokenHint}</p>
        ) : null}

        <ul className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {kioskDevicesLoading ? (
            <li className="px-4 py-6 text-center">
              <span className="loading loading-spinner loading-sm" />
            </li>
          ) : kioskDevices.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-gray-500">No kiosk devices paired yet</li>
          ) : (
            kioskDevices.map((device) => (
              <li key={device.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{device.name}</p>
                  <p className="text-xs text-gray-500">
                    {device.status === 'revoked' ? 'Revoked' : 'Active'}
                    {device.last_seen_at
                      ? ` · last seen ${new Date(device.last_seen_at).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ' · not seen yet'}
                  </p>
                  {device.activeSession ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Showing {device.activeSession.resourceType} until{' '}
                      {new Date(device.activeSession.expiresAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {device.activeSession ? (
                    <button
                      type="button"
                      className="btn btn-xs btn-outline btn-error"
                      onClick={async () => {
                        try {
                          const result = await cancelKioskDisplaySession(device.activeSession!.id);
                          if (!result.success) throw new Error(result.error || 'Failed to stop session');
                          toast.success('Kiosk session stopped');
                          await loadKioskDevices();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Failed to stop session');
                        }
                      }}
                    >
                      Stop session
                    </button>
                  ) : null}
                  {device.status === 'active' ? (
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost text-red-600"
                      onClick={async () => {
                        if (!window.confirm(`Revoke kiosk "${device.name}"?`)) return;
                        try {
                          const result = await updateKioskDevice(device.id, { status: 'revoked' });
                          if (!result.success) throw new Error(result.error || 'Failed to revoke');
                          toast.success('Device revoked');
                          await loadKioskDevices();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Failed to revoke');
                        }
                      }}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-4">
          <span className="inline-flex items-center gap-1.5">
            <CakeIcon className="h-4 w-4 text-pink-500" />
            Set birthdays on each employee&apos;s About tab
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CloudIcon className="h-4 w-4 text-sky-500" />
            Weather uses Open-Meteo (no API key)
          </span>
        </div>
      </section>
    </div>
  );
}
