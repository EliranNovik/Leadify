import React, { useState } from 'react';
import {
  getBonusesRoleDisplayName,
  getEmployeeDisplayLabel,
  type OrganizationDepartmentGroup,
  type OrganizationEmployee,
} from '../../lib/organizationEmployees';
import { getSalaryEmployeeInitials, salaryAvatarGradientStyle } from '../../lib/employeeSalaries';
import OrganizationAvailabilityBadge from './OrganizationAvailabilityBadge';

const COLUMN_COUNT = 7;

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const TableAvatar: React.FC<{ employee: OrganizationEmployee }> = ({ employee }) => {
  const [imageError, setImageError] = useState(false);
  const label = getEmployeeDisplayLabel(employee);

  if (!employee.photo_url || imageError) {
    return (
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-base-200"
        style={salaryAvatarGradientStyle(employee.id, label)}
        aria-hidden
      >
        {getSalaryEmployeeInitials(label) || getInitials(label)}
      </span>
    );
  }

  return (
    <img
      src={employee.photo_url}
      alt={label}
      className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-base-200"
      onError={() => setImageError(true)}
    />
  );
};

const WRAP_CELL =
  'organization-cell-wrap max-w-0 text-left text-xs leading-snug md:text-sm';
const COMPACT_CELL = 'whitespace-nowrap text-left text-xs md:text-sm';
const ICON_CELL = 'text-center text-xs md:text-sm';
const LIVE_CELL = `${ICON_CELL} align-middle whitespace-normal`;

const LiveStatusBadge: React.FC<{ employee: OrganizationEmployee }> = ({ employee }) => (
  <OrganizationAvailabilityBadge
    isClockedIn={employee.isClockedIn}
    unavailabilityType={employee.unavailabilityType}
    unavailabilityStartDate={employee.unavailabilityStartDate}
    unavailabilityEndDate={employee.unavailabilityEndDate}
    className="mx-auto"
    showUnavailableIcon
    variant="table"
  />
);

const TABLE_COLGROUP = (
  <colgroup>
    <col className="w-[21%]" />
    <col className="w-[11%]" />
    <col className="w-[12%]" />
    <col className="w-[10%]" />
    <col className="w-[6%]" />
    <col className="w-[10%]" />
    <col className="w-[30%]" />
  </colgroup>
);

const TABLE_HEADERS = (
  <tr>
    <th className="whitespace-nowrap text-left text-xs font-semibold md:text-sm">Employee</th>
    <th className="whitespace-nowrap text-center text-xs font-semibold md:text-sm">Live</th>
    <th className="whitespace-nowrap text-left text-xs font-semibold md:text-sm">Field roles</th>
    <th className="whitespace-nowrap text-left text-xs font-semibold md:text-sm">Phone</th>
    <th className="whitespace-nowrap text-left text-xs font-semibold md:text-sm">Ext</th>
    <th className="whitespace-nowrap text-left text-xs font-semibold md:text-sm">Mobile</th>
    <th className="whitespace-nowrap text-left text-xs font-semibold md:text-sm">Email</th>
  </tr>
);

const SectionTitleRow: React.FC<{ name: string; count: number; isFirst?: boolean }> = ({
  name,
  count,
  isFirst = false,
}) => (
  <tr className="organization-section-row">
    <td colSpan={COLUMN_COUNT}>
      <div className={`flex items-center justify-between gap-3 ${isFirst ? 'pt-0' : 'pt-4'}`}>
        <h3 className="min-w-0 truncate text-base font-semibold text-base-content md:text-lg">{name}</h3>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-base-content/55">{count}</span>
      </div>
    </td>
  </tr>
);

const EmployeeRows: React.FC<{
  employees: OrganizationEmployee[];
  onSelectEmployee: (employee: OrganizationEmployee) => void;
}> = ({ employees, onSelectEmployee }) => (
  <>
    {employees.map((employee) => {
      const roleLabel = getBonusesRoleDisplayName(employee.bonuses_role);

      return (
      <tr
        key={employee.id}
        className="organization-data-row cursor-pointer"
        onClick={() => onSelectEmployee(employee)}
      >
        <td className={WRAP_CELL}>
          <div className="flex min-w-0 items-start gap-3">
            <TableAvatar employee={employee} />
            <div className="min-w-0">
              <div className="organization-employee-name line-clamp-2 break-words">
                {getEmployeeDisplayLabel(employee)}
              </div>
              {roleLabel ? (
                <div className="organization-employee-role mt-0.5 line-clamp-2 break-words">
                  {roleLabel}
                </div>
              ) : null}
            </div>
          </div>
        </td>
        <td className={LIVE_CELL}>
          <LiveStatusBadge employee={employee} />
        </td>
        <td className={WRAP_CELL}>
          <span className="line-clamp-2 break-words">
            {employee.fieldRoles.length > 0 ? employee.fieldRoles.join(', ') : '—'}
          </span>
        </td>
        <td className={COMPACT_CELL}>{employee.phone || '—'}</td>
        <td className={COMPACT_CELL}>{employee.phone_ext || '—'}</td>
        <td className={COMPACT_CELL}>{employee.mobile || '—'}</td>
        <td className={WRAP_CELL}>
          <span className="line-clamp-2 break-all">{employee.email || '—'}</span>
        </td>
      </tr>
      );
    })}
  </>
);

