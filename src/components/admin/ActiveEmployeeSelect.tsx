import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchActiveStaffEmployees,
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
  type ActiveStaffEmployee,
} from '../../lib/employeeSalaries';

type ActiveEmployeeSelectProps = {
  value: unknown;
  onChange: (value: number | '') => void;
  readOnly?: boolean;
};

export const EmployeeAvatarLabel: React.FC<{
  employee: ActiveStaffEmployee;
  size?: 'sm' | 'md';
}> = ({ employee, size = 'md' }) => {
  const [imgErr, setImgErr] = useState(false);
  const url = employee.photo_url?.trim() || '';
  const showPhoto = url.length > 0 && !imgErr;
  const dim = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-[11px]';

  return (
    <div className="flex items-center gap-2 min-w-0">
      {showPhoto ? (
        <img
          src={url}
          alt=""
          className={`${dim} shrink-0 rounded-full object-cover ring-2 ring-base-100 dark:ring-base-300/60`}
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className={`${dim} shrink-0 flex items-center justify-center rounded-full font-bold text-white ring-2 ring-base-100 dark:ring-base-300/60`}
          style={salaryAvatarGradientStyle(employee.id, employee.display_name)}
          aria-hidden
        >
          {getSalaryEmployeeInitials(employee.display_name)}
        </span>
      )}
      <span className="truncate">{employee.display_name}</span>
    </div>
  );
};

const ActiveEmployeeSelect: React.FC<ActiveEmployeeSelectProps> = ({ value, onChange, readOnly }) => {
  const [employees, setEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchActiveStaffEmployees()
      .then(data => {
        if (!cancelled) setEmployees(data);
      })
      .catch(err => {
        console.error('Failed to load active employees:', err);
        if (!cancelled) setEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => employees.find(e => String(e.id) === String(value ?? '')),
    [employees, value],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter(e => e.display_name.toLowerCase().includes(term));
  }, [employees, search]);

  if (readOnly) {
    return selected ? <EmployeeAvatarLabel employee={selected} /> : <span>—</span>;
  }

  return (
    <div className="relative">
      {selected && !open && search === '' ? (
        <div
          className="input input-bordered w-full flex items-center gap-2 pr-10 cursor-text min-h-[3rem]"
          onClick={() => {
            setOpen(true);
            setSearch('');
          }}
        >
          <EmployeeAvatarLabel employee={selected} size="sm" />
        </div>
      ) : (
        <input
          type="text"
          className="input input-bordered w-full pr-10 text-gray-900 admin-drawer-input"
          placeholder={loading ? 'Loading employees…' : 'Search active employees…'}
          value={search}
          disabled={loading}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => {
            setSearch(e.target.value);
            if (!e.target.value) onChange('');
          }}
          style={{ color: '#111827', WebkitTextFillColor: '#111827' } as React.CSSProperties}
        />
      )}
      {value && !readOnly && (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          onClick={() => {
            onChange('');
            setSearch('');
          }}
          aria-label="Clear employee"
        >
          ×
        </button>
      )}
      {open && !loading && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-60 overflow-auto">
          {filtered.map(emp => (
            <button
              key={emp.id}
              type="button"
              className={`w-full px-3 py-2.5 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0 ${
                String(emp.id) === String(value) ? 'bg-primary/10' : ''
              }`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange(emp.id);
                setSearch('');
                setOpen(false);
              }}
            >
              <EmployeeAvatarLabel employee={emp} size="sm" />
            </button>
          ))}
        </div>
      )}
      {open && !loading && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 shadow-lg">
          No active employees match your search.
        </div>
      )}
    </div>
  );
};

export default ActiveEmployeeSelect;
