import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import type {
  FreeMeetingParticipant,
  MeetingParticipantsSelection,
} from '../../lib/meetingParticipants';
import { RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE } from '../../lib/recruitmentMeetingParticipants';

type EmployeeOption = {
  id: number;
  display_name: string;
  email: string | null;
  photo_url?: string | null;
};

type FirmContactOption = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type Props = {
  value: MeetingParticipantsSelection;
  onChange: (next: MeetingParticipantsSelection) => void;
  freeDraft: FreeMeetingParticipant;
  onFreeDraftChange: (next: FreeMeetingParticipant) => void;
};

const emptyFree: FreeMeetingParticipant = { name: '', email: '', phone: '', notes: '' };

const MeetingParticipantsPicker: React.FC<Props> = ({
  value,
  onChange,
  freeDraft,
  onFreeDraftChange,
}) => {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [firmContacts, setFirmContacts] = useState<FirmContactOption[]>([]);
  const [staffSearch, setStaffSearch] = useState('');
  const [firmSearch, setFirmSearch] = useState('');
  const [showStaffDropdown, setShowStaffDropdown] = useState(false);
  const [showFirmDropdown, setShowFirmDropdown] = useState(false);
  const staffRef = useRef<HTMLDivElement | null>(null);
  const firmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: empData }, { data: firmData }, { data: usersData }] = await Promise.all([
        supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url')
          .order('display_name')
          .limit(800),
        supabase
          .from('firm_contacts')
          .select('id, name, email, phone, is_active')
          .eq('is_active', true)
          .order('name')
          .limit(500),
        supabase
          .from('users')
          .select('employee_id, email, is_staff, is_active')
          .eq('is_staff', true)
          .eq('is_active', true)
          .not('employee_id', 'is', null)
          .not('email', 'is', null),
      ]);
      if (cancelled) return;

      const emailByEmployee = new Map<number, string>();
      (usersData || []).forEach((u: any) => {
        const eid = Number(u.employee_id);
        if (Number.isFinite(eid) && u.email) emailByEmployee.set(eid, String(u.email));
      });

      setEmployees(
        (empData || [])
          .map((e: any) => ({
            id: Number(e.id),
            display_name: String(e.display_name || `Employee #${e.id}`),
            email: emailByEmployee.get(Number(e.id)) || null,
            photo_url: e.photo_url ?? null,
          }))
          .filter((e) => emailByEmployee.has(e.id))
          .sort((a, b) => a.display_name.localeCompare(b.display_name)),
      );
      setFirmContacts(
        (firmData || []).map((c: any) => ({
          id: String(c.id),
          name: String(c.name || ''),
          email: c.email ?? null,
          phone: c.phone ?? null,
        })),
      );
    })().catch((err) => {
      console.error('MeetingParticipantsPicker load:', err);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (staffRef.current && !staffRef.current.contains(target)) setShowStaffDropdown(false);
      if (firmRef.current && !firmRef.current.contains(target)) setShowFirmDropdown(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return employees.slice(0, 40);
    return employees
      .filter(
        (e) =>
          e.display_name.toLowerCase().includes(q) ||
          (e.email || '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [employees, staffSearch]);

  const filteredFirm = useMemo(() => {
    const q = firmSearch.trim().toLowerCase();
    if (!q) return firmContacts.slice(0, 40);
    return firmContacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [firmContacts, firmSearch]);

  const toggleEmployee = (id: number) => {
    const selected = value.employeeIds.includes(id);
    onChange({
      ...value,
      employeeIds: selected
        ? value.employeeIds.filter((x) => x !== id)
        : [...value.employeeIds, id],
    });
  };

  const toggleFirm = (id: string) => {
    const selected = value.firmContactIds.includes(id);
    onChange({
      ...value,
      firmContactIds: selected
        ? value.firmContactIds.filter((x) => x !== id)
        : [...value.firmContactIds, id],
    });
  };

  const addFreeParticipant = () => {
    const name = freeDraft.name.trim();
    if (!name) {
      toast.error('Extern participant name is required');
      return;
    }
    onChange({
      ...value,
      freeParticipants: [
        ...value.freeParticipants,
        {
          name,
          email: freeDraft.email?.trim() || undefined,
          phone: freeDraft.phone?.trim() || undefined,
          notes: freeDraft.notes?.trim() || undefined,
        },
      ],
    });
    onFreeDraftChange({ ...emptyFree });
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50/70 p-4">
      <div>
        <div className="text-sm font-semibold text-gray-800">Participants / guests</div>
        <p className="mt-0.5 text-xs text-gray-500">
          Same as internal/external meetings — staff, firm contacts, or extern guests.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div ref={staffRef} className="relative">
          <label className="mb-1 block text-sm font-medium text-gray-700">Staff</label>
          <input
            type="text"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            placeholder="Search staff…"
            value={staffSearch}
            onChange={(e) => {
              setStaffSearch(e.target.value);
              setShowStaffDropdown(true);
            }}
            onFocus={() => setShowStaffDropdown(true)}
          />
          {showStaffDropdown ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
              {filteredStaff.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
              ) : (
                filteredStaff.map((emp) => {
                  const selected = value.employeeIds.includes(emp.id);
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                        selected ? 'bg-emerald-50 text-emerald-900' : ''
                      }`}
                      onClick={() => toggleEmployee(emp.id)}
                    >
                      <span className="truncate font-medium">{emp.display_name}</span>
                      <span className="text-xs text-gray-500">{selected ? 'Selected' : ''}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
          {value.employeeIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {value.employeeIds.map((id) => {
                const emp = employees.find((e) => e.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium"
                  >
                    {emp?.display_name || `#${id}`}
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-700"
                      onClick={() => toggleEmployee(id)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>

        <div ref={firmRef} className="relative">
          <label className="mb-1 block text-sm font-medium text-gray-700">Firm contacts</label>
          <input
            type="text"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            placeholder="Search firm contacts…"
            value={firmSearch}
            onChange={(e) => {
              setFirmSearch(e.target.value);
              setShowFirmDropdown(true);
            }}
            onFocus={() => setShowFirmDropdown(true)}
          />
          {showFirmDropdown ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
              {filteredFirm.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
              ) : (
                filteredFirm.map((c) => {
                  const selected = value.firmContactIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                        selected ? 'bg-emerald-50 text-emerald-900' : ''
                      }`}
                      onClick={() => toggleFirm(c.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {c.email || c.phone || ''}
                        </span>
                      </span>
                      <span className="text-xs text-gray-500">{selected ? 'Selected' : ''}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
          {value.firmContactIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {value.firmContactIds.map((id) => {
                const c = firmContacts.find((x) => x.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium"
                  >
                    {c?.name || id}
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-700"
                      onClick={() => toggleFirm(id)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Extern participant</label>
        <div className="grid grid-cols-1 gap-2">
          <input
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            placeholder="Name *"
            value={freeDraft.name}
            onChange={(e) => onFreeDraftChange({ ...freeDraft, name: e.target.value })}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
              placeholder="Email (optional)"
              value={freeDraft.email || ''}
              onChange={(e) => onFreeDraftChange({ ...freeDraft, email: e.target.value })}
            />
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
              placeholder="Phone (optional)"
              value={freeDraft.phone || ''}
              onChange={(e) => onFreeDraftChange({ ...freeDraft, phone: e.target.value })}
            />
          </div>
          <textarea
            className="min-h-[70px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            placeholder="Notes (optional)"
            value={freeDraft.notes || ''}
            onChange={(e) => onFreeDraftChange({ ...freeDraft, notes: e.target.value })}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline w-fit rounded-full"
            onClick={addFreeParticipant}
          >
            Add participant
          </button>
        </div>
        {value.freeParticipants.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {value.freeParticipants.map((p, idx) => (
              <span
                key={`${p.name}-${idx}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  String(p.notes || '').trim() === RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {String(p.notes || '').trim() === RECRUITMENT_CANDIDATE_PARTICIPANT_NOTE
                  ? `Candidate · ${p.name}`
                  : p.name}
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-700"
                  onClick={() =>
                    onChange({
                      ...value,
                      freeParticipants: value.freeParticipants.filter((_, i) => i !== idx),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default MeetingParticipantsPicker;
