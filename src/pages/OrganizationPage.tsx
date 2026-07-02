import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { FaWhatsapp } from 'react-icons/fa';
import {
  ArrowDownTrayIcon,
  BuildingOffice2Icon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  EnvelopeIcon,
  FunnelIcon,
  IdentificationIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  Squares2X2Icon,
  TableCellsIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import OrganizationChart from '../components/organization/OrganizationChart';
import OrganizationEmployeeTable from '../components/organization/OrganizationEmployeeTable';
import {
  exportOrganizationChartToExcel,
  exportOrganizationTableToExcel,
} from '../lib/organizationExport';
import RMQMessagesPage from './RMQMessagesPage';
import {
  employeeMatchesSearch,
  fetchOrganizationData,
  getBonusesRoleDisplayName,
  getEmployeeDisplayLabel,
  type OrganizationDepartmentGroup,
  type OrganizationEmployee,
} from '../lib/organizationEmployees';
import { getSalaryEmployeeInitials, salaryAvatarGradientStyle } from '../lib/employeeSalaries';
import { useClockInGate } from '../hooks/useClockInGate';

type OrganizationViewTab = 'chart' | 'table';

function buildWhatsAppUrl(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function pickWhatsAppNumber(employee: OrganizationEmployee): string | null {
  const mobile = employee.mobile?.trim();
  return mobile || null;
}

function pickCallNumber(employee: OrganizationEmployee): string | null {
  const mobile = employee.mobile?.trim();
  if (mobile) return mobile;
  const phone = employee.phone?.trim();
  return phone || null;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getImageRegionLuminance(img: HTMLImageElement, region: 'bottom' | 'full' = 'bottom'): number | null {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !img.naturalWidth || !img.naturalHeight) return null;

    const sampleWidth = Math.min(img.naturalWidth, 240);
    const sampleHeight = Math.min(
      region === 'bottom' ? Math.floor(img.naturalHeight * 0.35) : img.naturalHeight,
      120,
    );

    canvas.width = sampleWidth;
    canvas.height = sampleHeight;

    const sourceY =
      region === 'bottom' ? Math.max(0, img.naturalHeight - sampleHeight) : 0;

    ctx.drawImage(
      img,
      0,
      sourceY,
      img.naturalWidth,
      sampleHeight,
      0,
      0,
      sampleWidth,
      sampleHeight,
    );

    const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    let total = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 40) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }

    if (count === 0) return null;
    return total / count;
  } catch {
    return null;
  }
}

