import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  MagnifyingGlassIcon,
  DocumentArrowUpIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  XMarkIcon,
  PencilSquareIcon,
  BoltIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import DocumentViewerModal from '../components/DocumentViewerModal';
import ContactProfileAvatar from '../components/ContactProfileAvatar';
import { usePersistedFilters } from '../hooks/usePersistedState';
import UnavailabilityTypeBadge from '../components/UnavailabilityTypeBadge';
import {
  aggregateClockInRecordsByDay,
  buildEmployeeMergedTimeAndUnavailabilityExportRows,
  buildMergedTimeAndUnavailabilityExportRows,
  exportAllEmployeesMergedTimeAndUnavailabilitiesToExcel,
  exportMergedTimeAndUnavailabilitiesToExcel,
  fetchClockInRecordsInRangeForReport,
  fetchEmployeeClockInRecords,
  groupClockInTotalsByEmployee,
  sumCountedClockDurationsMs,
  type ClockInExportRecord,
} from '../lib/workingHoursExport';
import {
  sumClockDurations,
  monthRange,
  toDateInputValue,
} from '../lib/employeeClockInFormat';
import { formatClockInLocationDisplay } from '../lib/employeeClockInLocation';
import {
  expandUnavailabilitiesToDailyRows,
  fetchAllUnavailabilitiesInRange,
  fetchEmployeeUnavailabilitiesInRange,
  fetchUnavailabilityReasonsForReportInRange,
  unavailabilityDateLabel,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityEntry,
} from '../lib/employeeUnavailabilities';
import type { DailyClockInSummary } from '../lib/workingHoursExport';
import { fetchWorkingHoursSubmissionsForMonth } from '../lib/employeeWorkingHoursSubmissions';
import { fetchActiveStaffEmployeesWithDepartment } from '../lib/employeeSalaries';
import { filterCountedClockInRecords } from '../lib/employeeClockInApproval';
import {
  buildHolidayMapForRange,
  calculateEmployeeExtraHoursForRange,
  calculateExtraHoursByEmployee,
  formatExtraHoursDuration,
  preloadHolidayMapsForRange,
} from '../lib/employeeExtraHours';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type ReportFilters = {
  year: number;
  month: number;
  searchTerm: string;
};

function TimeListCell({ value }: { value: string }) {
  const parts = value.split(', ').filter(Boolean);
  if (parts.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="text-sm whitespace-nowrap">
          {part === 'Active' ? (
            <span className="badge badge-sm bg-yellow-100/90 text-yellow-700 border-yellow-200/60">
              Active
            </span>
          ) : (
            part
          )}
        </span>
      ))}
    </div>
  );
}

type DetailClockInRow = DailyClockInSummary & {
  kind: 'clock_in';
  gpsIn: string;
  gpsOut: string;
};

type DetailUnavailabilityRow = {
  kind: 'unavailability';
  rowKey: string;
  dateKey: string;
  date: string;
  unavailabilityType: string;
  typeLabel: string;
  reason: string;
};

type DetailTableRow = DetailClockInRow | DetailUnavailabilityRow;

interface EmployeeUnavailabilityData {
  employeeId: number;
  employeeName: string;
  photoUrl?: string | null;
  departmentName?: string | null;
  minHours: number;
  sickDays: number;
  vacationDays: number;
  generalDays: number;
  hasDocuments: boolean;
  totalHours: string;
  daysWorked: number;
  extraHours125: string;
  extraHours150: string;
  hoursSubmitted: boolean;
  submittedAt: string | null;
}

interface DocumentData {
  id: number;
  employeeId: number;
  employeeName: string;
  documentUrl: string;
  uploadedAt: string;
  sickDaysReason: string;
  startDate: string;
  endDate: string | null;
}

