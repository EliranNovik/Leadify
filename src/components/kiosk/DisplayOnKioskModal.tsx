import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  ComputerDesktopIcon,
  StopCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  cancelKioskDisplaySession,
  createKioskDisplaySession,
  listKioskDevices,
  type KioskDevice,
} from '../../lib/kioskDisplayApi';

export type KioskDisplayResource =
  | { resourceType: 'digital_contract'; resourceId: string }
  | { resourceType: 'poa'; resourceId?: string; resourceToken: string }
  | { resourceType: 'payment'; resourceToken: string; resourceId?: string };

type DisplayOnKioskModalProps = {
  open: boolean;
  onClose: () => void;
  resource: KioskDisplayResource;
  locationId?: number;
  title?: string;
};

const RESOURCE_LABELS: Record<KioskDisplayResource['resourceType'], string> = {
  digital_contract: 'Contract',
  poa: 'POA',
  payment: 'Payment',
};

function formatResourceType(type: string) {
  if (type === 'digital_contract') return 'Contract';
  if (type === 'poa') return 'POA';
  if (type === 'payment') return 'Payment';
  return type;
}

export default function DisplayOnKioskModal({
  open,
  onClose,
  resource,
  locationId = 1,
  title = 'Display on kiosk',
}: DisplayOnKioskModalProps) {
  const [devices, setDevices] = useState<KioskDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const loadDevices = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await listKioskDevices(locationId);
      if (!result.success) throw new Error(result.error || 'Failed to load kiosks');
      setDevices((result.devices || []).filter((d) => d.status === 'active'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load kiosks');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  React.useEffect(() => {
    if (!open) return;
    void loadDevices();
  }, [open, loadDevices]);

  const handlePush = async (device: KioskDevice) => {
    setPushingId(device.id);
    try {
      const payload: Parameters<typeof createKioskDisplaySession>[0] = {
        kioskDeviceId: device.id,
        resourceType: resource.resourceType,
      };
      if (resource.resourceType === 'digital_contract') {
        payload.resourceId = resource.resourceId;
      } else if (resource.resourceType === 'poa') {
        payload.resourceToken = resource.resourceToken;
        if (resource.resourceId) payload.resourceId = resource.resourceId;
      } else {
        payload.resourceToken = resource.resourceToken;
        if (resource.resourceId) payload.resourceId = resource.resourceId;
      }

      const result = await createKioskDisplaySession(payload);
      if (!result.success) throw new Error(result.error || 'Failed to send to kiosk');
      toast.success(`Sent to ${device.name}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send to kiosk');
    } finally {
      setPushingId(null);
    }
  };

  const handleStop = async (device: KioskDevice) => {
    if (!device.activeSession?.id) return;
    setStoppingId(device.id);
    try {
      const result = await cancelKioskDisplaySession(device.activeSession.id);
      if (!result.success) throw new Error(result.error || 'Failed to stop session');
      toast.success(`Stopped session on ${device.name}`);
      void loadDevices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop session');
    } finally {
      setStoppingId(null);
    }
  };

  if (!open) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-lg rounded-2xl border border-slate-200/80 p-0 shadow-2xl shadow-slate-900/10">
        <div className="relative overflow-hidden rounded-t-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 px-6 pb-5 pt-6 text-white">
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-indigo-400/20 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <ComputerDesktopIcon className="h-5 w-5 text-indigo-200" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                Choose a lobby tablet. It will open this {RESOURCE_LABELS[resource.resourceType].toLowerCase()} for
                the client.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              onClick={onClose}
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner loading-md text-indigo-600" />
            </div>
          ) : devices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <ComputerDesktopIcon className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">No active kiosks found</p>
              <p className="mt-1 text-xs text-slate-500">
                Pair a tablet in HR → Entry kiosk → Devices.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {devices.map((device) => {
                const busy = Boolean(device.activeSession);
                const isPushing = pushingId === device.id;
                const isStopping = stoppingId === device.id;

                return (
                  <li
                    key={device.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 transition hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                          busy
                            ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-100'
                            : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100'
                        }`}
                      >
                        <ComputerDesktopIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-slate-900">{device.name}</p>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${
                              busy
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {busy ? 'Busy' : 'Ready'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {busy
                            ? `Showing ${formatResourceType(device.activeSession!.resourceType)}`
                            : device.last_seen_at
                              ? `Last seen ${new Date(device.last_seen_at).toLocaleTimeString('en-GB', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`
                              : 'Not seen yet'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
                      {busy ? (
                        <button
                          type="button"
                          className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-600 shadow-sm transition hover:bg-rose-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                          disabled={isStopping}
                          onClick={() => void handleStop(device)}
                          title="Stop session"
                          aria-label="Stop session"
                        >
                          {isStopping ? (
                            <span className="loading loading-spinner loading-sm" />
                          ) : (
                            <StopCircleIcon className="h-6 w-6" />
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex h-12 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                        disabled={isPushing}
                        onClick={() => void handlePush(device)}
                        title={isPushing ? 'Sending…' : 'Display on kiosk'}
                        aria-label={isPushing ? 'Sending…' : 'Display on kiosk'}
                      >
                        {isPushing ? (
                          <span className="loading loading-spinner loading-sm" />
                        ) : (
                          <ComputerDesktopIcon className="h-5 w-5" />
                        )}
                        {isPushing ? 'Sending…' : 'Display'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
