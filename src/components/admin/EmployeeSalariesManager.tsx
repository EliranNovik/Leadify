import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  SALARY_MONTH_OPTIONS,
  salaryYearOptions,
  fetchActiveStaffSalaryRows,
  saveActiveStaffSalaryRows,
  formatSalaryCurrency,
  getSalaryEmployeeInitials,
  getSalaryRoleDisplayName,
  salaryAvatarGradientStyle,
  type SalaryEntryRow,
} from '../../lib/employeeSalaries';

const SalaryEmployeeAvatar: React.FC<{
  employeeId: number;
  name: string;
  photoUrl: string | null;
}> = ({ employeeId, name, photoUrl }) => {
  const [imgErr, setImgErr] = useState(false);
  const url = photoUrl?.trim() || '';
  const showPhoto = url.length > 0 && !imgErr;
  const initials = getSalaryEmployeeInitials(name);
  const gradientStyle = salaryAvatarGradientStyle(employeeId, name);

  if (showPhoto) {
    return (
      <img
        src={url}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-base-100 dark:ring-base-300/60"
        onError={() => setImgErr(true)}
      />
    );
  }

  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-base-100 dark:ring-base-300/60"
      style={gradientStyle}
      aria-hidden
    >
      {initials}
    </span>
  );
};

type EmployeeSalariesManagerProps = {
  initialYear?: number;
  initialMonth?: number;
};

const EmployeeSalariesManager: React.FC<EmployeeSalariesManagerProps> = ({
  initialYear,
  initialMonth,
}) => {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(initialYear ?? now.getFullYear());

  useEffect(() => {
    if (initialYear != null) setSelectedYear(initialYear);
    if (initialMonth != null && initialMonth >= 1) setSelectedMonth(initialMonth);
  }, [initialYear, initialMonth]);
  const [rows, setRows] = useState<SalaryEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const yearOptions = useMemo(() => salaryYearOptions(), []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchActiveStaffSalaryRows(selectedMonth, selectedYear);
      setRows(data);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load salaries');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const updateRow = useCallback(
    (employeeId: number, field: 'gross_salary' | 'net_salary', value: number | null) => {
      setRows(prev =>
        prev.map(row => (row.employee_id === employeeId ? { ...row, [field]: value } : row)),
      );
    },
    [],
  );

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter(
      r =>
        r.employee_name.toLowerCase().includes(term) ||
        r.department.toLowerCase().includes(term) ||
        getSalaryRoleDisplayName(r.role).toLowerCase().includes(term),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const withSalary = rows.filter(
      r => r.gross_salary > 0 || (r.net_salary != null && r.net_salary !== 0),
    );
    return {
      count: withSalary.length,
      gross: withSalary.reduce((sum, r) => sum + (r.gross_salary || 0), 0),
      net: withSalary.reduce((sum, r) => sum + (r.net_salary || 0), 0),
    };
  }, [rows]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveActiveStaffSalaryRows(rows, selectedMonth, selectedYear);
      toast.success(`Saved ${saved} salary ${saved === 1 ? 'entry' : 'entries'}`);
      await loadRows();
    } catch (e: unknown) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Failed to save salaries';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const periodLabel =
    SALARY_MONTH_OPTIONS.find(m => m.value === selectedMonth)?.label ?? String(selectedMonth);

  return (
    <div className="w-full min-w-0">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-base-content">Salaries</h2>
        <p className="text-base-content/70 mt-1">
          Active employees — enter or edit net salary and total cost (gross) per month, same as the
          Employee Salaries report manual entries.
        </p>
      </div>

      <div className="rounded-2xl border border-base-200/80 bg-base-100 p-4 shadow-sm mb-6 dark:border-base-content/12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label py-1">
              <span className="label-text font-medium">Salary month</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
            >
              {SALARY_MONTH_OPTIONS.map(month => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label py-1">
              <span className="label-text font-medium">Salary year</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void loadRows()}
              disabled={loading || saving}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Loading…
                </>
              ) : (
                'Reload'
              )}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={loading || saving || rows.length === 0}
            >
              {saving ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Saving…
                </>
              ) : (
                'Save salaries'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-base-content/70">
          <span className="font-medium text-base-content">{periodLabel} {selectedYear}</span>
          {' · '}
          {rows.length} active {rows.length === 1 ? 'employee' : 'employees'}
          {totals.count > 0 && (
            <>
              {' · '}
              {totals.count} with salary · Net {formatSalaryCurrency(totals.net)} · Gross{' '}
              {formatSalaryCurrency(totals.gross)}
            </>
          )}
        </p>
        <div className="relative w-full sm:max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/50" />
          <input
            type="search"
            placeholder="Search employees…"
            className="input input-bordered w-full pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="w-full py-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="py-12 text-center text-base-content/60">
            {rows.length === 0 ? 'No active employees found.' : 'No employees match your search.'}
          </p>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="font-semibold">Employee</th>
                  <th className="font-semibold">Department</th>
                  <th className="font-semibold">Role</th>
                  <th className="font-semibold text-right">Salary (net)</th>
                  <th className="font-semibold text-right">Total cost (gross)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={row.employee_id}>
                    <td>
                      <div className="flex items-center gap-3 min-w-[10rem]">
                        <SalaryEmployeeAvatar
                          employeeId={row.employee_id}
                          name={row.employee_name}
                          photoUrl={row.photo_url}
                        />
                        <span className="font-medium">{row.employee_name}</span>
                      </div>
                    </td>
                    <td>{row.department}</td>
                    <td>{getSalaryRoleDisplayName(row.role)}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="input input-bordered input-sm w-full max-w-[9rem] ml-auto text-right bg-base-100"
                        placeholder="0"
                        value={row.net_salary ?? ''}
                        onChange={e => {
                          const v = e.target.value;
                          updateRow(
                            row.employee_id,
                            'net_salary',
                            v === '' ? null : Math.max(0, Number(v)),
                          );
                        }}
                      />
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="input input-bordered input-sm w-full max-w-[9rem] ml-auto text-right bg-base-100"
                        placeholder="0"
                        value={row.gross_salary || ''}
                        onChange={e => {
                          const v = e.target.value;
                          updateRow(row.employee_id, 'gross_salary', Math.max(0, Number(v) || 0));
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={3}>Totals ({totals.count} with salary)</td>
                  <td className="text-right">{formatSalaryCurrency(totals.net)}</td>
                  <td className="text-right">{formatSalaryCurrency(totals.gross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeSalariesManager;