const EmployeeUnavailabilitiesReport = () => {
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const [filters, setFilters] = usePersistedFilters<ReportFilters>(
    'employee_unavailabilities_filters_v2',
    {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      searchTerm: '',
    },
    {
      storage: 'sessionStorage',
    },
  );

  const periodRange = useMemo(
    () => monthRange(filters.year, filters.month),
    [filters.year, filters.month],
  );
  const fromDate = periodRange.from;
  const toDate = periodRange.to;

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  const [loading, setLoading] = useState(false);
  const [employeeData, setEmployeeData] = useState<EmployeeUnavailabilityData[]>([]);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentData | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeUnavailabilityData | null>(null);
  const [detailRecords, setDetailRecords] = useState<ClockInExportRecord[]>([]);
  const [detailUnavailabilities, setDetailUnavailabilities] = useState<EmployeeUnavailabilityEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailExporting, setDetailExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  // Fetch unavailability data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [
        activeEmployees,
        ,
        reasonsData,
        clockRecords,
        submissions,
      ] = await Promise.all([
        fetchActiveStaffEmployeesWithDepartment(),
        preloadHolidayMapsForRange(fromDate, toDate),
        fetchUnavailabilityReasonsForReportInRange(fromDate, toDate),
        fetchClockInRecordsInRangeForReport(fromDate, toDate),
        fetchWorkingHoursSubmissionsForMonth(filters.year, filters.month),
      ]);

      const holidayMap = buildHolidayMapForRange(fromDate, toDate);
      const employeeMap = new Map<number, EmployeeUnavailabilityData>();
      const minHoursByEmployee = new Map<number, number>();

      for (const employee of activeEmployees) {
        employeeMap.set(employee.id, {
          employeeId: employee.id,
          employeeName: employee.display_name,
          photoUrl: employee.photo_url,
          departmentName: employee.departmentName || '—',
          minHours: employee.minHours,
          sickDays: 0,
          vacationDays: 0,
          generalDays: 0,
          hasDocuments: false,
          totalHours: '0h 0m',
          daysWorked: 0,
          extraHours125: '0h 0m',
          extraHours150: '0h 0m',
          hoursSubmitted: false,
          submittedAt: null,
        });
        minHoursByEmployee.set(employee.id, employee.minHours);
      }

      const documentsList: DocumentData[] = [];
      const filterFromDate = new Date(fromDate);
      const filterToDate = new Date(toDate);

      for (const reason of reasonsData) {
        const employeeId = reason.employee_id;
        if (!employeeMap.has(employeeId)) continue;

        const empData = employeeMap.get(employeeId)!;
        const employeeName = empData.employeeName;

        const startDate = new Date(reason.start_date);
        const endDate = reason.end_date ? new Date(reason.end_date) : startDate;
        const overlapStart = startDate > filterFromDate ? startDate : filterFromDate;
        const overlapEnd = endDate < filterToDate ? endDate : filterToDate;
        const daysDiff =
          Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        if (reason.unavailability_type === 'sick_days') {
          empData.sickDays += daysDiff;
          if (reason.document_url) {
            empData.hasDocuments = true;
            documentsList.push({
              id: reason.id,
              employeeId,
              employeeName: employeeName || 'Unknown',
              documentUrl: reason.document_url,
              uploadedAt: reason.created_at,
              sickDaysReason: reason.sick_days_reason || '',
              startDate: reason.start_date,
              endDate: reason.end_date,
            });
          }
        } else if (reason.unavailability_type === 'vacation') {
          empData.vacationDays += daysDiff;
        } else if (reason.unavailability_type === 'general') {
          empData.generalDays += daysDiff;
        }
      }

      const clockByEmployee = groupClockInTotalsByEmployee(clockRecords);
      const clockRecordsByEmployee = new Map<number, ClockInExportRecord[]>();
      for (const record of clockRecords) {
        const employeeId = record.employee_id;
        if (employeeId == null) continue;
        const list = clockRecordsByEmployee.get(employeeId);
        if (list) list.push(record);
        else clockRecordsByEmployee.set(employeeId, [record]);
      }

      const unavailByEmployee = new Map<number, typeof reasonsData>();
      for (const reason of reasonsData) {
        const list = unavailByEmployee.get(reason.employee_id);
        if (list) list.push(reason);
        else unavailByEmployee.set(reason.employee_id, [reason]);
      }

      const extraHoursByEmployee = calculateExtraHoursByEmployee(
        clockRecordsByEmployee,
        minHoursByEmployee,
        holidayMap,
        fromDate,
        toDate,
        unavailByEmployee,
      );

      const submissionByEmployee = new Map(
        submissions.map((submission) => [submission.employee_id, submission]),
      );

      for (const [employeeId, { totals }] of clockByEmployee) {
        const emp = employeeMap.get(employeeId);
        if (emp) {
          emp.totalHours = totals.totalDuration;
          emp.daysWorked = totals.daysWorked;
          const extraHours = extraHoursByEmployee.get(employeeId);
          emp.extraHours125 = formatExtraHoursDuration(extraHours?.extraHours125Ms ?? 0);
          emp.extraHours150 = formatExtraHoursDuration(extraHours?.extraHours150Ms ?? 0);
        }
      }

      for (const emp of employeeMap.values()) {
        const submission = submissionByEmployee.get(emp.employeeId);
        emp.hoursSubmitted = Boolean(submission);
        emp.submittedAt = submission?.submitted_at ?? null;
      }

      const mergedData = Array.from(employeeMap.values()).sort((a, b) =>
        a.employeeName.localeCompare(b.employeeName),
      );

      setEmployeeData(mergedData);
      setDocuments(documentsList);
    } catch (error) {
      console.error('Error fetching unavailability data:', error);
      toast.error('Failed to load unavailability data');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when dates are set
  useEffect(() => {
    void fetchData();
  }, [filters.year, filters.month]);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const formatDate = (dateString: string) => {
    const dateKey = dateString.includes('T') ? dateString.split('T')[0] : dateString;
    return unavailabilityDateLabel(dateKey);
  };

  // Export employee summary to Excel
  const displayedEmployees = useMemo(() => {
    if (!filters.searchTerm.trim()) return employeeData;
    const searchLower = filters.searchTerm.toLowerCase();
    return employeeData.filter((emp) =>
      emp.employeeName.toLowerCase().includes(searchLower),
    );
  }, [employeeData, filters.searchTerm]);

  const openEmployeeDetail = useCallback(
    async (emp: EmployeeUnavailabilityData) => {
      setSelectedEmployee(emp);
      setDetailRecords([]);
      setDetailUnavailabilities([]);
      setDetailLoading(true);
      try {
        const [records, unavailRows] = await Promise.all([
          fetchEmployeeClockInRecords(emp.employeeId, fromDate, toDate),
          fetchEmployeeUnavailabilitiesInRange(emp.employeeId, fromDate, toDate),
        ]);
        setDetailRecords(records);
        setDetailUnavailabilities(unavailRows);
      } catch (error) {
        console.error('Error fetching working hours:', error);
        toast.error('Failed to load working hours');
        setSelectedEmployee(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [fromDate, toDate],
  );

  const closeEmployeeDetail = () => {
    setSelectedEmployee(null);
    setDetailRecords([]);
    setDetailUnavailabilities([]);
  };

  const detailTableRows = useMemo((): DetailTableRow[] => {
    const dailyClock = aggregateClockInRecordsByDay(detailRecords);
    const clockRows: DetailClockInRow[] = dailyClock.map((row) => {
      const daySessions = detailRecords
        .filter((r) => toDateInputValue(new Date(r.clock_in_time)) === row.dateKey)
        .sort(
          (a, b) =>
            new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime(),
        );
      const first = daySessions[0];
      const lastOut = [...daySessions].reverse().find((s) => s.clock_out_time);
      return {
        ...row,
        kind: 'clock_in',
        gpsIn: first ? formatClockInLocationDisplay(first, 'in') : '—',
        gpsOut: lastOut ? formatClockInLocationDisplay(lastOut, 'out') : '—',
      };
    });

    const unavailRows: DetailUnavailabilityRow[] = expandUnavailabilitiesToDailyRows(
      detailUnavailabilities,
      fromDate,
      toDate,
    ).map((row) => ({
      kind: 'unavailability' as const,
      rowKey: `${row.id}-${row.date}`,
      dateKey: row.date,
      date: unavailabilityDateLabel(row.date),
      unavailabilityType: row.unavailability_type,
      typeLabel: unavailabilityTypeLabel(row.unavailability_type),
      reason: unavailabilityReasonText(row),
    }));

    const combined: DetailTableRow[] = [...clockRows, ...unavailRows];
    combined.sort((a, b) => {
      const dateCmp = a.dateKey.localeCompare(b.dateKey);
      if (dateCmp !== 0) return dateCmp;
      if (a.kind === b.kind) return 0;
      return a.kind === 'unavailability' ? -1 : 1;
    });
    return combined;
  }, [detailRecords, detailUnavailabilities, fromDate, toDate]);

  const handleDetailExport = () => {
    if (!selectedEmployee) {
      toast.error('No employee selected');
      return;
    }
    const mergedRows = buildMergedTimeAndUnavailabilityExportRows(
      detailRecords,
      detailUnavailabilities,
      fromDate,
      toDate,
    );
    if (mergedRows.length === 0) {
      toast.error('No data to export');
      return;
    }
    setDetailExporting(true);
    try {
      const countedRecords = filterCountedClockInRecords(detailRecords);
      const extraHours = calculateEmployeeExtraHoursForRange(
        detailRecords,
        selectedEmployee.minHours,
        fromDate,
        toDate,
        detailUnavailabilities,
      );
      exportMergedTimeAndUnavailabilitiesToExcel(mergedRows, {
        employeeName: selectedEmployee.employeeName,
        department: selectedEmployee.departmentName || '—',
        dateFrom: fromDate,
        dateTo: toDate,
        periodTotalMs: sumCountedClockDurationsMs(countedRecords),
        extraHours125Ms: extraHours.extraHours125Ms,
        extraHours150Ms: extraHours.extraHours150Ms,
        deficitHoursMs: extraHours.deficitHoursMs,
        sickDays: selectedEmployee.sickDays,
        vacationDays: selectedEmployee.vacationDays,
        filenameSuffix: selectedEmployee.employeeName,
      });
      toast.success('Time and unavailabilities exported successfully');
    } catch (error) {
      console.error('Detail export error:', error);
      toast.error('Failed to export');
    } finally {
      setDetailExporting(false);
    }
  };

  const exportEmployeeSummary = async () => {
    if (displayedEmployees.length === 0) {
      toast.error('No data to export');
      return;
    }

    setExportingAll(true);
    try {
      const [clockRecords, allUnavailabilities] = await Promise.all([
        fetchClockInRecordsInRangeForReport(fromDate, toDate),
        fetchAllUnavailabilitiesInRange(fromDate, toDate),
      ]);

      const clockByEmployee = new Map<number, ClockInExportRecord[]>();
      for (const record of clockRecords) {
        const empId = record.employee_id;
        if (empId == null) continue;
        const list = clockByEmployee.get(empId);
        if (list) list.push(record);
        else clockByEmployee.set(empId, [record]);
      }

      const unavailByEmployee = new Map<number, EmployeeUnavailabilityEntry[]>();
      for (const entry of allUnavailabilities) {
        const list = unavailByEmployee.get(entry.employee_id);
        if (list) list.push(entry);
        else unavailByEmployee.set(entry.employee_id, [entry]);
      }

      const minHoursByEmployee = new Map(
        displayedEmployees.map((emp) => [emp.employeeId, emp.minHours]),
      );
      const extraHoursByEmployee = calculateExtraHoursByEmployee(
        clockByEmployee,
        minHoursByEmployee,
        buildHolidayMapForRange(fromDate, toDate),
        fromDate,
        toDate,
        unavailByEmployee,
      );

      const employeeExports = displayedEmployees.map((emp) => {
        const clockRecordsForEmp = clockByEmployee.get(emp.employeeId) ?? [];
        const countedRecords = filterCountedClockInRecords(clockRecordsForEmp);
        const extraHours = extraHoursByEmployee.get(emp.employeeId);
        const mergedRows = buildEmployeeMergedTimeAndUnavailabilityExportRows(
          clockRecordsForEmp,
          unavailByEmployee.get(emp.employeeId) ?? [],
          fromDate,
          toDate,
          emp.employeeName,
          emp.departmentName || '—',
        );

        return {
          employeeName: emp.employeeName,
          department: emp.departmentName || '—',
          rows: mergedRows.map(({ employeeName, department, ...row }) => row),
          periodTotalMs: sumCountedClockDurationsMs(countedRecords),
          extraHours125Ms: extraHours?.extraHours125Ms ?? 0,
          extraHours150Ms: extraHours?.extraHours150Ms ?? 0,
          deficitHoursMs: extraHours?.deficitHoursMs ?? 0,
          sickDays: emp.sickDays,
          vacationDays: emp.vacationDays,
        };
      });

      if (employeeExports.length === 0) {
        toast.error('No employees to export');
        return;
      }

      exportAllEmployeesMergedTimeAndUnavailabilitiesToExcel(employeeExports, {
        dateFrom: fromDate,
        dateTo: toDate,
      });
      toast.success('Employee time and unavailabilities exported successfully');
    } catch (error) {
      console.error('Export all employees error:', error);
      toast.error('Failed to export');
    } finally {
      setExportingAll(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDocumentName = (documentUrl: string): string => {
    try {
      // Extract filename from URL
      let filename = '';
      if (documentUrl.includes('?')) {
        filename = documentUrl.split('?')[0].split('/').pop() || '';
      } else {
        const parts = documentUrl.split('/');
        filename = parts[parts.length - 1];
      }
      
      // If filename is empty, return default
      if (!filename) return 'document';
      
      // Extract file extension
      const ext = filename.split('.').pop() || '';
      
      // If the filename follows the pattern employee_ID_timestamp_random.ext,
      // show a cleaner name with the extension
      if (filename.startsWith('employee_') && filename.includes('_')) {
        return `Document.${ext}`;
      }
      
      // Otherwise return the filename as is
      return filename;
    } catch (error) {
      // If URL parsing fails, try to extract from string
      const parts = documentUrl.split('/');
      const filename = parts[parts.length - 1] || 'document';
      return filename.split('?')[0]; // Remove query params if any
    }
  };

  // Filter documents by search term
  const filteredDocuments = useMemo(() => {
    if (!filters.searchTerm.trim()) return documents;
    const searchLower = filters.searchTerm.toLowerCase();
    return documents.filter(doc => 
      doc.employeeName.toLowerCase().includes(searchLower)
    );
  }, [documents, filters.searchTerm]);

  return (
    <div className="p-0 md:p-6 space-y-8">
      <div className="mb-6">
        <button
          onClick={() => navigate('/reports')}
          className="btn btn-ghost btn-sm mb-4"
        >
          ← Back to Reports
        </button>
        <h1 className="text-3xl font-bold">Employee Time &amp; Unavailabilities Report</h1>
        <p className="text-gray-500 mt-1 mb-6">
          Sick days, vacation, and clock-in totals — click an employee for full working hours
        </p>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="label">
                <span className="label-text">Year</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={filters.year}
                onChange={(e) => handleFilterChange('year', Number(e.target.value))}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">
                <span className="label-text">Month</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={filters.month}
                onChange={(e) => handleFilterChange('month', Number(e.target.value))}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">
                <span className="label-text">Search Employee</span>
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  className="input input-bordered w-full pl-10"
                  placeholder="Search by employee name..."
                  value={filters.searchTerm}
                  onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                />
              </div>
            </div>
        </div>

        {/* Employee Table */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Employee Summary</h2>
            <button
              onClick={() => void exportEmployeeSummary()}
              className="btn btn-sm btn-primary"
              disabled={loading || exportingAll || displayedEmployees.length === 0}
              title="Download as Excel"
            >
              {exportingAll ? (
                <span className="loading loading-spinner loading-sm mr-2" />
              ) : (
                <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
              )}
              Export to Excel
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th className="text-right">Sick Days</th>
                  <th className="text-right">Vacation</th>
                  <th className="text-right">General</th>
                  <th className="text-right">Total Hours</th>
                  <th className="text-right">Extra hours 125%</th>
                  <th className="text-right">Extra hours 150%</th>
                  <th className="text-right">Days Worked</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8">
                      <span className="loading loading-spinner loading-md"></span>
                      <span className="ml-2">Loading...</span>
                    </td>
                  </tr>
                ) : displayedEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-500">
                      No data found for the selected period
                    </td>
                  </tr>
                ) : (
                  displayedEmployees.map((emp) => (
                    <tr
                      key={emp.employeeId}
                      className="hover:bg-base-200 cursor-pointer"
                      onClick={() => void openEmployeeDetail(emp)}
                      title="View working hours"
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          <ContactProfileAvatar
                            name={emp.employeeName}
                            imageUrl={emp.photoUrl}
                            className="h-10 w-10 text-sm"
                          />
                          <span className="font-medium">{emp.employeeName}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-gray-600">{emp.departmentName || '—'}</span>
                      </td>
                      <td className="text-right font-semibold">{emp.sickDays}</td>
                      <td className="text-right font-semibold">{emp.vacationDays}</td>
                      <td className="text-right font-semibold">{emp.generalDays}</td>
                      <td className="text-right font-semibold text-primary">{emp.totalHours}</td>
                      <td className="text-right font-semibold">{emp.extraHours125}</td>
                      <td className="text-right font-semibold">{emp.extraHours150}</td>
                      <td className="text-right font-semibold">{emp.daysWorked}</td>
                      <td>
                        {emp.hoursSubmitted ? (
                          <span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-700 border border-green-200"
                            title={
                              emp.submittedAt
                                ? `Submitted ${formatDateTime(emp.submittedAt)}`
                                : 'Submitted'
                            }
                            aria-label="Submitted"
                          >
                            <CheckCircleIcon className="w-5 h-5 shrink-0" aria-hidden />
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
                            title="Hours not submitted for this month"
                            aria-label="Not submitted"
                          >
                            <XCircleIcon className="w-5 h-5 shrink-0" aria-hidden />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Documents Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Uploaded Documents</h2>
          {loading ? (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-md"></span>
              <span className="ml-2">Loading...</span>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No documents uploaded for the selected period
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Document</th>
                    <th>Reason</th>
                    <th>Date Range</th>
                    <th>Uploaded At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-base-200">
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{doc.employeeName}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <DocumentArrowUpIcon className="w-5 h-5 text-primary" />
                          <span className="text-sm font-medium">{getDocumentName(doc.documentUrl)}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-sm">{doc.sickDaysReason || '—'}</span>
                      </td>
                      <td>
                        <span className="text-sm">
                          {formatDate(doc.startDate)}
                          {doc.endDate && doc.endDate !== doc.startDate && (
                            <> - {formatDate(doc.endDate)}</>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="text-sm text-gray-600">
                          {formatDateTime(doc.uploadedAt)}
                        </span>
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            setSelectedDocument(doc);
                            setIsDocumentModalOpen(true);
                          }}
                          className="btn btn-xs btn-primary"
                        >
                          View Document
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Working Hours Detail Modal */}
      {selectedEmployee && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-6xl w-full">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <ContactProfileAvatar
                  name={selectedEmployee.employeeName}
                  imageUrl={selectedEmployee.photoUrl}
                  className="h-12 w-12 text-base"
                />
                <div className="min-w-0">
                  <h3 className="font-bold text-xl truncate">{selectedEmployee.employeeName}</h3>
                  <p className="text-sm text-gray-500 flex items-center gap-1.5">
                    <ClockIcon className="w-4 h-4 shrink-0" />
                    Working hours &amp; unavailabilities · {formatDate(fromDate)} – {formatDate(toDate)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-circle btn-ghost shrink-0"
                onClick={closeEmployeeDetail}
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <span className="text-base font-semibold text-primary">
                Period total: {sumClockDurations(filterCountedClockInRecords(detailRecords))}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleDetailExport}
                disabled={detailLoading || detailExporting || detailTableRows.length === 0}
              >
                {detailExporting ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                )}
                Export to Excel
              </button>
            </div>

            <div className="overflow-x-auto max-h-[60vh]">
              <table className="table table-sm w-full">
                <thead className="sticky top-0 bg-base-200 z-10">
                  <tr>
                    <th>Date</th>
                    <th>Clock in</th>
                    <th>Clock out</th>
                    <th>Duration</th>
                    <th>Workplace (in)</th>
                    <th>Workplace (out)</th>
                    <th>GPS (in)</th>
                    <th>GPS (out)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-10">
                        <span className="loading loading-spinner loading-md" />
                      </td>
                    </tr>
                  ) : detailTableRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-10 text-gray-500">
                        No clock-in or unavailability records for this period
                      </td>
                    </tr>
                  ) : (
                    detailTableRows.map((row) =>
                      row.kind === 'clock_in' ? (
                        <tr key={`clock-${row.dateKey}`} className="hover:bg-base-200/50">
                          <td className="whitespace-nowrap font-medium">
                            <div className="flex items-center gap-1.5">
                              <span>{row.date}</span>
                              <div className="flex items-center gap-0.5 shrink-0">
                                {row.hasManual && (
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
                                    title="Manual entry"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" />
                                  </span>
                                )}
                                {row.hasAutomatic && (
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                                    title="Automatic entry"
                                  >
                                    <BoltIcon className="w-4 h-4" />
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <TimeListCell value={row.clockIns} />
                          </td>
                          <td>
                            <TimeListCell value={row.clockOuts} />
                          </td>
                          <td className="whitespace-nowrap font-medium text-primary">
                            {row.totalDuration}
                          </td>
                          <td className="whitespace-nowrap text-sm">{row.workplacesIn}</td>
                          <td className="whitespace-nowrap text-sm">{row.workplacesOut}</td>
                          <td
                            className="max-w-[120px] truncate text-sm text-gray-600"
                            title={row.gpsIn}
                          >
                            {row.gpsIn}
                          </td>
                          <td
                            className="max-w-[120px] truncate text-sm text-gray-600"
                            title={row.gpsOut !== '—' ? row.gpsOut : undefined}
                          >
                            {row.gpsOut}
                          </td>
                          <td className="max-w-[140px] truncate text-sm text-gray-500">
                            {row.notes}
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={`unavail-${row.rowKey}`}
                          className="hover:bg-base-200/50 bg-base-200/20"
                        >
                          <td className="whitespace-nowrap font-medium">
                            <div className="flex items-center gap-1.5">
                              <span>{row.date}</span>
                              <span
                                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-600 border border-gray-200 shrink-0"
                                title={row.typeLabel}
                              >
                                <CalendarDaysIcon className="w-4 h-4" />
                              </span>
                            </div>
                          </td>
                          <td className="text-gray-400">—</td>
                          <td className="text-gray-400">—</td>
                          <td>
                            <UnavailabilityTypeBadge type={row.unavailabilityType} />
                          </td>
                          <td className="text-gray-400">—</td>
                          <td className="text-gray-400">—</td>
                          <td className="text-gray-400">—</td>
                          <td className="text-gray-400">—</td>
                          <td className="max-w-[200px] text-sm text-gray-600">
                            {row.reason}
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-action">
              <button type="button" className="btn" onClick={closeEmployeeDetail}>
                Close
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={closeEmployeeDetail}>close</button>
          </form>
        </dialog>
      )}

      {/* Document Viewer Modal */}
      {selectedDocument && (
        <DocumentViewerModal
          isOpen={isDocumentModalOpen}
          onClose={() => {
            setIsDocumentModalOpen(false);
            setSelectedDocument(null);
          }}
          documentUrl={selectedDocument.documentUrl}
          documentName={getDocumentName(selectedDocument.documentUrl)}
          employeeName={selectedDocument.employeeName}
          uploadedAt={selectedDocument.uploadedAt}
          sickDaysReason={selectedDocument.sickDaysReason}
        />
      )}
    </div>
  );
};

export default EmployeeUnavailabilitiesReport;