const ORGANIZATION_TABLE_STYLES = `
  .organization-employee-table-shell table {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    border-collapse: separate !important;
    border-spacing: 0 10px !important;
    table-layout: fixed !important;
  }

  .organization-employee-table-shell .table tbody tr.organization-data-row:hover {
    background-color: transparent !important;
  }

  html.dark .organization-employee-table-shell .table tbody tr.organization-data-row:hover {
    background-color: transparent !important;
  }

  .organization-employee-table-shell table tbody tr.organization-data-row {
    background: transparent !important;
    border-radius: 18px !important;
    overflow: hidden !important;
    box-shadow: none !important;
  }

  .organization-employee-table-shell table tbody tr.organization-data-row td {
    border: none !important;
    border-bottom: none !important;
    background: #ffffff !important;
    box-shadow: none !important;
    vertical-align: middle;
    padding-top: 0.65rem !important;
    padding-bottom: 0.65rem !important;
  }

  .organization-employee-table-shell .organization-cell-wrap {
    white-space: normal !important;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .organization-employee-table-shell .organization-employee-name {
    color: #111827 !important;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25;
  }

  @media (min-width: 768px) {
    .organization-employee-table-shell .organization-employee-name {
      font-size: 0.875rem;
    }
  }

  .organization-employee-table-shell .organization-employee-role {
    color: #6b7280 !important;
    font-size: 0.75rem;
    font-weight: 400;
    line-height: 1.25;
  }

  @media (min-width: 768px) {
    .organization-employee-table-shell .organization-employee-role {
      font-size: 0.875rem;
    }
  }

  html.dark .organization-employee-table-shell .organization-employee-name {
    color: #f3f4f6 !important;
  }

  html.dark .organization-employee-table-shell .organization-employee-role {
    color: #a1a8b3 !important;
  }

  .organization-employee-table-shell table tbody tr.organization-data-row td:first-child {
    border-top-left-radius: 18px !important;
    border-bottom-left-radius: 18px !important;
    padding-left: 1.1rem !important;
  }

  .organization-employee-table-shell table tbody tr.organization-data-row td:last-child {
    border-top-right-radius: 18px !important;
    border-bottom-right-radius: 18px !important;
    padding-right: 1.1rem !important;
  }

  .organization-employee-table-shell table tbody tr.organization-data-row:hover td {
    background: #f1f5f9 !important;
  }

  html.dark .organization-employee-table-shell table tbody tr.organization-data-row td {
    background: rgba(255, 255, 255, 0.06) !important;
  }

  html.dark .organization-employee-table-shell table tbody tr.organization-data-row:hover td {
    background: rgba(255, 255, 255, 0.10) !important;
  }

  .organization-employee-table-shell table tbody tr.organization-section-row td {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    box-shadow: none !important;
    border-radius: 0 !important;
  }

  .organization-employee-table-shell table tbody tr.organization-section-row:hover td {
    background: transparent !important;
  }

  .organization-employee-table-shell table thead,
  .organization-employee-table-shell table thead tr,
  .organization-employee-table-shell table thead th {
    background-color: transparent !important;
    background-image: none !important;
    border-bottom: none !important;
    vertical-align: bottom;
  }

  .organization-employee-table-shell table thead th:first-child {
    padding-left: 1.1rem !important;
  }

  .organization-employee-table-shell table thead th:last-child {
    padding-right: 1.1rem !important;
  }
`;

type OrganizationEmployeeTableProps = {
  sections: OrganizationDepartmentGroup[];
  onSelectEmployee: (employee: OrganizationEmployee) => void;
};

const OrganizationEmployeeTable: React.FC<OrganizationEmployeeTableProps> = ({
  sections,
  onSelectEmployee,
}) => {
  if (sections.length === 0) {
    return (
      <div className="rounded-2xl bg-white px-6 py-12 text-center text-base-content/50 shadow-sm dark:bg-base-100">
        No employees found
      </div>
    );
  }

  return (
    <div className="organization-employee-table-shell">
      <div className="overflow-x-auto">
        <div className="w-full min-w-[720px] py-1">
          <table className="table w-full">
            {TABLE_COLGROUP}
            <thead>{TABLE_HEADERS}</thead>
            <tbody>
              {sections.map((section, index) => (
                <React.Fragment key={section.name}>
                  <SectionTitleRow
                    name={section.name}
                    count={section.employees.length}
                    isFirst={index === 0}
                  />
                  <EmployeeRows employees={section.employees} onSelectEmployee={onSelectEmployee} />
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{ORGANIZATION_TABLE_STYLES}</style>
    </div>
  );
};

export default OrganizationEmployeeTable;