const EmployeeModalHero: React.FC<{
  employee: OrganizationEmployee;
  name: string;
  roleLabel: string | null;
  onRmqClick: () => void;
  canRmq: boolean;
}> = ({ employee, name, roleLabel, onRmqClick, canRmq }) => {
  const [imageError, setImageError] = useState(false);
  const [useDarkText, setUseDarkText] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const label = getEmployeeDisplayLabel(employee);
  const hasPhoto = Boolean(employee.photo_url && !imageError);

  const updateTextContrast = useCallback((img: HTMLImageElement | null) => {
    if (!img) {
      setUseDarkText(false);
      return;
    }
    const luminance = getImageRegionLuminance(img, 'bottom');
    if (luminance == null) {
      setUseDarkText(false);
      return;
    }
    setUseDarkText(luminance > 150);
  }, []);

  useEffect(() => {
    if (!hasPhoto) {
      setUseDarkText(false);
      return;
    }
    updateTextContrast(imageRef.current);
  }, [employee.photo_url, hasPhoto, updateTextContrast]);

  const badgeClassName = useMemo(
    () =>
      useDarkText
        ? 'bg-white/72 shadow-[0_8px_24px_rgba(15,23,42,0.12)]'
        : 'bg-black/25 shadow-[0_8px_24px_rgba(0,0,0,0.22)]',
    [useDarkText],
  );

  const nameClassName = useMemo(
    () =>
      useDarkText
        ? 'text-[#111827] drop-shadow-none'
        : 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]',
    [useDarkText],
  );

  const roleClassName = useMemo(
    () =>
      useDarkText
        ? 'text-[#6b7280] drop-shadow-none'
        : 'text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]',
    [useDarkText],
  );

  const rmqButtonClassName = useMemo(
    () =>
      useDarkText
        ? 'border-[#4829CC]/20 bg-white/80 text-[#4829CC] hover:bg-white'
        : 'border-white/40 bg-white/25 text-white hover:bg-white/35',
    [useDarkText],
  );

  return (
    <div className="relative overflow-hidden bg-[#ececec] dark:bg-base-300/40">
      <div className="relative h-80 w-full overflow-hidden">
        {hasPhoto ? (
          <img
            ref={imageRef}
            src={employee.photo_url!}
            alt={label}
            className="h-full w-full object-cover object-[center_22%]"
            onLoad={(event) => updateTextContrast(event.currentTarget)}
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-5xl font-bold text-white"
            style={salaryAvatarGradientStyle(employee.id, label)}
            aria-hidden
          >
            {getSalaryEmployeeInitials(label) || getInitials(label)}
          </div>
        )}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t ${
            useDarkText ? 'from-white/30 to-transparent' : 'from-black/40 to-transparent'
          }`}
          aria-hidden
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-start px-4 pb-4">
        <div
          className={`flex w-fit max-w-[min(100%,17.5rem)] items-center gap-2.5 rounded-2xl px-3.5 py-2.5 backdrop-blur-md ${badgeClassName}`}
        >
          <div className="min-w-0 flex-1">
            <h3 className={`truncate text-base font-bold leading-tight ${nameClassName}`}>{name}</h3>
            {roleLabel ? (
              <p className={`mt-0.5 truncate text-sm ${roleClassName}`}>{roleLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onRmqClick}
            disabled={!canRmq}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border backdrop-blur-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${rmqButtonClassName}`}
            title={canRmq ? 'RMQ message' : 'No RMQ account linked'}
            aria-label={canRmq ? 'RMQ message' : 'No RMQ account linked'}
          >
            <ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
};

const OVAL_CONTACT_BTN =
  'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';

type LiveFilter = 'all' | 'yes' | 'no' | 'sick_days' | 'vacation' | 'general';

const LIVE_FILTER_LABELS: Record<LiveFilter, string> = {
  all: 'All',
  yes: 'Live',
  no: 'Not live',
  sick_days: 'Sick',
  vacation: 'Vacation',
  general: 'General',
};

const LIVE_STATUS_FILTER_OPTIONS: { value: LiveFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'yes', label: 'Live (clocked in)' },
  { value: 'no', label: 'Not live' },
  { value: 'sick_days', label: 'Sick' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'general', label: 'General' },
];

