import React from 'react';
import {
  AcademicCapIcon,
  ArchiveBoxIcon,
  BanknotesIcon,
  BriefcaseIcon,
  BuildingOffice2Icon,
  CalculatorIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  CodeBracketIcon,
  CurrencyDollarIcon,
  MegaphoneIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  ScaleIcon,
  SparklesIcon,
  Squares2X2Icon,
  StarIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { getBonusesRoleDisplayName } from '../../lib/organizationEmployees';

type IconType = React.ElementType;

function roleIconForCode(roleCode: string | null | undefined): IconType {
  const key = (roleCode || '').trim().toLowerCase();
  switch (key) {
    case 'c':
    case 'lawyer':
      return CurrencyDollarIcon;
    case 's':
      return CalendarDaysIcon;
    case 'h':
      return ClipboardDocumentListIcon;
    case 'e':
      return AcademicCapIcon;
    case 'z':
    case 'm':
      return BriefcaseIcon;
    case 'dm':
      return BuildingOffice2Icon;
    case 'pm':
      return ClipboardDocumentCheckIcon;
    case 'p':
    case 'partners':
      return StarIcon;
    case 'se':
      return PencilSquareIcon;
    case 'b':
      return CalculatorIcon;
    case 'dv':
      return CodeBracketIcon;
    case 'ma':
      return MegaphoneIcon;
    case 'f':
      return BanknotesIcon;
    case 'col':
      return ArchiveBoxIcon;
    case 'd':
      return Squares2X2Icon;
    case 'n':
      return NoSymbolIcon;
    default:
      return key.includes('lawyer') || key.includes('scale')
        ? ScaleIcon
        : key.includes('manager')
          ? UserGroupIcon
          : key.includes('partner')
            ? SparklesIcon
            : UsersIcon;
  }
}

export type HrBonusesRoleBadgeProps = {
  roleCode: string | null | undefined;
  className?: string;
};

const HrBonusesRoleBadge: React.FC<HrBonusesRoleBadgeProps> = ({ roleCode, className = '' }) => {
  const label = getBonusesRoleDisplayName(roleCode);
  if (!label) {
    return <span className="text-gray-300">—</span>;
  }

  const Icon = roleIconForCode(roleCode);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800 whitespace-nowrap ${className}`.trim()}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      {label}
    </span>
  );
};

export default HrBonusesRoleBadge;
