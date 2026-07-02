import * as XLSX from 'xlsx';
import { unavailabilityTypeShortLabel, vacationPeriodLabel } from './employeeUnavailabilities';
import {
  getBonusesRoleDisplayName,
  getEmployeeDisplayLabel,
  isDepartmentManagerBonusRole,
  type OrganizationDepartmentGroup,
  type OrganizationEmployee,
} from './organizationEmployees';

function formatDateForFilename(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatLiveStatus(employee: OrganizationEmployee): string {
  if (employee.isClockedIn) return 'Available';
  if (employee.unavailabilityType === 'vacation' && employee.unavailabilityStartDate) {
    const period = vacationPeriodLabel(
      employee.unavailabilityStartDate,
      employee.unavailabilityEndDate,
    );
    return `Vacation (${period})`;
  }
  if (employee.unavailabilityType) {
    return unavailabilityTypeShortLabel(employee.unavailabilityType);
  }
  return 'No';
}

function buildChartRows(sections: OrganizationDepartmentGroup[]) {
  return sections.flatMap((section) =>
    section.employees.map((employee) => ({
      Section: section.name,
      Employee: getEmployeeDisplayLabel(employee),
      Role: getBonusesRoleDisplayName(employee.bonuses_role) || '',
      'Department manager': isDepartmentManagerBonusRole(employee.bonuses_role) ? 'Yes' : 'No',
      'Field roles': employee.fieldRoles.length > 0 ? employee.fieldRoles.join(', ') : '',
      Phone: employee.phone || '',
      Ext: employee.phone_ext || '',
      Mobile: employee.mobile || '',
      Email: employee.email || '',
    })),
  );
}

function buildTableRows(sections: OrganizationDepartmentGroup[]) {
  return sections.flatMap((section) =>
    section.employees.map((employee) => ({
      Section: section.name,
      Employee: getEmployeeDisplayLabel(employee),
      Role: getBonusesRoleDisplayName(employee.bonuses_role) || '',
      Live: formatLiveStatus(employee),
      'Field roles': employee.fieldRoles.length > 0 ? employee.fieldRoles.join(', ') : '',
      Phone: employee.phone || '',
      Ext: employee.phone_ext || '',
      Mobile: employee.mobile || '',
      Email: employee.email || '',
    })),
  );
}

function writeOrganizationWorkbook(
  rows: Record<string, string>[],
  sheetName: string,
  filenamePrefix: string,
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filenamePrefix}_${formatDateForFilename()}.xlsx`);
}

export function exportOrganizationChartToExcel(sections: OrganizationDepartmentGroup[]): void {
  const rows = buildChartRows(sections);
  if (rows.length === 0) return;
  writeOrganizationWorkbook(rows, 'Organization Chart', 'organization_chart');
}

export function exportOrganizationTableToExcel(sections: OrganizationDepartmentGroup[]): void {
  const rows = buildTableRows(sections);
  if (rows.length === 0) return;
  writeOrganizationWorkbook(rows, 'Employees', 'organization_employees');
}