const OrganizationPage: React.FC = () => {
  const navigate = useNavigate();
  const { status: clockInGateStatus } = useClockInGate();
  const [activeTab, setActiveTab] = useState<OrganizationViewTab>('chart');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [partners, setPartners] = useState<OrganizationEmployee[]>([]);
  const [leadership, setLeadership] = useState<OrganizationDepartmentGroup[]>([]);
  const [departments, setDepartments] = useState<OrganizationDepartmentGroup[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [liveFilter, setLiveFilter] = useState<LiveFilter>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<OrganizationEmployee | null>(null);
  const [rmqOpen, setRmqOpen] = useState(false);
  const [rmqChatUserId, setRmqChatUserId] = useState<string | null>(null);

  const departmentOptions = useMemo(() => {
    const names: string[] = [];
    if (partners.length > 0) names.push('Partners');
    leadership.forEach((group) => names.push(group.name));
    departments.forEach((group) => names.push(group.name));
    return names;
  }, [partners, leadership, departments]);

  const matchesDepartmentFilter = useCallback(
    (sectionName: string) => {
      if (selectedDepartments.length === 0) return true;
      return selectedDepartments.includes(sectionName);
    },
    [selectedDepartments],
  );

  const matchesLiveFilter = useCallback(
    (employee: OrganizationEmployee) => {
      if (liveFilter === 'all') return true;
      if (liveFilter === 'yes') return employee.isClockedIn;
      if (liveFilter === 'no') return !employee.isClockedIn;
      return !employee.isClockedIn && employee.unavailabilityType === liveFilter;
    },
    [liveFilter],
  );

  const hasActiveFilters = selectedDepartments.length > 0 || liveFilter !== 'all';

  const toggleDepartmentFilter = (sectionName: string) => {
    setSelectedDepartments((current) =>
      current.includes(sectionName)
        ? current.filter((name) => name !== sectionName)
        : [...current, sectionName],
    );
  };

  const loadOrganization = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchOrganizationData();
      setPartners(data.partners);
      setLeadership(data.leadership);
      setDepartments(data.departments);
    } catch (error) {
      console.error('Error loading organization:', error);
      toast.error('Failed to load organization');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clockInGateStatus === 'loading') return;
    void loadOrganization();
  }, [loadOrganization, clockInGateStatus]);

  const filteredPartners = useMemo(() => {
    if (!matchesDepartmentFilter('Partners')) return [];
    return partners.filter(
      (employee) => employeeMatchesSearch(employee, searchTerm) && matchesLiveFilter(employee),
    );
  }, [partners, searchTerm, matchesDepartmentFilter, matchesLiveFilter]);

  const filteredLeadership = useMemo(
    () =>
      leadership
        .filter((group) => matchesDepartmentFilter(group.name))
        .map((group) => ({
          ...group,
          employees: group.employees.filter(
            (employee) => employeeMatchesSearch(employee, searchTerm) && matchesLiveFilter(employee),
          ),
        }))
        .filter((group) => group.employees.length > 0),
    [leadership, searchTerm, matchesDepartmentFilter, matchesLiveFilter],
  );

  const filteredDepartments = useMemo(
    () =>
      departments
        .filter((group) => matchesDepartmentFilter(group.name))
        .map((group) => ({
          ...group,
          employees: group.employees.filter(
            (employee) => employeeMatchesSearch(employee, searchTerm) && matchesLiveFilter(employee),
          ),
        }))
        .filter((group) => group.employees.length > 0),
    [departments, searchTerm, matchesDepartmentFilter, matchesLiveFilter],
  );

  const chartColumns = useMemo(
    () => [...filteredLeadership, ...filteredDepartments],
    [filteredLeadership, filteredDepartments],
  );

  const tableSections = useMemo(() => {
    const sections: OrganizationDepartmentGroup[] = [];
    if (filteredPartners.length > 0) {
      sections.push({ name: 'Partners', employees: filteredPartners });
    }
    sections.push(...filteredLeadership, ...filteredDepartments);
    return sections;
  }, [filteredPartners, filteredLeadership, filteredDepartments]);

  const totalVisible =
    activeTab === 'chart'
      ? filteredPartners.length + chartColumns.reduce((sum, group) => sum + group.employees.length, 0)
      : tableSections.reduce((sum, group) => sum + group.employees.length, 0);

  const departmentTotals = useMemo(() => {
    const rows: { name: string; count: number }[] = [];
    if (partners.length > 0) {
      rows.push({
        name: 'Partners',
        count: partners.filter(matchesLiveFilter).length,
      });
    }
    leadership.forEach((group) => {
      rows.push({
        name: group.name,
        count: group.employees.filter(matchesLiveFilter).length,
      });
    });
    departments.forEach((group) => {
      rows.push({
        name: group.name,
        count: group.employees.filter(matchesLiveFilter).length,
      });
    });
    return rows;
  }, [partners, leadership, departments, matchesLiveFilter]);

  const filteredEmployeeTotal = useMemo(() => {
    if (selectedDepartments.length === 0) {
      return departmentTotals.reduce((sum, row) => sum + row.count, 0);
    }
    return departmentTotals
      .filter((row) => selectedDepartments.includes(row.name))
      .reduce((sum, row) => sum + row.count, 0);
  }, [departmentTotals, selectedDepartments]);

  const closeEmployeeModal = () => setSelectedEmployee(null);

  const openEmployeeWhatsApp = (employee: OrganizationEmployee) => {
    const mobile = pickWhatsAppNumber(employee);
    if (!mobile) {
      toast.error('No WhatsApp number for this employee');
      return;
    }
    const url = buildWhatsAppUrl(mobile);
    if (!url) {
      toast.error('Invalid WhatsApp number');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openEmployeeCall = (employee: OrganizationEmployee) => {
    const phone = pickCallNumber(employee);
    if (!phone) {
      toast.error('No phone number for this employee');
      return;
    }
    window.open(`tel:${phone}`, '_self');
  };

  const shareEmployeeBusinessCard = async (employee: OrganizationEmployee) => {
    const businessCardUrl = `${window.location.origin}/business-card/${employee.id}`;
    const shareTitle = `${getEmployeeDisplayLabel(employee)} — Business Card`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          url: businessCardUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(businessCardUrl);
      toast.success('Business card link copied to clipboard!');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Error sharing business card:', error);
      toast.error('Failed to share business card link');
    }
  };

  const openEmployeeEmail = (employee: OrganizationEmployee) => {
    const email = employee.email?.trim();
    if (!email) {
      toast.error('No email address for this employee');
      return;
    }
    window.open(`mailto:${email}`, '_blank');
  };

  const openEmployeeRmq = (employee: OrganizationEmployee) => {
    if (!employee.chatUserId) {
      toast.error('No RMQ account linked for this employee');
      return;
    }
    setRmqChatUserId(employee.chatUserId);
    setRmqOpen(true);
    closeEmployeeModal();
  };

  const handleExportToExcel = () => {
    if (tableSections.length === 0) {
      toast.error('No employees to export');
      return;
    }

    try {
      if (activeTab === 'chart') {
        exportOrganizationChartToExcel(tableSections);
      } else {
        exportOrganizationTableToExcel(tableSections);
      }
      toast.success('Exported to Excel');
    } catch (error) {
      console.error('Organization export failed:', error);
      toast.error('Failed to export to Excel');
    }
  };

  const tabButtonClass = (isActive: boolean) =>
    `inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors ${
      isActive
        ? 'bg-primary text-primary-content'
        : 'bg-white text-base-content/70 hover:text-base-content dark:bg-base-100'
    }`;

  return (
    <div className="organization-page-shell min-h-[calc(100dvh-3.5rem)] w-full max-w-none bg-[#ececec] px-3 py-4 dark:bg-base-200/40 md:px-5 md:py-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <BuildingOffice2Icon className="h-7 w-7" />
            <span className="text-sm font-semibold uppercase tracking-wide">Company</span>
          </div>
          <h1 className="text-2xl font-bold text-base-content md:text-3xl">
            Organization
            <span className="mt-1 block text-lg font-medium text-base-content/70 md:text-xl">
              Decker Pex &amp; Co. Law Office
            </span>
          </h1>
          <p className="mt-1 text-sm text-base-content/60">
            Chart view for structure, table view for full employee details.
          </p>
        </div>

        <label className="relative w-full max-w-md">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search"
            className="h-11 w-full rounded-full border border-gray-200/95 bg-white pl-11 pr-4 text-sm shadow-[0_8px_22px_rgba(17,24,39,0.08),0_1px_3px_rgba(17,24,39,0.06)] outline-none transition-shadow placeholder:text-base-content/40 focus:shadow-[0_12px_28px_rgba(17,24,39,0.12),0_2px_6px_rgba(17,24,39,0.08)] dark:border-base-300 dark:bg-base-100"
          />
        </label>
      </div>

      {!loading ? (
        <section className="mb-6">
          <div className="mb-4">
            <p className="text-sm text-base-content/55">
              {hasActiveFilters ? 'Filtered employees' : 'Active employees'}
            </p>
            <p className="text-4xl font-semibold tabular-nums tracking-tight text-base-content md:text-5xl">
              {filteredEmployeeTotal}
            </p>
          </div>

          {departmentTotals.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {departmentTotals.map((row) => {
                const isActive = selectedDepartments.includes(row.name);
                const isDimmed = selectedDepartments.length > 0 && !isActive;

                return (
                  <button
                    key={row.name}
                    type="button"
                    onClick={() => toggleDepartmentFilter(row.name)}
                    aria-pressed={isActive}
                    title={`Filter by ${row.name}`}
                    className={`flex min-w-[8.5rem] cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                      isActive
                        ? 'bg-primary text-primary-content ring-2 ring-primary/30'
                        : isDimmed
                          ? 'bg-white/70 text-base-content/55 dark:bg-base-100/70'
                          : 'bg-white dark:bg-base-100'
                    }`}
                  >
                    <span
                      className={`truncate text-sm font-medium ${
                        isActive ? 'text-primary-content' : 'text-base-content/80'
                      }`}
                    >
                      {row.name}
                    </span>
                    <span
                      className={`shrink-0 text-lg font-semibold tabular-nums ${
                        isActive ? 'text-primary-content' : 'text-base-content'
                      }`}
                    >
                      {row.count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div role="tablist" className="flex flex-wrap gap-2">
          <button
            type="button"
            role="tab"
            className={tabButtonClass(activeTab === 'chart')}
            onClick={() => setActiveTab('chart')}
            aria-selected={activeTab === 'chart'}
          >
            <Squares2X2Icon className="h-4 w-4" />
            Chart
          </button>
          <button
            type="button"
            role="tab"
            className={tabButtonClass(activeTab === 'table')}
            onClick={() => setActiveTab('table')}
            aria-selected={activeTab === 'table'}
          >
            <TableCellsIcon className="h-4 w-4" />
            Employees
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-outline btn-sm gap-2 bg-white font-normal shadow-sm dark:bg-base-100"
            onClick={handleExportToExcel}
            disabled={loading || totalVisible === 0}
            title="Export to Excel"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Export to Excel
          </button>

          <div className="dropdown dropdown-end">
            <label
              tabIndex={0}
              className="btn btn-outline btn-sm gap-2 bg-white font-normal shadow-sm dark:bg-base-100"
              aria-label="Filter by department"
            >
              <FunnelIcon className="h-4 w-4" />
              <span>
                {selectedDepartments.length === 0
                  ? 'All departments'
                  : `${selectedDepartments.length} department${selectedDepartments.length === 1 ? '' : 's'}`}
              </span>
              <ChevronDownIcon className="h-4 w-4 opacity-60" />
            </label>
            <div
              tabIndex={0}
              className="dropdown-content z-20 mt-2 w-72 rounded-xl border border-base-200 bg-base-100 p-2 shadow-xl"
            >
              <button
                type="button"
                className={`btn btn-ghost btn-sm mb-1 w-full justify-start ${selectedDepartments.length === 0 ? 'font-semibold text-primary' : ''}`}
                onClick={() => setSelectedDepartments([])}
              >
                All departments
              </button>
              <div className="max-h-64 overflow-y-auto">
                {departmentOptions.map((name) => {
                  const checked = selectedDepartments.includes(name);
                  return (
                    <label
                      key={name}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-base-200/60"
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm checkbox-primary"
                        checked={checked}
                        onChange={() => toggleDepartmentFilter(name)}
                      />
                      <span className="text-sm">{name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="dropdown dropdown-end">
            <label
              tabIndex={0}
              className="btn btn-outline btn-sm gap-2 bg-white font-normal shadow-sm dark:bg-base-100"
              aria-label="Filter by live status"
            >
              <FunnelIcon className="h-4 w-4" />
              <span>{liveFilter === 'all' ? 'Live status' : LIVE_FILTER_LABELS[liveFilter]}</span>
              <ChevronDownIcon className="h-4 w-4 opacity-60" />
            </label>
            <div
              tabIndex={0}
              className="dropdown-content z-20 mt-2 w-56 rounded-xl border border-base-200 bg-base-100 p-2 shadow-xl"
            >
              {LIVE_STATUS_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`btn btn-ghost btn-sm mb-0.5 w-full justify-start ${liveFilter === option.value ? 'font-semibold text-primary' : ''}`}
                  onClick={() => setLiveFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSelectedDepartments([]);
                setLiveFilter('all');
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      ) : totalVisible === 0 ? (
        <div className="rounded-2xl bg-white px-6 py-12 text-center text-base-content/60 shadow-sm dark:bg-base-100">
          No employees match your search or filters.
        </div>
      ) : activeTab === 'chart' ? (
        <OrganizationChart
          partners={filteredPartners}
          columns={chartColumns}
          onSelectEmployee={setSelectedEmployee}
          onOpenRmq={openEmployeeRmq}
          onOpenWhatsApp={openEmployeeWhatsApp}
          onShareBusinessCard={shareEmployeeBusinessCard}
        />
      ) : (
        <OrganizationEmployeeTable
          sections={tableSections}
          onSelectEmployee={setSelectedEmployee}
        />
      )}

      {selectedEmployee ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={closeEmployeeModal}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-base-100"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative">
              <EmployeeModalHero
                employee={selectedEmployee}
                name={getEmployeeDisplayLabel(selectedEmployee)}
                roleLabel={getBonusesRoleDisplayName(selectedEmployee.bonuses_role) || null}
                canRmq={Boolean(selectedEmployee.chatUserId)}
                onRmqClick={() => openEmployeeRmq(selectedEmployee)}
              />
              <button
                type="button"
                onClick={closeEmployeeModal}
                className="btn btn-circle btn-sm absolute right-3 top-3 z-10 border-0 bg-white/90 text-base-content shadow-md hover:bg-white"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-4">
              <p className="mb-4 truncate text-center text-sm text-base-content/55">
                {selectedEmployee.email}
              </p>

            <div className="mb-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => openEmployeeWhatsApp(selectedEmployee)}
                disabled={!pickWhatsAppNumber(selectedEmployee)}
                className={`${OVAL_CONTACT_BTN} bg-[#25D366] text-white shadow-sm`}
                title={pickWhatsAppNumber(selectedEmployee) ? 'WhatsApp' : 'No WhatsApp number'}
              >
                <FaWhatsapp className="h-4 w-4 shrink-0" aria-hidden />
                WhatsApp
              </button>

              <button
                type="button"
                onClick={() => openEmployeeCall(selectedEmployee)}
                disabled={!pickCallNumber(selectedEmployee)}
                className={`${OVAL_CONTACT_BTN} border border-base-content/15 bg-base-200/70 text-base-content`}
                title={pickCallNumber(selectedEmployee) ? 'Call' : 'No phone number'}
              >
                <PhoneIcon className="h-4 w-4 shrink-0" aria-hidden />
                Call
              </button>

              <button
                type="button"
                onClick={() => openEmployeeEmail(selectedEmployee)}
                disabled={!selectedEmployee.email?.trim()}
                className={`${OVAL_CONTACT_BTN} border border-[#C7E0F4] bg-[#EAF3FC] text-[#0078D4]`}
                title={selectedEmployee.email?.trim() ? 'Email' : 'No email address'}
              >
                <EnvelopeIcon className="h-4 w-4 shrink-0" aria-hidden />
                Email
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  navigate(`/my-profile/${selectedEmployee.id}`);
                  closeEmployeeModal();
                }}
                className="btn btn-outline w-full justify-start gap-3"
              >
                <UserIcon className="h-6 w-6" />
                <div className="text-left">
                  <div className="font-semibold">View profile</div>
                  <div className="text-xs opacity-60">Full profile page</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  navigate(`/business-card/${selectedEmployee.id}`);
                  closeEmployeeModal();
                }}
                className="btn btn-outline w-full justify-start gap-3"
              >
                <IdentificationIcon className="h-6 w-6" />
                <div className="text-left">
                  <div className="font-semibold">View business card</div>
                  <div className="text-xs opacity-60">Digital business card</div>
                </div>
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      <RMQMessagesPage
        isOpen={rmqOpen}
        initialUserId={rmqChatUserId || undefined}
        onClose={() => {
          setRmqOpen(false);
          setRmqChatUserId(null);
        }}
      />
    </div>
  );
};

export default OrganizationPage;
