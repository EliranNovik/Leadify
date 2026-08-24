import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, UserIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import {
  fetchActiveStaffEmployees,
  type ActiveStaffEmployee,
} from '../../lib/employeeSalaries';
import type { PipelineViewAs } from '../../lib/resolvePipelineIdentity';

type Props = {
  value: PipelineViewAs | null;
  onChange: (next: PipelineViewAs | null) => void;
};

const PipelineEmployeePicker: React.FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [userByEmployeeId, setUserByEmployeeId] = useState<
    Map<number, { id: string; fullName: string }>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (employees.length > 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await fetchActiveStaffEmployees();
        const ids = list.map((emp) => emp.id);
        const usersResult =
          ids.length > 0
            ? await supabase.from('users').select('id, employee_id, full_name').in('employee_id', ids)
            : { data: [] as Array<{ id: string; employee_id: number; full_name: string | null }> };
        if (cancelled) return;
        const map = new Map<number, { id: string; fullName: string }>();
        (usersResult.data || []).forEach((row) => {
          if (row.employee_id == null) return;
          if (!map.has(Number(row.employee_id))) {
            map.set(Number(row.employee_id), {
              id: String(row.id),
              fullName: String(row.full_name || '').trim(),
            });
          }
        });
        setEmployees(list);
        setUserByEmployeeId(map);
      } catch (err) {
        console.error('Failed to load employees for pipeline picker:', err);
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, employees.length]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((emp) => emp.display_name.toLowerCase().includes(term));
  }, [employees, search]);

  const selectEmployee = (emp: ActiveStaffEmployee) => {
    const user = userByEmployeeId.get(emp.id);
    onChange({
      employeeId: emp.id,
      displayName: emp.display_name,
      fullName: user?.fullName || emp.display_name,
      userId: user?.id || null,
      photoUrl: emp.photo_url,
    });
    setSearch('');
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`btn btn-sm gap-2 ${value ? 'btn-primary' : 'btn-outline'}`}
        onClick={() => setOpen((prev) => !prev)}
        title="View another employee’s pipeline"
      >
        {value?.photoUrl ? (
          <img src={value.photoUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
        ) : (
          <UserIcon className="h-4 w-4" />
        )}
        <span className="max-w-[10rem] truncate">{value ? value.displayName : 'Employee'}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">View employee pipeline</p>
            {value ? (
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1 text-gray-500"
                onClick={() => {
                  onChange(null);
                  setSearch('');
                  setOpen(false);
                }}
              >
                <XMarkIcon className="h-3.5 w-3.5" />
                Me
              </button>
            ) : null}
          </div>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              className="input input-bordered w-full rounded-xl pl-9 text-sm"
              placeholder="Find an employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <span className="loading loading-spinner loading-sm text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-gray-500">No employees match.</p>
            ) : (
              filtered.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-gray-50 ${
                    value?.employeeId === emp.id ? 'bg-primary/10 font-semibold' : 'text-gray-800'
                  }`}
                  onClick={() => selectEmployee(emp)}
                >
                  {emp.photo_url ? (
                    <img src={emp.photo_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
                      {emp.display_name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="truncate">{emp.display_name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PipelineEmployeePicker;
