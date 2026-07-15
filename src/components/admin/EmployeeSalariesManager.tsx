import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { DocumentArrowUpIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { FaFileExcel } from 'react-icons/fa';
import * as XLSX from 'xlsx';
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
import { formatAllocationCostNis, salaryToHourlyRateNis } from '../../lib/employeeLeadReporting';
import { processPayrollDocumentUpload } from '../../lib/employeeSalaryPayrollUpload';

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
        className="h-12 w-12 shrink-0 rounded-full object-cover"
        onError={() => setImgErr(true)}
      />
    );
  }

  return (
    <span
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
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
  /** When true (e.g. HR Management tab), skip outer page title. */
  embedded?: boolean;
  onEmployeeClick?: (employeeId: number) => void;
  onSaved?: () => void;
};

const EmployeeSalariesManager: React.FC<EmployeeSalariesManagerProps> = ({
  initialYear,
  initialMonth,
  embedded = false,
  onEmployeeClick,
  onSaved,
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
  const [uploadingPayroll, setUploadingPayroll] = useState(false);
  const [search, setSearch] = useState('');
  const payrollInputRef = useRef<HTMLInputElement>(null);

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
      onSaved?.();
    } catch (e: unknown) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Failed to save salaries';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePayrollUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setUploadingPayroll(true);
      try {
        const result = await processPayrollDocumentUpload({
          file,
          salaryMonth: selectedMonth,
          salaryYear: selectedYear,
        });
        toast.success(
          `Processed ${result.matchedCount} salary records${
            result.unmatchedCount > 0
              ? `. ${result.unmatchedCount} could not be matched`
              : ''
          }.`,
        );
        await loadRows();
        onSaved?.();
      } catch (e: unknown) {
        console.error(e);
        const message = e instanceof Error ? e.message : 'Failed to process payroll document';
        toast.error(message);
      } finally {
        setUploadingPayroll(false);
        if (payrollInputRef.current) payrollInputRef.current.value = '';
      }
    },
    [selectedMonth, selectedYear, loadRows, onSaved],
  );

  const exportToExcel = useCallback(() => {
    if (filteredRows.length === 0) {
      toast.error('No salaries to export');
      return;
    }
    try {
      const sheetRows = filteredRows.map((row) => {
        const hourRate = salaryToHourlyRateNis(row.gross_salary, row.min_hours);
        return {
          Employee: row.employee_name,
          Department: row.department,
          Role: getSalaryRoleDisplayName(row.role),
          'Salary (net)': row.net_salary ?? '',
          'Total cost (gross)': row.gross_salary || '',
          'Hour rate': hourRate ?? '',
          'Min hours': row.min_hours,
        };
      });
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Salaries');
      const monthLabel =
        SALARY_MONTH_OPTIONS.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;
      XLSX.writeFile(wb, `salaries_${monthLabel}_${selectedYear}.xlsx`);
      toast.success('Exported to Excel');
    } catch (e) {
      console.error(e);
      toast.error('Failed to export to Excel');
    }
  }, [filteredRows, selectedMonth, selectedYear]);

  const busy = loading || saving || uploadingPayroll;

  const periodLabel =
    SALARY_MONTH_OPTIONS.find(m => m.value === selectedMonth)?.label ?? String(selectedMonth);

  const filterSelectClass =
    'rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
  const searchInputClass =
    'w-full rounded-full border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

  return (
    <div className="w-full min-w-0">
      {!embedded && (
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-base-content">Salaries</h2>
          <p className="text-base-content/70 mt-1">
            Active employees — enter or edit net salary and total cost (gross) per month, same as the
            Employee Salaries report manual entries.
          </p>
        </div>
      )}

      {embedded ? (
        <div className="space-y-4 mb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3 flex-1">
              <div className="relative min-w-[14rem] flex-1 max-w-sm">
                <span className="text-sm font-medium text-gray-600 mb-1 block">Search</span>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    placeholder="Search employees…"
                    className={searchInputClass}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Month</span>
                <select
                  className={`${filterSelectClass} min-w-[10rem]`}
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(Number(e.target.value))}
                >
                  {SALARY_MONTH_OPTIONS.map(month => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Year</span>
                <select
                  className={`${filterSelectClass} min-w-[7rem]`}
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                >
                  {yearOptions.map(year => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={payrollInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => void handlePayrollUpload(e.target.files?.[0])}
              />
              <button
                type="button"
                className="btn btn-sm rounded-full border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 gap-1.5"
                onClick={() => payrollInputRef.current?.click()}
                disabled={busy}
                title="Upload payroll document (דוח תמחיר)"
              >
                {uploadingPayroll ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Processing…
                  </>
                ) : (
                  <>
                    <DocumentArrowUpIcon className="h-4 w-4" />
                    Upload payroll
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-sm rounded-full border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                onClick={() => void loadRows()}
                disabled={busy}
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
                className="btn btn-sm rounded-full border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50"
                onClick={exportToExcel}
                disabled={busy || filteredRows.length === 0}
                title="Download as Excel"
              >
                <FaFileExcel className="w-4 h-4 mr-1.5" />
                Export to Excel
              </button>
              <button
                type="button"
                className="btn btn-sm rounded-full border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50"
                onClick={() => void handleSave()}
                disabled={busy || rows.length === 0}
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
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-800">{periodLabel} {selectedYear}</span>
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
        </div>
      ) : (
        <>
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
                <input
                  ref={payrollInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => void handlePayrollUpload(e.target.files?.[0])}
                />
                <button
                  type="button"
                  className="btn btn-outline gap-1.5"
                  onClick={() => payrollInputRef.current?.click()}
                  disabled={busy}
                  title="Upload payroll document (דוח תמחיר)"
                >
                  {uploadingPayroll ? (
                    <>
                      <span className="loading loading-spinner loading-sm" />
                      Processing…
                    </>
                  ) : (
                    <>
                      <DocumentArrowUpIcon className="h-4 w-4" />
                      Upload payroll
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => void loadRows()}
                  disabled={busy}
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
                  className="btn btn-outline gap-1.5"
                  onClick={exportToExcel}
                  disabled={busy || filteredRows.length === 0}
                  title="Download as Excel"
                >
                  <FaFileExcel className="h-4 w-4 text-green-600" />
                  Export to Excel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSave()}
                  disabled={busy || rows.length === 0}
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
        </>
      )}

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
            <table className={`table w-full ${embedded ? 'text-base' : ''}`}>
              <thead>
                <tr
                  className={
                    embedded ? 'text-sm uppercase tracking-wider text-gray-500' : undefined
                  }
                >
                  <th className={embedded ? 'bg-transparent font-semibold' : 'font-semibold'}>
                    Employee
                  </th>
                  <th className={embedded ? 'bg-transparent font-semibold' : 'font-semibold'}>
                    Role
                  </th>
                  <th
                    className={
                      embedded
                        ? 'bg-transparent font-semibold text-right'
                        : 'font-semibold text-right'
                    }
                  >
                    Salary (net)
                  </th>
                  <th
                    className={
                      embedded
                        ? 'bg-transparent font-semibold text-right'
                        : 'font-semibold text-right'
                    }
                  >
                    Total cost (gross)
                  </th>
                  <th
                    className={
                      embedded
                        ? 'bg-transparent font-semibold text-right'
                        : 'font-semibold text-right'
                    }
                  >
                    Hour rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const hourRate = salaryToHourlyRateNis(row.gross_salary, row.min_hours);
                  const cellClass = embedded ? 'text-base text-gray-700' : undefined;
                  return (
                  <tr key={row.employee_id}>
                    <td className={embedded ? 'font-medium text-base text-gray-900 whitespace-nowrap' : undefined}>
                      <div className="flex items-center gap-3 min-w-[10rem]">
                        <SalaryEmployeeAvatar
                          employeeId={row.employee_id}
                          name={row.employee_name}
                          photoUrl={row.photo_url}
                        />
                        <div className="min-w-0">
                          {onEmployeeClick ? (
                            <button
                              type="button"
                              className="font-medium text-base text-left text-gray-900 hover:text-emerald-700 hover:underline block truncate"
                              onClick={() => onEmployeeClick(row.employee_id)}
                            >
                              {row.employee_name}
                            </button>
                          ) : (
                            <div className="font-medium text-base truncate">{row.employee_name}</div>
                          )}
                          <div
                            className={
                              embedded
                                ? 'text-sm font-bold text-gray-500 truncate'
                                : 'text-sm text-base-content/60 truncate'
                            }
                          >
                            {row.department || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={cellClass}>{getSalaryRoleDisplayName(row.role)}</td>
                    <td className={`text-right ${cellClass ?? ''}`}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className={`input input-bordered w-full max-w-[9rem] ml-auto text-right bg-base-100 ${
                          embedded ? 'input-md text-base' : 'input-sm'
                        }`}
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
                    <td className={`text-right ${cellClass ?? ''}`}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className={`input input-bordered w-full max-w-[9rem] ml-auto text-right bg-base-100 ${
                          embedded ? 'input-md text-base' : 'input-sm'
                        }`}
                        placeholder="0"
                        value={row.gross_salary || ''}
                        onChange={e => {
                          const v = e.target.value;
                          updateRow(row.employee_id, 'gross_salary', Math.max(0, Number(v) || 0));
                        }}
                      />
                    </td>
                    <td
                      className={`text-right whitespace-nowrap ${
                        embedded ? 'text-base text-gray-700' : 'text-base-content/80'
                      }`}
                    >
                      {hourRate != null ? `${formatAllocationCostNis(hourRate)}/h` : '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={`font-semibold ${embedded ? 'text-base text-gray-900' : ''}`}>
                  <td colSpan={2}>Totals ({totals.count} with salary)</td>
                  <td className="text-right">{formatSalaryCurrency(totals.net)}</td>
                  <td className="text-right">{formatSalaryCurrency(totals.gross)}</td>
                  <td className="text-right">—</td>
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
