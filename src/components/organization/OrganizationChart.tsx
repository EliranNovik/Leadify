import React, { useMemo, useState } from 'react';
import { FaWhatsapp } from 'react-icons/fa';
import { ChatBubbleLeftRightIcon, ShareIcon } from '@heroicons/react/24/outline';
import {
  getBonusesRoleDisplayName,
  getEmployeeDisplayLabel,
  isDepartmentManagerBonusRole,
  type OrganizationDepartmentGroup,
  type OrganizationEmployee,
} from '../../lib/organizationEmployees';
import { getSalaryEmployeeInitials, salaryAvatarGradientStyle } from '../../lib/employeeSalaries';
import OrganizationAvailabilityBadge from './OrganizationAvailabilityBadge';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function orderEmployeesForSection(employees: OrganizationEmployee[]): OrganizationEmployee[] {
  const managers = employees.filter((employee) => isDepartmentManagerBonusRole(employee.bonuses_role));
  const team = employees.filter((employee) => !isDepartmentManagerBonusRole(employee.bonuses_role));
  return [...managers, ...team];
}

const ICON_ACTION_BTN =
  'inline-flex h-9 w-9 items-center justify-center text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35 md:h-8 md:w-8';

const ChartEmployeeCard: React.FC<{
  employee: OrganizationEmployee;
  onSelect: (employee: OrganizationEmployee) => void;
  onOpenRmq: (employee: OrganizationEmployee) => void;
  onOpenWhatsApp: (employee: OrganizationEmployee) => void;
  onShareBusinessCard: (employee: OrganizationEmployee) => void;
  className?: string;
}> = ({ employee, onSelect, onOpenRmq, onOpenWhatsApp, onShareBusinessCard, className = '' }) => {
  const [imageError, setImageError] = useState(false);
  const label = getEmployeeDisplayLabel(employee);
  const roleLabel = getBonusesRoleDisplayName(employee.bonuses_role);
  const hasPhoto = Boolean(employee.photo_url && !imageError);
  const canRmq = Boolean(employee.chatUserId);
  const canWhatsApp = Boolean(employee.mobile?.trim());

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(employee)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(employee);
        }
      }}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-[20px] bg-white text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:bg-base-100 md:rounded-[18px] ${className}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#ececec] dark:bg-base-300/40">
        {hasPhoto ? (
          <img
            src={employee.photo_url!}
            alt={label}
            className="h-full w-full object-cover object-[center_22%] transition-transform duration-300 group-hover:scale-[1.03]"
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-4xl font-bold text-white md:text-3xl"
            style={salaryAvatarGradientStyle(employee.id, label)}
            aria-hidden
          >
            {getSalaryEmployeeInitials(label) || getInitials(label)}
          </div>
        )}
        {(employee.isClockedIn || employee.unavailabilityType) ? (
          <OrganizationAvailabilityBadge
            isClockedIn={employee.isClockedIn}
            unavailabilityType={employee.unavailabilityType}
            unavailabilityStartDate={employee.unavailabilityStartDate}
            unavailabilityEndDate={employee.unavailabilityEndDate}
            className="absolute left-2 top-2 z-10"
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-16 bg-gradient-to-l from-black/45 via-black/20 to-transparent md:w-14"
          aria-hidden
        />
        <div className="absolute right-2.5 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2.5 md:right-2 md:gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRmq(employee);
            }}
            disabled={!canRmq}
            className={ICON_ACTION_BTN}
            title={canRmq ? 'RMQ message' : 'No RMQ account linked'}
            aria-label={canRmq ? 'RMQ message' : 'No RMQ account linked'}
          >
            <ChatBubbleLeftRightIcon className="h-7 w-7 md:h-6 md:w-6" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenWhatsApp(employee);
            }}
            disabled={!canWhatsApp}
            className={ICON_ACTION_BTN}
            title={canWhatsApp ? 'WhatsApp' : 'No WhatsApp number'}
            aria-label={canWhatsApp ? 'WhatsApp' : 'No WhatsApp number'}
          >
            <FaWhatsapp className="h-[1.5rem] w-[1.5rem] md:h-[1.35rem] md:w-[1.35rem]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onShareBusinessCard(employee);
            }}
            className={ICON_ACTION_BTN}
            title="Share business card"
            aria-label="Share business card"
          >
            <ShareIcon className="h-7 w-7 md:h-6 md:w-6" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex min-h-[5rem] flex-col items-center justify-center px-3.5 py-3.5 text-center md:min-h-[4.25rem] md:px-3 md:py-3">
        <p className="organization-chart-name line-clamp-2 w-full text-base font-semibold leading-snug md:text-[0.9rem]">
          {label}
        </p>
        {roleLabel ? (
          <p className="organization-chart-role mt-1 line-clamp-2 w-full text-sm leading-snug md:text-sm">
            {roleLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
};

const ChartSection: React.FC<{
  section: OrganizationDepartmentGroup;
  isFirst?: boolean;
  onSelectEmployee: (employee: OrganizationEmployee) => void;
  onOpenRmq: (employee: OrganizationEmployee) => void;
  onOpenWhatsApp: (employee: OrganizationEmployee) => void;
  onShareBusinessCard: (employee: OrganizationEmployee) => void;
}> = ({ section, isFirst = false, onSelectEmployee, onOpenRmq, onOpenWhatsApp, onShareBusinessCard }) => {
  const employees = useMemo(
    () => orderEmployeesForSection(section.employees),
    [section.employees],
  );

  return (
    <section className={isFirst ? '' : 'mt-8'}>
      <div className="mb-3 flex items-center justify-between gap-3 px-0.5">
        <h3 className="min-w-0 truncate text-base font-semibold text-base-content md:text-lg">
          {section.name}
        </h3>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-base-content/55">
          {section.employees.length}
        </span>
      </div>

      <div className="organization-chart-mobile-row -mx-1 flex gap-3.5 overflow-x-auto px-1 pr-3 pb-1 pt-0.5 snap-x snap-mandatory md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:px-0 md:pr-0 md:pb-0 md:pt-0 md:snap-none lg:grid-cols-5 xl:grid-cols-6">
        {employees.map((employee) => (
          <ChartEmployeeCard
            key={employee.id}
            employee={employee}
            onSelect={onSelectEmployee}
            onOpenRmq={onOpenRmq}
            onOpenWhatsApp={onOpenWhatsApp}
            onShareBusinessCard={onShareBusinessCard}
            className="w-[min(78vw,16.25rem)] shrink-0 snap-start md:w-full md:shrink"
          />
        ))}
      </div>
    </section>
  );
};

type OrganizationChartProps = {
  partners: OrganizationEmployee[];
  columns: OrganizationDepartmentGroup[];
  onSelectEmployee: (employee: OrganizationEmployee) => void;
  onOpenRmq: (employee: OrganizationEmployee) => void;
  onOpenWhatsApp: (employee: OrganizationEmployee) => void;
  onShareBusinessCard: (employee: OrganizationEmployee) => void;
};

const CHART_STYLES = `
  .organization-chart-shell .organization-chart-name {
    color: #111827 !important;
  }

  .organization-chart-shell .organization-chart-role {
    color: #6b7280 !important;
  }

  html.dark .organization-chart-shell .organization-chart-name {
    color: #f3f4f6 !important;
  }

  html.dark .organization-chart-shell .organization-chart-role {
    color: #a1a8b3 !important;
  }

  .organization-chart-shell .organization-chart-mobile-row {
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: rgba(17, 24, 39, 0.22) transparent;
  }

  .organization-chart-shell .organization-chart-mobile-row::-webkit-scrollbar {
    height: 6px;
  }

  .organization-chart-shell .organization-chart-mobile-row::-webkit-scrollbar-track {
    background: transparent;
  }

  .organization-chart-shell .organization-chart-mobile-row::-webkit-scrollbar-thumb {
    background: rgba(17, 24, 39, 0.18);
    border-radius: 9999px;
  }

  @media (min-width: 768px) {
    .organization-chart-shell .organization-chart-mobile-row {
      scrollbar-width: auto;
    }
  }
`;

const OrganizationChart: React.FC<OrganizationChartProps> = ({
  partners,
  columns,
  onSelectEmployee,
  onOpenRmq,
  onOpenWhatsApp,
  onShareBusinessCard,
}) => {
  const sections = useMemo(() => {
    const rows: OrganizationDepartmentGroup[] = [];
    if (partners.length > 0) {
      rows.push({ name: 'Partners', employees: partners });
    }
    rows.push(...columns);
    return rows;
  }, [partners, columns]);

  if (sections.length === 0) {
    return (
      <div className="rounded-2xl bg-white px-6 py-12 text-center text-base-content/50 shadow-sm dark:bg-base-100">
        No organization data to display.
      </div>
    );
  }

  return (
    <div className="organization-chart-shell">
      {sections.map((section, index) => (
        <ChartSection
          key={section.name}
          section={section}
          isFirst={index === 0}
          onSelectEmployee={onSelectEmployee}
          onOpenRmq={onOpenRmq}
          onOpenWhatsApp={onOpenWhatsApp}
          onShareBusinessCard={onShareBusinessCard}
        />
      ))}
      <style>{CHART_STYLES}</style>
    </div>
  );
};

export default OrganizationChart;
