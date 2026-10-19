import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { toast } from 'react-hot-toast';
import { supabase, isAuthError, tryRefreshThenExpire } from '../../lib/supabase';
import { usePersistedFilters, usePersistedState } from '../../hooks/usePersistedState';
import { getStageName, getStageColour, fetchStageNames } from '../../lib/stageUtils';
import { convertToNIS } from '../../lib/currencyConversion';
import { Bars3Icon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { PIPELINE_TABLE_SHELL } from '../pipeline/pipelineUi';
import FloatingFilterBar from './FloatingFilterBar';
import ReassignNotifyEmailModal from './ReassignNotifyEmailModal';
import { buildHelperHandlerRow, type LeadHelperHandlerRow } from '../../lib/leadHelperHandlers';
import {
    MailboxNotConnectedError,
    sendReassignNotifications,
    type ReassignNotifyLanguage,
    type ReassignNotifyLead,
    type ReassignNotifyRole,
} from '../../lib/reassignNotificationEmail';

const isUnassignedHandlerValue = (value: string | null | undefined): boolean => {
    if (!value) return true;
    const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, ' ');
    return normalized === '' || normalized === '---' || normalized === '--' || normalized === 'not assigned';
};

/** Persisted filter value: this role must have no assignee (null / placeholders / legacy text). */
const REASSIGN_ROLE_LABELS: { [key: string]: string } = {
    scheduler: 'Scheduler',
    closer: 'Closer',
    meetingManager: 'Meeting Manager',
    handler: 'Handler',
    helper: 'Helper',
    expert: 'Expert',
    retainer_handler: 'Retention Handler',
    helper_handler: 'Helper Handler',
    client_support: 'Client Support',
};

/**
 * Roles whose reassignment the client is told about by email, and which therefore get the
 * confirmation modal rather than a plain confirm dialog. The rest are internal and have no
 * client-facing template.
 */
const REASSIGN_NOTIFY_ROLE_BY_KEY: { [key: string]: ReassignNotifyRole } = {
    handler: 'handler',
    retainer_handler: 'retainer_handler',
};

/** A report row reduced to what the notification needs: who to write to and in which language. */
const toReassignNotifyLead = (lead: any): ReassignNotifyLead => ({
    id: lead.id?.toString() || '',
    leadType: lead.lead_type === 'legacy' ? 'legacy' : 'new',
    leadNumber: String(lead.display_lead_number || lead.lead_number || lead.id || ''),
    name: String(lead.name || ''),
    categoryId: lead.category_id ?? null,
    // Already resolved to a language name ('EN', 'HE', …) when the results were built.
    language: lead.language ?? null,
});

const REASSIGN_ROLE_FILTER_NONE = '__REASSIGN_ROLE_NONE__';
const REASSIGN_ROLE_NONE_LABEL = 'NONE (unassigned)';

const isReassignRoleNoneFilter = (value: string | null | undefined): boolean =>
    value === REASSIGN_ROLE_FILTER_NONE;

const leadHasCaseHandler = (lead: any): boolean => {
    if (lead.lead_type === 'legacy') {
        const id = lead.case_handler_id;
        return id != null && id !== '' && Number(id) !== 0;
    }
    return !isUnassignedHandlerValue(lead.handler);
};

const leadHasRetentionHandler = (lead: any): boolean => {
    const id = lead.retainer_handler_id;
    if (id == null || id === '') return false;
    const n = Number(id);
    if (!Number.isNaN(n)) return n !== 0;
    return String(id).trim() !== '';
};

const getRetentionEmployeeForLead = (lead: any, employeesList: { id: number; display_name: string; photo_url?: string | null }[]) => {
    const id = lead.retainer_handler_id;
    if (id == null || id === '') return null;
    const n = typeof id === 'number' ? id : parseInt(String(id), 10);
    if (Number.isNaN(n) || n === 0) return null;
    return employeesList.find(e => e.id === n) ?? null;
};

/** PostgREST `.or()` fragment for new-leads text columns that store a person name or placeholders. */
const newLeadsUnassignedTextRoleOr = (column: string): string =>
    `${column}.is.null,${column}.eq.---,${column}.eq.--,${column}.eq.,${column}.eq.Not assigned,${column}.eq.not_assigned,${column}.eq.Not_assigned`;

type ReassignRoleFilterTab =
    | 'scheduler'
    | 'closer'
    | 'meetingManager'
    | 'handler'
    | 'helper'
    | 'expert'
    | 'retainer_handler'
    | 'helper_handler'
    | 'client_support';

/**
 * A lead's `active_handler_type`: which of its two handlers currently owns the case. This is the
 * split MyCasesPage is built around — its Active table is type 2, its Non-Active table is type 1.
 */
const ACTIVE_HANDLER_TYPE = { handler: 2, retention: 1 } as const;
type ActiveHandlerFilterValue = '' | keyof typeof ACTIVE_HANDLER_TYPE;

/**
 * The Handler and Retention tabs both filter on that one column, so they are two views of a single
 * setting rather than two filters: "active" on the Handler tab is the same condition as
 * "non-active" on the Retention tab. Keeping one value is what stops a user asking for leads where
 * both handlers are the active one, which no lead can be.
 */
const activeHandlerFilterOptions = (
    tab: 'handler' | 'retainer_handler',
): Array<{ value: ActiveHandlerFilterValue; label: string }> =>
    tab === 'handler'
        ? [
            { value: '', label: 'Any' },
            { value: 'handler', label: 'Active handler' },
            { value: 'retention', label: 'Non-active handler' },
        ]
        : [
            { value: '', label: 'Any' },
            { value: 'retention', label: 'Active retention' },
            { value: 'handler', label: 'Non-active retention' },
        ];

/** Shared look for the small pill filters sitting under a role's employee picker. */
const reassignPillClass = (selected: boolean): string =>
    `btn btn-sm rounded-full normal-case text-sm ${selected ? 'btn-primary' : 'btn-ghost btn-outline border-base-300'}`;

const ReassignActiveHandlerFilter: React.FC<{
    tab: 'handler' | 'retainer_handler';
    value: ActiveHandlerFilterValue;
    onChange: (next: ActiveHandlerFilterValue) => void;
}> = ({ tab, value, onChange }) => (
    <div className="mt-3">
        <div role="group" aria-label="Active handler" className="flex flex-wrap gap-1">
            {activeHandlerFilterOptions(tab).map(({ value: optionValue, label }) => (
                <button
                    key={optionValue || 'any'}
                    type="button"
                    aria-pressed={value === optionValue}
                    className={reassignPillClass(value === optionValue)}
                    onClick={() => onChange(optionValue)}
                >
                    {label}
                </button>
            ))}
        </div>
        <label className="block text-sm font-medium mt-2">Active state:</label>
    </div>
);

/** Black or white, whichever stays legible on the given background. */
const getContrastingTextColor = (hexColor?: string | null) => {
    if (!hexColor) return '#111827';
    let sanitized = hexColor.trim();
    if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
    if (sanitized.length === 3) {
        sanitized = sanitized.split('').map(char => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
        return '#111827';
    }
    const r = parseInt(sanitized.slice(0, 2), 16) / 255;
    const g = parseInt(sanitized.slice(2, 4), 16) / 255;
    const b = parseInt(sanitized.slice(4, 6), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? '#111827' : '#ffffff';
};

/** Stage pill in the stage's own colour. Shared by the card and list views. */
const ReassignStageBadge: React.FC<{ stage: string | number | null | undefined }> = ({ stage }) => {
    if (!stage && stage !== 0) return <span className="badge badge-outline">No Stage</span>;

    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColour = getStageColour(stageStr);
    const backgroundColor = stageColour || '#3f28cd';

    return (
        <span
            className="badge stage-badge hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
            style={{
                backgroundColor,
                borderColor: backgroundColor,
                color: stageColour ? getContrastingTextColor(stageColour) : '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'inline-block',
            }}
            title={stageName}
        >
            {stageName}
        </span>
    );
};

/** An employee's photo, falling back to their initials. Shared by the card and list views. */
const ReassignRoleAvatar: React.FC<{
    name: string;
    photoUrl?: string | null;
    tone: 'primary' | 'secondary';
    className?: string;
}> = ({ name, photoUrl, tone, className = 'h-9 w-9 sm:h-10 sm:w-10' }) =>
    photoUrl ? (
        <img
            src={photoUrl}
            alt=""
            className={`${className} shrink-0 rounded-full object-cover`}
        />
    ) : (
        <div
            className={`${className} flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold sm:text-xs ${tone === 'primary' ? 'bg-primary/18 text-primary' : 'bg-secondary/18 text-secondary'}`}
        >
            {name
                .split(' ')
                .map(word => word[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
        </div>
    );

/** The role filters, each held in its own piece of state. */
type ReassignRoleFilterKey =
    | 'meetingScheduler'
    | 'closer'
    | 'meetingManager'
    | 'handler'
    | 'helper'
    | 'expert'
    | 'retainer_handler'
    | 'helper_handler'
    | 'client_support';

/** Each tab and the filter key holding its employee. Only the scheduler's two names differ. */
const ROLE_TAB_FILTER_KEY: Record<ReassignRoleFilterTab, ReassignRoleFilterKey> = {
    scheduler: 'meetingScheduler',
    closer: 'closer',
    meetingManager: 'meetingManager',
    handler: 'handler',
    helper: 'helper',
    expert: 'expert',
    retainer_handler: 'retainer_handler',
    helper_handler: 'helper_handler',
    client_support: 'client_support',
};

/** A name the role columns treat as nobody rather than as a person. */
const isUnassignedRoleName = (value: string): boolean => {
    if (isUnassignedHandlerValue(value)) return true;
    const normalized = value.trim().toLowerCase();
    return normalized === 'unassigned' || normalized === 'unknown';
};

/** Every role filter key, for the rules that apply to all of them at once. */
const ALL_ROLE_FILTER_KEYS: readonly ReassignRoleFilterKey[] = [
    'meetingScheduler',
    'closer',
    'meetingManager',
    'handler',
    'helper',
    'expert',
    'retainer_handler',
    'helper_handler',
    'client_support',
];

type ReassignRoleAssignee = { name: string; photoUrl?: string | null };

/**
 * Where each role's assignee is found on a result row, and what the column is called.
 *
 * The two lead tables disagree about this: `leads` keeps most roles as the person's name in a text
 * column, while `leads_lead` keeps an employee id for all of them. Listing both means a row from
 * either table is read the same way, so nothing downstream has to know which table it came from.
 */
const ROLE_COLUMN_SOURCES: Record<
    ReassignRoleFilterKey,
    { label: string; idFields?: readonly string[]; idsField?: string; nameField?: string }
> = {
    meetingScheduler: { label: 'Scheduler', idFields: ['meeting_scheduler_id'], nameField: 'scheduler' },
    closer: { label: 'Closer', idFields: ['closer_id'], nameField: 'closer' },
    meetingManager: { label: 'Meeting mgr', idFields: ['meeting_manager_id'], nameField: 'manager' },
    handler: { label: 'Handler', idFields: ['case_handler_id'], nameField: 'handler' },
    helper: { label: 'Helper', idFields: ['meeting_lawyer_id'], nameField: 'helper' },
    // New leads keep the employee id in `expert` itself; the legacy table has its own column.
    expert: { label: 'Expert', idFields: ['expert', 'expert_id'], nameField: 'expert' },
    retainer_handler: { label: 'Retention', idFields: ['retainer_handler_id'] },
    helper_handler: { label: 'Helper handler', idsField: 'helper_handler_ids' },
    client_support: { label: 'Client support', idFields: ['client_support_id'] },
};

/** Column order, which is the order the roles run in the filter tabs. */
const ROLE_COLUMN_ORDER: readonly ReassignRoleFilterKey[] = [
    'meetingScheduler',
    'closer',
    'meetingManager',
    'handler',
    'helper',
    'expert',
    'retainer_handler',
    'helper_handler',
    'client_support',
];

/** The roles a result row shows unless the view settings say otherwise. */
const DEFAULT_ROLE_COLUMNS: readonly ReassignRoleFilterKey[] = ['handler', 'retainer_handler'];

const ROLE_COLUMN_OPTIONS = ROLE_COLUMN_ORDER.map(value => ({
    value: value as string,
    label: ROLE_COLUMN_SOURCES[value].label,
}));

/** Everyone holding one role on one lead. More than one only for Helper Handler. */
const roleColumnAssignees = (
    roleKey: ReassignRoleFilterKey,
    lead: any,
    employeeById: Map<number, ReassignEmployeeOption>,
    employeeByName: Map<string, ReassignEmployeeOption>,
): ReassignRoleAssignee[] => {
    const source = ROLE_COLUMN_SOURCES[roleKey];

    if (source.idsField) {
        const ids: unknown[] = Array.isArray(lead?.[source.idsField]) ? lead[source.idsField] : [];
        const held = ids
            .map(value => employeeById.get(Number(value)))
            .filter((emp): emp is ReassignEmployeeOption => Boolean(emp))
            .map(emp => ({ name: emp.display_name, photoUrl: emp.photo_url }));
        if (held.length > 0) return held;
    }

    for (const field of source.idFields ?? []) {
        const emp = employeeById.get(Number(lead?.[field]));
        if (emp) return [{ name: emp.display_name, photoUrl: emp.photo_url }];
    }

    const name = String(lead?.[source.nameField ?? ''] ?? '').trim();
    // A number here is an id that matched nobody, not somebody called '47'.
    if (!name || Number.isFinite(Number(name)) || isUnassignedRoleName(name)) return [];
    return [{ name, photoUrl: employeeByName.get(name.toLowerCase())?.photo_url ?? null }];
};

/** One role's people in a table cell or on a card, or a dash when nobody holds it. */
const ReassignRoleCell: React.FC<{
    assignees: ReassignRoleAssignee[];
    tone?: 'primary' | 'secondary';
}> = ({ assignees, tone = 'primary' }) => {
    if (assignees.length === 0) return <span className="text-base-content/30">-</span>;

    return (
        <div className="flex flex-col gap-1">
            {assignees.map((person, index) => (
                <div key={`${person.name}-${index}`} className="flex items-center gap-2">
                    <ReassignRoleAvatar
                        name={person.name}
                        photoUrl={person.photoUrl}
                        tone={tone}
                        className="h-7 w-7"
                    />
                    <span className="truncate text-xs font-medium">{person.name}</span>
                </div>
            ))}
        </div>
    );
};

/**
 * The employee a role is filtered by, drawn inside that role's search box so the field itself says
 * who is selected. Absolutely positioned over the input, which therefore needs matching padding.
 */
const ReassignRoleFieldEmployee: React.FC<{
    employee: { display_name: string; photo_url?: string | null };
    onClear: () => void;
}> = ({ employee, onClear }) => (
    <>
        <span className="pointer-events-none absolute left-2.5 top-[1.5rem] -translate-y-1/2">
            <ReassignRoleAvatar
                name={employee.display_name}
                photoUrl={employee.photo_url}
                tone="primary"
                className="h-8 w-8"
            />
        </span>
        <button
            type="button"
            className="btn btn-ghost btn-xs absolute right-1.5 top-[1.5rem] -translate-y-1/2 text-error hover:bg-error/10"
            title="Remove filter"
            onClick={onClear}
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    </>
);

/**
 * The H | R switch for which of a lead's two handlers currently owns the case, i.e. its
 * `active_handler_type`. The sliding pill is a positioned element rather than a background change
 * so the movement reads as one control with two sides.
 */
const ReassignActiveToggle: React.FC<{
    activeType: 1 | 2;
    disabled: boolean;
    onPick: (type: 1 | 2, e: React.MouseEvent) => void;
    className?: string;
}> = ({ activeType, disabled, onPick, className = 'h-[1.875rem] w-[5rem]' }) => (
    <div
        className={`relative grid ${className} shrink-0 grid-cols-2 rounded-full border border-base-content/[0.06] bg-base-300/25 p-[3px] shadow-inner`}
        role="group"
        aria-label="Who is active on the case"
    >
        <div
            aria-hidden
            className={`pointer-events-none absolute left-[3px] top-[3px] h-[calc(100%-6px)] w-[calc(50%-4.5px)] rounded-full shadow-sm transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.25,0.85,0.35,1)] will-change-transform ${activeType === 1 ? 'translate-x-[calc(100%+3px)] bg-blue-500' : 'translate-x-0 bg-emerald-500'}`}
        />
        {([2, 1] as const).map(type => (
            <button
                key={type}
                type="button"
                disabled={disabled}
                aria-pressed={activeType === type}
                title={type === 2 ? 'Handler is active' : 'Retention is active'}
                className={`relative z-10 rounded-full px-0 py-1 text-[9px] font-semibold uppercase leading-none tracking-wide transition-colors duration-200 sm:text-[10px] ${activeType === type ? 'text-white' : 'text-base-content/40 hover:text-base-content/65'}`}
                onClick={e => onPick(type, e)}
            >
                {type === 2 ? 'H' : 'R'}
            </button>
        ))}
    </div>
);

/** Narrows a role's leads to the ones where the *other* handler role has nobody assigned. */
const ReassignMissingRoleFilter: React.FC<{
    /** Names the role being required to be empty, e.g. 'Missing retention'. */
    missingLabel: string;
    fieldLabel: string;
    missing: boolean;
    onChange: (missing: boolean) => void;
}> = ({ missingLabel, fieldLabel, missing, onChange }) => (
    <div className="mt-3">
        <div role="group" aria-label={fieldLabel} className="flex flex-wrap gap-1">
            <button
                type="button"
                aria-pressed={!missing}
                className={reassignPillClass(!missing)}
                onClick={() => onChange(false)}
            >
                Any
            </button>
            <button
                type="button"
                aria-pressed={missing}
                className={reassignPillClass(missing)}
                onClick={() => onChange(true)}
            >
                {missingLabel}
            </button>
        </div>
        <label className="block text-sm font-medium mt-2">{fieldLabel}</label>
    </div>
);

type ReassignEmployeeOption = { id: number; display_name: string; photo_url?: string | null };

const ReassignRoleEmployeeRow: React.FC<{
    emp: ReassignEmployeeOption;
    getInitials: (name: string) => string;
    onPick: () => void;
}> = ({ emp, getInitials, onPick }) => {
    const [photoFailed, setPhotoFailed] = React.useState(false);
    const showPhoto = Boolean(emp.photo_url) && !photoFailed;

    return (
        <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-base-200 rounded-md transition-colors"
            onClick={(e) => {
                e.stopPropagation();
                onPick();
            }}
        >
            {showPhoto ? (
                <img
                    src={emp.photo_url!}
                    alt={emp.display_name}
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                    onError={() => setPhotoFailed(true)}
                />
            ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {getInitials(emp.display_name)}
                </div>
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{emp.display_name}</span>
        </button>
    );
};

/**
 * One role's employee filter: the search field, the employee it currently names, and the dropdown.
 *
 * The older role panels are still written out inline above; this says the same thing once so the
 * roles added since do not each repeat a hundred lines of it. `children` is where a role hangs its
 * own extra pills, the way Handler and Retention carry the active-handler switch.
 */
const ReassignRoleFilterPanel: React.FC<{
    label: string;
    /** Matches the class the click-outside handler looks for, so the dropdown closes on a stray click. */
    containerClassName: string;
    /** True when another role already holds the employee filter, leaving only NONE to pick here. */
    secondary: boolean;
    searchTerm: string;
    selectedEmployee: { display_name: string; photo_url?: string | null } | null;
    employees: ReassignEmployeeOption[];
    getInitials: (name: string) => string;
    open: boolean;
    onOpen: () => void;
    onSearchTermChange: (value: string) => void;
    onPickNone: () => void;
    onPickEmployee: (emp: ReassignEmployeeOption) => void;
    onClear: () => void;
    children?: React.ReactNode;
}> = ({
    label,
    containerClassName,
    secondary,
    searchTerm,
    selectedEmployee,
    employees,
    getInitials,
    open,
    onOpen,
    onSearchTermChange,
    onPickNone,
    onPickEmployee,
    onClear,
    children,
}) => {
    const matches = employees.filter(emp =>
        emp.display_name.toLowerCase().includes(searchTerm.toLowerCase()),
    );

    return (
        <div>
            <div className={`relative ${containerClassName}`}>
                <input
                    type="text"
                    placeholder="Search employee..."
                    className={`input input-bordered w-full ${selectedEmployee ? 'pl-12 pr-10' : ''}`}
                    readOnly={secondary}
                    value={searchTerm}
                    onChange={(e) => {
                        if (secondary) return;
                        onSearchTermChange(e.target.value);
                    }}
                    onFocus={onOpen}
                />
                {selectedEmployee && (
                    <ReassignRoleFieldEmployee employee={selectedEmployee} onClear={onClear} />
                )}
                {open && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                        <div className="p-2">
                            {secondary && (
                                <button
                                    type="button"
                                    className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPickNone();
                                    }}
                                >
                                    {REASSIGN_ROLE_NONE_LABEL}
                                </button>
                            )}
                            {!secondary && matches.map((emp) => (
                                <ReassignRoleEmployeeRow
                                    key={emp.id}
                                    emp={emp}
                                    getInitials={getInitials}
                                    onPick={() => onPickEmployee(emp)}
                                />
                            ))}
                            {!secondary && matches.length === 0 && searchTerm.trim() !== '' && (
                                <div className="px-3 py-2 text-sm text-base-content/60">
                                    No employees found
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            <label className="block text-sm font-medium mt-2">{label}</label>
            {children}
        </div>
    );
};

// Multi-select input component for multiple selections
const MultiSelectInput = ({
    label,
    field,
    values,
    placeholder,
    options,
    showDropdown,
    onSelect,
    onRemove,
    onFilterChange,
    onShowDropdown,
    onHideDropdown
}: {
    label: string;
    field: string;
    values: string[] | any;
    placeholder: string;
    options: string[];
    showDropdown: boolean;
    onSelect: (field: string, value: string) => void;
    onRemove: (field: string, value: string) => void;
    onFilterChange: (field: string, value: string) => void;
    onShowDropdown: (field: string) => void;
    onHideDropdown: (field: string) => void;
}) => {
    const [inputValue, setInputValue] = useState('');
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Handle clicks outside the component to close dropdown
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                onHideDropdown(field);
            }
        };

        if (showDropdown) {
            setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 100);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showDropdown, field, onHideDropdown]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);
        onFilterChange(field, value);
        onShowDropdown(field);
    };

    const handleSelect = (option: string) => {
        if (!safeValues.includes(option)) {
            onSelect(field, option);
        }
        setInputValue('');
    };

    const handleRemove = (value: string) => {
        onRemove(field, value);
    };

    const safeValues = Array.isArray(values) ? values : [];

    const filteredOptions = options.filter(option =>
        option.toLowerCase().includes(inputValue.toLowerCase()) &&
        !safeValues.includes(option)
    );

    return (
        <div ref={containerRef} className="form-control flex flex-col relative">
            <label className="label mb-2">
                <span className="label-text">{label}</span>
                {safeValues.length > 0 && (
                    <span className="label-text-alt text-purple-600 font-medium">
                        {safeValues.length} selected
                    </span>
                )}
            </label>

            {/* Selected items */}
            {safeValues.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {safeValues.map((value, index) => (
                        <span
                            key={index}
                            className="badge badge-primary badge-lg gap-2"
                        >
                            {value}
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs p-0 h-auto min-h-0"
                                onClick={() => handleRemove(value)}
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Input field */}
            <div className="relative">
                <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder={safeValues.length === 0 ? placeholder : "Add more..."}
                    value={inputValue}
                    onChange={handleInputChange}
                    onFocus={() => {
                        if (options.length > 0) {
                            onShowDropdown(field);
                        }
                    }}
                />
                {showDropdown && filteredOptions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {filteredOptions.map((option, index) => (
                            <div
                                key={index}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelect(option);
                                }}
                            >
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                {option}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const ReassignLeadsReport: React.FC = () => {
    const { instance } = useMsal();
    const navigate = useNavigate();

    /** Same routing as MyCasesPage.handleCaseClick — new leads by lead number (encode /), legacy by id + optional ?lead= */
    const navigateToClientFromReassignLead = useCallback(
        (lead: any, e: React.MouseEvent) => {
            e.stopPropagation();
            const openNewTab = e.metaKey || e.ctrlKey;
            const go = (path: string) => {
                if (openNewTab) window.open(path, '_blank');
                else navigate(path);
            };

            if (lead.lead_type === 'new') {
                const leadNumber = String(lead.display_lead_number || lead.lead_number || '').trim();
                if (!leadNumber) return;
                go(`/clients/${encodeURIComponent(leadNumber)}`);
                return;
            }

            const legacyId = String(lead.id || '').replace(/^legacy_/, '').trim();
            if (!legacyId) return;
            const legacyLeadNumber = String(lead.lead_number || lead.display_lead_number || '').trim();
            if (legacyLeadNumber.includes('/')) {
                go(`/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(legacyLeadNumber)}`);
            } else {
                go(`/clients/${encodeURIComponent(legacyId)}`);
            }
        },
        [navigate]
    );
    const [hasCollectionAccess, setHasCollectionAccess] = useState<boolean | null>(null);
    const [checkingAccess, setCheckingAccess] = useState(true);
    const [reassignFilters, setReassignFilters] = usePersistedFilters('reportsPage_reassignFilters', {
        fromDate: '',
        toDate: '',
        category: [] as string[],
        source: [] as string[],
        status: [] as string[],
        language: [] as string[],
        stage: [] as string[],
        meetingScheduler: '',
        closer: '',
        meetingManager: '',
        handler: '',
        helper: '',
        expert: '',
        retainer_handler: '',
        helper_handler: '',
        client_support: '',
        /** '' | 'handler' | 'retention' — which of the two is the lead's active handler. */
        activeHandlerType: '',
        eligibilityDeterminedOnly: false,
        selectedLeadIds: [] as string[]
    }, {
        storage: 'sessionStorage',
    });
    const [reassignResults, setReassignResults] = usePersistedState<any[]>('reassignLeadsReport_results', [], {
        storage: 'sessionStorage',
    });
    const [viewMode, setViewMode] = usePersistedState<'list' | 'cards'>('reassignLeadsReport_viewMode', 'list', {
        storage: 'sessionStorage',
    });
    /** Which roles the results show, in both views. Chosen from the bottom bar's settings menu. */
    const [visibleRoleColumns, setVisibleRoleColumns] = usePersistedState<string[]>(
        'reassignLeadsReport_visibleRoleColumns',
        [...DEFAULT_ROLE_COLUMNS],
        { storage: 'sessionStorage' },
    );
    const [reassignLoading, setReassignLoading] = useState(false);
    const [selectedEmployeeForReassign, setSelectedEmployeeForReassign] = usePersistedState<string>('reassignLeadsReport_selectedEmployee', '', {
        storage: 'sessionStorage',
    });
    const [selectedRoleForReassign, setSelectedRoleForReassign] = usePersistedState<string>('reassignLeadsReport_selectedRole', 'handler', {
        storage: 'sessionStorage',
    });
    const [reassigning, setReassigning] = useState(false);
    /**
     * The pending case-handler / retention-handler reassignment awaiting confirmation.
     *
     * Holds its own copy of the chosen leads because the assignment clears the table selection, and
     * the emails are addressed after that has happened.
     */
    const [notifyFlow, setNotifyFlow] = useState<{
        role: ReassignNotifyRole;
        employeeId: number;
        employeeName: string;
        leads: ReassignNotifyLead[];
    } | null>(null);
    const [notifySending, setNotifySending] = useState(false);
    const [notifyProgress, setNotifyProgress] = useState<{ done: number; total: number } | null>(null);
    const [showActiveHandlerModal, setShowActiveHandlerModal] = useState(false);
    const [activeHandlerTypeChoice, setActiveHandlerTypeChoice] = useState<1 | 2>(2);
    const [savingActiveHandlerType, setSavingActiveHandlerType] = useState(false);
    type ActiveHandlerMissingFlowState =
        | null
        | {
              step: 'ask' | 'assign';
              activeChoice: 1 | 2;
              missingRole: 'handler' | 'retainer_handler';
              missingLeads: any[];
              allSelected: any[];
          };
    const [activeHandlerMissingFlow, setActiveHandlerMissingFlow] = useState<ActiveHandlerMissingFlowState>(null);
    const [missingFlowAssignName, setMissingFlowAssignName] = useState('');
    const [missingFlowAssignSearch, setMissingFlowAssignSearch] = useState('');
    const [showMissingFlowAssignDropdown, setShowMissingFlowAssignDropdown] = useState(false);
    const [savingMissingFlowAssign, setSavingMissingFlowAssign] = useState(false);
    type SingleLeadActiveFlowState =
        | null
        | {
              step: 'ask' | 'assign';
              lead: any;
              targetChoice: 1 | 2;
          };
    const [singleLeadActiveFlow, setSingleLeadActiveFlow] = useState<SingleLeadActiveFlowState>(null);
    const [singleActiveAssignSearch, setSingleActiveAssignSearch] = useState('');
    const [singleActiveAssignName, setSingleActiveAssignName] = useState('');
    const [singleActiveModalSaving, setSingleActiveModalSaving] = useState(false);
    const [savingSingleLeadId, setSavingSingleLeadId] = useState<string | null>(null);
    // Store selected leads as array in sessionStorage, convert to Set for use
    const [selectedLeadsArray, setSelectedLeadsArray] = usePersistedState<string[]>('reassignLeadsReport_selectedLeads', [], {
        storage: 'sessionStorage',
    });
    const selectedLeads = useMemo(() => new Set(selectedLeadsArray), [selectedLeadsArray]);
    const setSelectedLeads = (value: Set<string> | ((prev: Set<string>) => Set<string>)) => {
        if (typeof value === 'function') {
            setSelectedLeadsArray(prev => {
                const prevSet = new Set(prev);
                const newSet = value(prevSet);
                return Array.from(newSet);
            });
        } else {
            setSelectedLeadsArray(Array.from(value));
        }
    };
    const [showMeetingSchedulerDropdown, setShowMeetingSchedulerDropdown] = useState(false);
    const [meetingSchedulerSearchTerm, setMeetingSchedulerSearchTerm] = usePersistedState<string>('reassignLeadsReport_meetingSchedulerSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedMeetingScheduler, setSelectedMeetingScheduler] = usePersistedState<string>('reassignLeadsReport_selectedMeetingScheduler', '', {
        storage: 'sessionStorage',
    });
    const [showCloserDropdown, setShowCloserDropdown] = useState(false);
    const [closerSearchTerm, setCloserSearchTerm] = usePersistedState<string>('reassignLeadsReport_closerSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedCloser, setSelectedCloser] = usePersistedState<string>('reassignLeadsReport_selectedCloser', '', {
        storage: 'sessionStorage',
    });
    const [showMeetingManagerDropdown, setShowMeetingManagerDropdown] = useState(false);
    const [meetingManagerSearchTerm, setMeetingManagerSearchTerm] = usePersistedState<string>('reassignLeadsReport_meetingManagerSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedMeetingManager, setSelectedMeetingManager] = usePersistedState<string>('reassignLeadsReport_selectedMeetingManager', '', {
        storage: 'sessionStorage',
    });
    const [showHandlerDropdown, setShowHandlerDropdown] = useState(false);
    const [handlerSearchTerm, setHandlerSearchTerm] = usePersistedState<string>('reassignLeadsReport_handlerSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedHandler, setSelectedHandler] = usePersistedState<string>('reassignLeadsReport_selectedHandler', '', {
        storage: 'sessionStorage',
    });
    const [showHelperDropdown, setShowHelperDropdown] = useState(false);
    const [helperSearchTerm, setHelperSearchTerm] = usePersistedState<string>('reassignLeadsReport_helperSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedHelper, setSelectedHelper] = usePersistedState<string>('reassignLeadsReport_selectedHelper', '', {
        storage: 'sessionStorage',
    });
    const [showExpertDropdown, setShowExpertDropdown] = useState(false);
    const [expertSearchTerm, setExpertSearchTerm] = usePersistedState<string>('reassignLeadsReport_expertSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedExpert, setSelectedExpert] = usePersistedState<string>('reassignLeadsReport_selectedExpert', '', {
        storage: 'sessionStorage',
    });
    const [showRetainerHandlerDropdown, setShowRetainerHandlerDropdown] = useState(false);
    const [roleFilterTab, setRoleFilterTab] = useState<ReassignRoleFilterTab>('scheduler');
    const [retainerHandlerSearchTerm, setRetainerHandlerSearchTerm] = usePersistedState<string>('reassignLeadsReport_retainerHandlerSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedRetainerHandler, setSelectedRetainerHandler] = usePersistedState<string>('reassignLeadsReport_selectedRetainerHandler', '', {
        storage: 'sessionStorage',
    });
    const [showHelperHandlerDropdown, setShowHelperHandlerDropdown] = useState(false);
    const [helperHandlerSearchTerm, setHelperHandlerSearchTerm] = usePersistedState<string>('reassignLeadsReport_helperHandlerSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedHelperHandler, setSelectedHelperHandler] = usePersistedState<string>('reassignLeadsReport_selectedHelperHandler', '', {
        storage: 'sessionStorage',
    });
    const [showClientSupportDropdown, setShowClientSupportDropdown] = useState(false);
    const [clientSupportSearchTerm, setClientSupportSearchTerm] = usePersistedState<string>('reassignLeadsReport_clientSupportSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [selectedClientSupport, setSelectedClientSupport] = usePersistedState<string>('reassignLeadsReport_selectedClientSupport', '', {
        storage: 'sessionStorage',
    });
    const [showAssignEmployeeDropdown, setShowAssignEmployeeDropdown] = useState(false);
    const [showRoleDropdown, setShowRoleDropdown] = useState(false);
    const [assignEmployeeSearchTerm, setAssignEmployeeSearchTerm] = usePersistedState<string>('reassignLeadsReport_assignEmployeeSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [showReassignCategoryDropdown, setShowReassignCategoryDropdown] = useState(false);
    const [showReassignSourceDropdown, setShowReassignSourceDropdown] = useState(false);
    const [showReassignStageDropdown, setShowReassignStageDropdown] = useState(false);
    const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [filteredStatusOptions, setFilteredStatusOptions] = useState<string[]>(['Active', 'Not active']);
    const [reassignLanguageOptions, setReassignLanguageOptions] = useState<string[]>([]);
    const [reassignSourceOptions, setReassignSourceOptions] = useState<string[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [stages, setStages] = useState<any[]>([]);
    const [stageMapping, setStageMapping] = useState<Map<string | number, string>>(new Map());
    const [showLeadSearchDropdown, setShowLeadSearchDropdown] = useState(false);
    const [leadSearchTerm, setLeadSearchTerm] = usePersistedState<string>('reassignLeadsReport_leadSearchTerm', '', {
        storage: 'sessionStorage',
    });
    const [leadSearchResults, setLeadSearchResults] = useState<Array<{ id: string; lead_number: string | null; name: string; isLegacy: boolean }>>([]);
    const [selectedLeadsInfoArray, setSelectedLeadsInfoArray] = usePersistedState<Array<[string, { lead_number: string | null; name: string; isLegacy: boolean }]>>('reassignLeadsReport_selectedLeadsInfo', [], {
        storage: 'sessionStorage',
    });
    const selectedLeadsInfo = useMemo(() => new Map(selectedLeadsInfoArray), [selectedLeadsInfoArray]);
    const setSelectedLeadsInfo = (value: Map<string, { lead_number: string | null; name: string; isLegacy: boolean }> | ((prev: Map<string, { lead_number: string | null; name: string; isLegacy: boolean }>) => Map<string, { lead_number: string | null; name: string; isLegacy: boolean }>)) => {
        if (typeof value === 'function') {
            setSelectedLeadsInfoArray(prev => {
                const prevMap = new Map(prev);
                const newMap = value(prevMap);
                return Array.from(newMap.entries());
            });
        } else {
            setSelectedLeadsInfoArray(Array.from(value.entries()));
        }
    };
    const [mainCategories, setMainCategories] = useState<string[]>([]);
    const [showFilters, setShowFilters] = usePersistedState<boolean>('reassignLeadsReport_showFilters', true, {
        storage: 'sessionStorage',
    });
    const [showFloatingBar, setShowFloatingBar] = usePersistedState<boolean>('reassignLeadsReport_showFloatingBar', false, {
        storage: 'sessionStorage',
    });

    // Ref for scroll detection
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const reassignFiltersRef = useRef(reassignFilters);
    useEffect(() => {
        reassignFiltersRef.current = reassignFilters;
    }, [reassignFilters]);

    useEffect(() => {
        setShowMeetingSchedulerDropdown(false);
        setShowCloserDropdown(false);
        setShowMeetingManagerDropdown(false);
        setShowHandlerDropdown(false);
        setShowHelperDropdown(false);
        setShowExpertDropdown(false);
        setShowRetainerHandlerDropdown(false);
    }, [roleFilterTab]);

    const SCHEDULER_STAGE_ID = 10;

    // Helper function to get balance value for a lead (same logic as Clients.tsx)
    const getLeadBalance = (lead: any): { value: number | null; currency: string } => {
        const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');

        let balanceValue: number | null = null;
        let balanceCurrency = '₪';

        if (isLegacy) {
            // For legacy leads: if currency_id is 1 (NIS), use total_base; otherwise use total
            const currencyId = lead.currency_id;
            let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
            if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                numericCurrencyId = 1; // Default to NIS
            }
            if (numericCurrencyId === 1) {
                balanceValue = lead.total_base ?? null;
            } else {
                balanceValue = lead.total ?? null;
            }

            // Get currency from accounting_currencies join (handle both array and single object)
            const currencyRecord = lead.accounting_currencies
                ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
                : null;

            if (currencyRecord?.name) {
                balanceCurrency = currencyRecord.name; // accounting_currencies.name contains the symbol (₪, $, €, £)
            } else if (currencyId) {
                switch (numericCurrencyId) {
                    case 1: balanceCurrency = '₪'; break;
                    case 2: balanceCurrency = '€'; break;
                    case 3: balanceCurrency = '$'; break;
                    case 4: balanceCurrency = '£'; break;
                    default: balanceCurrency = '₪';
                }
            }
        } else {
            // For new leads: use balance or proposal_total
            balanceValue = lead.balance || lead.proposal_total || null;

            // Get currency from balance_currency, proposal_currency, or accounting_currencies join
            if (lead.balance_currency) {
                balanceCurrency = lead.balance_currency;
            } else if (lead.proposal_currency) {
                balanceCurrency = lead.proposal_currency;
            } else {
                // Try accounting_currencies join (handle both array and single object)
                const currencyRecord = lead.accounting_currencies
                    ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
                    : null;

                if (currencyRecord?.name) {
                    balanceCurrency = currencyRecord.name;
                } else if (lead.currency_id) {
                    const numericCurrencyId = typeof lead.currency_id === 'string' ? parseInt(lead.currency_id, 10) : Number(lead.currency_id);
                    switch (numericCurrencyId) {
                        case 1: balanceCurrency = '₪'; break;
                        case 2: balanceCurrency = '€'; break;
                        case 3: balanceCurrency = '$'; break;
                        case 4: balanceCurrency = '£'; break;
                        default: balanceCurrency = '₪';
                    }
                }
            }
        }

        return { value: balanceValue, currency: balanceCurrency };
    };

    // Helper function to get total applicants for a lead
    const getLeadApplicants = (lead: any): number | null => {
        const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');

        if (isLegacy) {
            return lead.no_of_applicants ?? null;
        } else {
            return lead.number_of_applicants_meeting ?? null;
        }
    };

    // Scroll to top when scrolled to bottom (to access assign input and reassign button)
    useEffect(() => {
        const handleScroll = () => {
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollBottom = scrollTop + windowHeight;

            // Check if scrolled to bottom (within 100px of bottom)
            if (documentHeight - scrollBottom < 100 && reassignResults.length > 0) {
                // Scroll to top smoothly
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [reassignResults.length]);

    // Check if user has collection access (is_collection = true)
    useEffect(() => {
        const checkCollectionAccess = async () => {
            try {
                setCheckingAccess(true);
                const { data: { user: initialUser }, error: authError } = await supabase.auth.getUser();
                let user = initialUser;
                if (authError && isAuthError(authError)) {
                    const recovered = await tryRefreshThenExpire();
                    if (!recovered) {
                        setHasCollectionAccess(false);
                        setCheckingAccess(false);
                        return;
                    }
                    const { data: { user: retryUser } } = await supabase.auth.getUser();
                    user = retryUser;
                }
                if (!user) {
                    setHasCollectionAccess(false);
                    setCheckingAccess(false);
                    return;
                }

                // Try to find user by auth_id first
                let { data: userData, error } = await supabase
                    .from('users')
                    .select('employee_id')
                    .eq('auth_id', user.id)
                    .maybeSingle();

                // If not found by auth_id, try by email
                if (!userData && user.email) {
                    const { data: userByEmail, error: emailError } = await supabase
                        .from('users')
                        .select('employee_id')
                        .eq('email', user.email)
                        .maybeSingle();

                    userData = userByEmail;
                    error = emailError;
                }

                if (!error && userData && userData.employee_id) {
                    const { data: employeeData, error: employeeError } = await supabase
                        .from('tenants_employee')
                        .select('is_collection')
                        .eq('id', userData.employee_id)
                        .maybeSingle();

                    if (!employeeError && employeeData) {
                        // Check if is_collection is true (handle boolean, string 't', or number)
                        const collectionStatus = employeeData.is_collection === true ||
                            employeeData.is_collection === 't' ||
                            employeeData.is_collection === 'true' ||
                            employeeData.is_collection === 1;
                        setHasCollectionAccess(collectionStatus);
                    } else {
                        setHasCollectionAccess(false);
                    }
                } else {
                    setHasCollectionAccess(false);
                }
            } catch (error) {
                console.error('Error checking collection access:', error);
                setHasCollectionAccess(false);
            } finally {
                setCheckingAccess(false);
            }
        };

        checkCollectionAccess();
    }, []);

    // Fetch employees with photo_url
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data, error } = await supabase
                    .from('tenants_employee')
                    .select('id, display_name, photo_url')
                    .order('display_name');

                if (error) throw error;
                setEmployees(data || []);
            } catch (error) {
                console.error('Error fetching employees:', error);
            }
        };
        fetchEmployees();
    }, []);


    // Helper function to get employee initials
    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    // Get filtered employees with their roles (and NONE / unassigned chips)
    const getFilteredEmployees = () => {
        const filtered: Array<{ employee: any; role: string; roleLabel: string; noneFilter?: boolean }> = [];

        if (reassignFilters.meetingScheduler) {
            if (isReassignRoleNoneFilter(reassignFilters.meetingScheduler)) {
                filtered.push({ employee: null, role: 'meetingScheduler', roleLabel: 'Meeting scheduler', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.meetingScheduler);
                if (emp) filtered.push({ employee: emp, role: 'meetingScheduler', roleLabel: 'Scheduler' });
            }
        }
        if (reassignFilters.closer) {
            if (isReassignRoleNoneFilter(reassignFilters.closer)) {
                filtered.push({ employee: null, role: 'closer', roleLabel: 'Closer', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.closer);
                if (emp) filtered.push({ employee: emp, role: 'closer', roleLabel: 'Closer' });
            }
        }
        if (reassignFilters.meetingManager) {
            if (isReassignRoleNoneFilter(reassignFilters.meetingManager)) {
                filtered.push({ employee: null, role: 'meetingManager', roleLabel: 'Meeting manager', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.meetingManager);
                if (emp) filtered.push({ employee: emp, role: 'meetingManager', roleLabel: 'Meeting Manager' });
            }
        }
        if (reassignFilters.handler) {
            if (isReassignRoleNoneFilter(reassignFilters.handler)) {
                filtered.push({ employee: null, role: 'handler', roleLabel: 'Handler', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.handler);
                if (emp) filtered.push({ employee: emp, role: 'handler', roleLabel: 'Handler' });
            }
        }
        if (reassignFilters.helper) {
            if (isReassignRoleNoneFilter(reassignFilters.helper)) {
                filtered.push({ employee: null, role: 'helper', roleLabel: 'Helper', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.helper);
                if (emp) filtered.push({ employee: emp, role: 'helper', roleLabel: 'Helper' });
            }
        }
        if (reassignFilters.expert) {
            if (isReassignRoleNoneFilter(reassignFilters.expert)) {
                filtered.push({ employee: null, role: 'expert', roleLabel: 'Expert', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.expert);
                if (emp) filtered.push({ employee: emp, role: 'expert', roleLabel: 'Expert' });
            }
        }
        if (reassignFilters.retainer_handler) {
            if (isReassignRoleNoneFilter(reassignFilters.retainer_handler)) {
                filtered.push({ employee: null, role: 'retainer_handler', roleLabel: 'Retention handler', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.retainer_handler);
                if (emp) filtered.push({ employee: emp, role: 'retainer_handler', roleLabel: 'Retention Handler' });
            }
        }
        if (reassignFilters.helper_handler) {
            if (isReassignRoleNoneFilter(reassignFilters.helper_handler)) {
                filtered.push({ employee: null, role: 'helper_handler', roleLabel: 'Helper handler', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.helper_handler);
                if (emp) filtered.push({ employee: emp, role: 'helper_handler', roleLabel: 'Helper Handler' });
            }
        }
        if (reassignFilters.client_support) {
            if (isReassignRoleNoneFilter(reassignFilters.client_support)) {
                filtered.push({ employee: null, role: 'client_support', roleLabel: 'Client support', noneFilter: true });
            } else {
                const emp = employees.find(e => e.display_name === reassignFilters.client_support);
                if (emp) filtered.push({ employee: emp, role: 'client_support', roleLabel: 'Client Support' });
            }
        }

        return filtered;
    };

    // Fetch stages - ordered by ID
    useEffect(() => {
        const fetchStages = async () => {
            try {
                const { data, error } = await supabase
                    .from('lead_stages')
                    .select('id, name')
                    .order('id', { ascending: true });

                if (error) throw error;
                setStages(data || []);

                // Create stage mapping
                const mapping = new Map<string | number, string>();
                data?.forEach(stage => {
                    mapping.set(stage.id, stage.name);
                });
                setStageMapping(mapping);
            } catch (error) {
                console.error('Error fetching stages:', error);
            }
        };
        fetchStages();
    }, []);

    // Fetch main categories
    useEffect(() => {
        const fetchMainCategories = async () => {
            try {
                const { data, error } = await supabase
                    .from('misc_maincategory')
                    .select('name')
                    .order('name');

                if (error) throw error;
                setMainCategories(data?.map(cat => cat.name) || []);
            } catch (error) {
                console.error('Error fetching main categories:', error);
            }
        };
        fetchMainCategories();
    }, []);

    // Fetch language options
    useEffect(() => {
        const fetchReassignLanguageOptions = async () => {
            try {
                const { data, error } = await supabase
                    .from('misc_language')
                    .select('name')
                    .order('name');

                if (error) throw error;
                setReassignLanguageOptions(data?.map(lang => lang.name) || []);
            } catch (error) {
                console.error('Error fetching language options:', error);
                setReassignLanguageOptions([
                    'English', 'Hebrew', 'German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Russian', 'Arabic', 'Chinese', 'Japanese', 'Korean'
                ]);
            }
        };
        fetchReassignLanguageOptions();
    }, []);

    // Fetch source options
    useEffect(() => {
        const fetchReassignSourceOptions = async () => {
            try {
                const { data, error } = await supabase
                    .from('misc_leadsource')
                    .select('id, name')
                    .eq('active', true)
                    .order('name');

                if (error) throw error;
                setReassignSourceOptions(data?.map(source => source.name) || []);
            } catch (error) {
                console.error('Error fetching source options:', error);
                setReassignSourceOptions([
                    'Website', 'Phone', 'Email', 'Referral', 'Other'
                ]);
            }
        };
        fetchReassignSourceOptions();
    }, []);

    // Parse sublead (same logic as legacyLeadsApi.ts)
    const parseSubLead = (raw: string): { master: number | null; suffix: number | null } => {
        const t = raw.trim();
        if (!t.includes("/")) return { master: null, suffix: null };
        const parts = t.split("/");
        if (parts.length !== 2) return { master: null, suffix: null };
        const masterPart = parts[0].replace(/^[LC]/i, "");
        const suffixPart = parts[1];
        const master = parseInt(masterPart, 10);
        const suffix = parseInt(suffixPart, 10);
        if (Number.isNaN(master) || Number.isNaN(suffix)) return { master: null, suffix: null };
        return { master, suffix };
    };

    // Search for leads as user types (using legacyLeadsApi.ts search logic)
    const searchLeadsByQuery = async (query: string) => {
        if (!query || query.trim().length < 1) {
            setLeadSearchResults([]);
            return;
        }

        try {
            const cleaned = query.trim();
            const results: Array<{ id: string; lead_number: string | null; name: string; isLegacy: boolean; inputNumber: string }> = [];
            const foundLeadIds = new Set<string>();

            // Parse sublead info
            const { master, suffix } = parseSubLead(cleaned);
            const withoutPrefix = cleaned.replace(/^[LC]/i, "");
            const baseDigits = withoutPrefix.split('/')[0];
            const isNumeric = /^\d+$/.test(baseDigits);
            const numericId = isNumeric ? parseInt(baseDigits, 10) : null;

            // Search in new leads table
            if (master != null && suffix != null && !Number.isNaN(master) && !Number.isNaN(suffix)) {
                // Specific sublead search - exact match
                const subleadPatterns = [
                    `${master}/${suffix}`,
                    `L${master}/${suffix}`,
                    `C${master}/${suffix}`,
                ];
                const { data: newLeads, error: newError } = await supabase
                    .from('leads')
                    .select('id, lead_number, name')
                    .or(subleadPatterns.map(p => `lead_number.ilike.${p}`).join(','))
                    .limit(20);

                if (!newError && newLeads) {
                    newLeads.forEach(lead => {
                        const leadId = lead.id.toString();
                        if (!foundLeadIds.has(leadId)) {
                            foundLeadIds.add(leadId);
                            results.push({
                                id: leadId,
                                lead_number: lead.lead_number,
                                name: lead.name || 'No Name',
                                isLegacy: false,
                                inputNumber: cleaned
                            });
                        }
                    });
                }
            } else {
                // Regular lead number search - use ilike for pattern matching
                const searchDigits = baseDigits || withoutPrefix;
                const { data: newLeads, error: newError } = await supabase
                    .from('leads')
                    .select('id, lead_number, name')
                    .or([
                        `lead_number.ilike.${searchDigits}%`,
                        `lead_number.ilike.L${searchDigits}%`,
                        `lead_number.ilike.C${searchDigits}%`,
                    ].join(','))
                    .limit(20);

                if (!newError && newLeads) {
                    newLeads.forEach(lead => {
                        const leadId = lead.id.toString();
                        if (!foundLeadIds.has(leadId)) {
                            foundLeadIds.add(leadId);
                            results.push({
                                id: leadId,
                                lead_number: lead.lead_number,
                                name: lead.name || 'No Name',
                                isLegacy: false,
                                inputNumber: cleaned
                            });
                        }
                    });
                }
            }

            // Search in legacy leads table
            if (master != null && suffix != null && !Number.isNaN(master) && !Number.isNaN(suffix)) {
                // Specific sublead search - find by master_id and calculate index
                const { data: subleads, error: subleadError } = await supabase
                    .from('leads_lead')
                    .select('id, name, master_id')
                    .eq('master_id', master)
                    .not('master_id', 'is', null)
                    .order('id', { ascending: true })
                    .limit(100);

                if (!subleadError && subleads && subleads.length > 0) {
                    // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
                    const targetIndex = suffix - 2;
                    if (targetIndex >= 0 && targetIndex < subleads.length) {
                        const targetSublead = subleads[targetIndex];
                        const leadId = `legacy_${targetSublead.id}`;
                        if (!foundLeadIds.has(leadId)) {
                            foundLeadIds.add(leadId);
                            results.push({
                                id: leadId,
                                lead_number: `${master}/${suffix}`,
                                name: targetSublead.name || 'No Name',
                                isLegacy: true,
                                inputNumber: cleaned
                            });
                        }
                    }
                }
            } else if (numericId != null && !Number.isNaN(numericId) && numericId.toString().length <= 6) {
                // Exact ID search for legacy leads (1-6 digits)
                const { data: legacyLead, error: legacyError } = await supabase
                    .from('leads_lead')
                    .select('id, name, master_id')
                    .eq('id', numericId)
                    .limit(1)
                    .maybeSingle();

                if (!legacyError && legacyLead) {
                    const leadId = `legacy_${legacyLead.id}`;
                    if (!foundLeadIds.has(leadId)) {
                        foundLeadIds.add(leadId);
                        results.push({
                            id: leadId,
                            lead_number: legacyLead.id.toString(),
                            name: legacyLead.name || 'No Name',
                            isLegacy: true,
                            inputNumber: cleaned
                        });
                    }
                }
            } else if (master != null && !Number.isNaN(master)) {
                // Search for master lead and its subleads
                const { data: masterLead, error: masterError } = await supabase
                    .from('leads_lead')
                    .select('id, name, master_id')
                    .eq('id', master)
                    .limit(1)
                    .maybeSingle();

                if (!masterError && masterLead) {
                    const leadId = `legacy_${masterLead.id}`;
                    if (!foundLeadIds.has(leadId)) {
                        foundLeadIds.add(leadId);
                        results.push({
                            id: leadId,
                            lead_number: masterLead.id.toString(),
                            name: masterLead.name || 'No Name',
                            isLegacy: true,
                            inputNumber: cleaned
                        });
                    }
                }

                // Find all subleads of this master
                const { data: subleads, error: subleadError } = await supabase
                    .from('leads_lead')
                    .select('id, name, master_id')
                    .eq('master_id', master)
                    .not('master_id', 'is', null)
                    .order('id', { ascending: true })
                    .limit(20);

                if (!subleadError && subleads) {
                    subleads.forEach((sublead, index) => {
                        const suffix = index + 2;
                        const leadId = `legacy_${sublead.id}`;
                        if (!foundLeadIds.has(leadId)) {
                            foundLeadIds.add(leadId);
                            results.push({
                                id: leadId,
                                lead_number: `${master}/${suffix}`,
                                name: sublead.name || 'No Name',
                                isLegacy: true,
                                inputNumber: cleaned
                            });
                        }
                    });
                }
            }

            // Filter out already selected leads
            const selectedIds = new Set(reassignFilters.selectedLeadIds || []);
            const uniqueResults = results.filter(lead => !selectedIds.has(lead.id));

            setLeadSearchResults(uniqueResults);
        } catch (error) {
            console.error('Error searching leads:', error);
            setLeadSearchResults([]);
        }
    };

    // Debounced search effect
    useEffect(() => {
        if (!leadSearchTerm || leadSearchTerm.trim().length < 1) {
            setLeadSearchResults([]);
            setShowLeadSearchDropdown(false);
            return;
        }

        const debounceTimer = setTimeout(() => {
            searchLeadsByQuery(leadSearchTerm);
            setShowLeadSearchDropdown(true);
        }, 300);

        return () => clearTimeout(debounceTimer);
    }, [leadSearchTerm]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (showMeetingSchedulerDropdown && !target.closest('.meeting-scheduler-dropdown-container')) {
                setShowMeetingSchedulerDropdown(false);
                if (!selectedMeetingScheduler) {
                    setMeetingSchedulerSearchTerm('');
                }
            }
            if (showCloserDropdown && !target.closest('.closer-dropdown-container')) {
                setShowCloserDropdown(false);
                if (!selectedCloser) {
                    setCloserSearchTerm('');
                }
            }
            if (showMeetingManagerDropdown && !target.closest('.meeting-manager-dropdown-container')) {
                setShowMeetingManagerDropdown(false);
                if (!selectedMeetingManager) {
                    setMeetingManagerSearchTerm('');
                }
            }
            if (showHandlerDropdown && !target.closest('.handler-dropdown-container')) {
                setShowHandlerDropdown(false);
                if (!selectedHandler) {
                    setHandlerSearchTerm('');
                }
            }
            if (showHelperDropdown && !target.closest('.helper-dropdown-container')) {
                setShowHelperDropdown(false);
                if (!selectedHelper) {
                    setHelperSearchTerm('');
                }
            }
            if (showExpertDropdown && !target.closest('.expert-dropdown-container')) {
                setShowExpertDropdown(false);
                if (!selectedExpert) {
                    setExpertSearchTerm('');
                }
            }
            if (showRetainerHandlerDropdown && !target.closest('.retainer-handler-dropdown-container')) {
                setShowRetainerHandlerDropdown(false);
                if (!selectedRetainerHandler) {
                    setRetainerHandlerSearchTerm('');
                }
            }
            if (showHelperHandlerDropdown && !target.closest('.helper-handler-role-dropdown-container')) {
                setShowHelperHandlerDropdown(false);
                if (!selectedHelperHandler) {
                    setHelperHandlerSearchTerm('');
                }
            }
            if (showClientSupportDropdown && !target.closest('.client-support-dropdown-container')) {
                setShowClientSupportDropdown(false);
                if (!selectedClientSupport) {
                    setClientSupportSearchTerm('');
                }
            }
            if (showAssignEmployeeDropdown && !target.closest('.assign-employee-dropdown-container')) {
                setShowAssignEmployeeDropdown(false);
                if (!selectedEmployeeForReassign) {
                    setAssignEmployeeSearchTerm('');
                }
            }
            if (showRoleDropdown && !target.closest('.role-dropdown-container')) {
                setShowRoleDropdown(false);
            }
            if (showLeadSearchDropdown && !target.closest('.lead-search-dropdown-container')) {
                setShowLeadSearchDropdown(false);
            }
            if (showReassignCategoryDropdown && !target.closest('.form-control')) {
                setShowReassignCategoryDropdown(false);
            }
            if (showReassignSourceDropdown && !target.closest('.form-control')) {
                setShowReassignSourceDropdown(false);
            }
            if (showReassignStageDropdown && !target.closest('.form-control')) {
                setShowReassignStageDropdown(false);
            }
            if (showLanguageDropdown && !target.closest('.language-filter-dropdown-container')) {
                setShowLanguageDropdown(false);
            }
            if (showStatusDropdown && !target.closest('.status-filter-dropdown-container')) {
                setShowStatusDropdown(false);
            }
            if (showMissingFlowAssignDropdown && !target.closest('.missing-flow-assign-dropdown')) {
                setShowMissingFlowAssignDropdown(false);
            }
        };

        if (showMeetingSchedulerDropdown || showCloserDropdown || showMeetingManagerDropdown || showHandlerDropdown || showHelperDropdown || showExpertDropdown || showRetainerHandlerDropdown || showHelperHandlerDropdown || showClientSupportDropdown || showAssignEmployeeDropdown || showLeadSearchDropdown || showReassignCategoryDropdown || showReassignSourceDropdown || showReassignStageDropdown || showLanguageDropdown || showStatusDropdown || showRoleDropdown || showMissingFlowAssignDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showMeetingSchedulerDropdown, selectedMeetingScheduler, showCloserDropdown, selectedCloser, showMeetingManagerDropdown, selectedMeetingManager, showHandlerDropdown, selectedHandler, showHelperDropdown, selectedHelper, showExpertDropdown, selectedExpert, showRetainerHandlerDropdown, selectedRetainerHandler, showHelperHandlerDropdown, selectedHelperHandler, showClientSupportDropdown, selectedClientSupport, showAssignEmployeeDropdown, selectedEmployeeForReassign, showLeadSearchDropdown, showReassignCategoryDropdown, showReassignSourceDropdown, showReassignStageDropdown, showLanguageDropdown, showStatusDropdown, showRoleDropdown, showMissingFlowAssignDropdown]);

    // Toggle lead selection
    const toggleLeadSelection = (leadId: string) => {
        setSelectedLeads(prev => {
            const newSet = new Set(prev);
            if (newSet.has(leadId)) {
                newSet.delete(leadId);
            } else {
                newSet.add(leadId);
            }
            return newSet;
        });
    };

    // Select all leads
    const selectAllLeads = () => {
        const allLeadIds = reassignResults.map(lead => lead.id?.toString()).filter(Boolean);
        setSelectedLeads(new Set(allLeadIds));
    };

    // Deselect all leads
    const deselectAllLeads = () => {
        setSelectedLeads(new Set());
    };

    // Re-assign leads search function
    const handleReassignSearch = async () => {
        // Hide filters and show floating bar when search is clicked
        setShowFilters(false);
        setShowFloatingBar(true);
        setReassignLoading(true);
        setSelectedLeads(new Set()); // Clear selection on new search

        // Note: Lead search is now handled via the search input and dropdown
        // No need to automatically search here

        try {
            const searchPromises = [];

            // Search in leads table (new leads) with category join
            let leadsQuery = supabase
                .from('leads')
                .select(`
          id,
          lead_number,
          manual_id,
          master_id,
          name,
          created_at,
          scheduler,
          closer,
          manager,
          helper,
          handler,
          expert,
          retainer_handler_id,
          helper_handler_ids,
          client_support_id,
          active_handler_type,
          category,
          category_id,
          source,
          language,
          language_id,
          stage,
          balance,
          balance_currency,
          proposal_total,
          proposal_currency,
          currency_id,
          number_of_applicants_meeting,
          accounting_currencies!leads_currency_id_fkey(name, iso_code),
          misc_category!category_id (
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          )
        `);

            if (reassignFilters.fromDate) {
                leadsQuery = leadsQuery.gte('created_at', `${reassignFilters.fromDate}T00:00:00`);
            }
            if (reassignFilters.toDate) {
                leadsQuery = leadsQuery.lte('created_at', `${reassignFilters.toDate}T23:59:59`);
            }
            if (reassignFilters.category && reassignFilters.category.length > 0) {
                console.log('🏷️ Adding category filter for new leads:', reassignFilters.category);
                if (reassignFilters.category.length === 1) {
                    leadsQuery = leadsQuery.ilike('category', `%${reassignFilters.category[0]}%`);
                } else {
                    // For multiple categories, use OR condition
                    const orConditions = reassignFilters.category.map(cat => `category.ilike.%${cat}%`);
                    leadsQuery = leadsQuery.or(orConditions.join(','));
                }
            }
            if (reassignFilters.source && reassignFilters.source.length > 0) {
                console.log('📡 Adding source filter for new leads:', reassignFilters.source);
                if (reassignFilters.source.length === 1) {
                    leadsQuery = leadsQuery.eq('source', reassignFilters.source[0]);
                } else {
                    leadsQuery = leadsQuery.in('source', reassignFilters.source);
                }
            }
            if (reassignFilters.status && reassignFilters.status.length > 0) {
                console.log('📊 Adding status filter for new leads (Active/Not active):', reassignFilters.status);
                const includeActive = reassignFilters.status.includes('Active');
                const includeInactive = reassignFilters.status.includes('Not active');

                // If both are selected, don't filter by status at all
                if (includeActive && !includeInactive) {
                    // Active: unactivated_at IS NULL
                    leadsQuery = leadsQuery.is('unactivated_at', null);
                } else if (!includeActive && includeInactive) {
                    // Not active: unactivated_at IS NOT NULL
                    leadsQuery = leadsQuery.not('unactivated_at', 'is', null);
                }
            }
            if (reassignFilters.eligibilityDeterminedOnly) {
                console.log('✅ Adding eligibility filter for new leads');
                leadsQuery = leadsQuery.eq('eligible', true);
            }
            if (reassignFilters.language && reassignFilters.language.length > 0) {
                console.log('🌐 Adding language filter for new leads:', reassignFilters.language);
                // Check if filtering for N/A
                const hasNAFilter = reassignFilters.language.some(lang =>
                    lang.toUpperCase() === 'N/A' || lang === 'N/A'
                );
                const nonNALanguages = reassignFilters.language.filter(lang =>
                    lang.toUpperCase() !== 'N/A' && lang !== 'N/A'
                );

                if (hasNAFilter && nonNALanguages.length === 0) {
                    // Only filtering for N/A - find leads where language_id is null AND language is null/empty/N/A
                    leadsQuery = leadsQuery.is('language_id', null);
                } else if (hasNAFilter && nonNALanguages.length > 0) {
                    // Filtering for both N/A and specific languages
                    const orConditions = ['language_id.is.null', 'language.is.null', 'language.eq.N/A'];
                    nonNALanguages.forEach(lang => {
                        orConditions.push(`language.eq.${lang}`);
                    });
                    leadsQuery = leadsQuery.or(orConditions.join(','));
                } else {
                    // Only filtering for specific languages (not N/A)
                    if (nonNALanguages.length === 1) {
                        leadsQuery = leadsQuery
                            .eq('language', nonNALanguages[0])
                            .not('language', 'is', null)
                            .neq('language', '')
                            .neq('language', 'N/A');
                    } else {
                        leadsQuery = leadsQuery
                            .in('language', nonNALanguages)
                            .not('language', 'is', null)
                            .neq('language', '')
                            .neq('language', 'N/A');
                    }
                }
            }
            if (reassignFilters.stage && reassignFilters.stage.length > 0) {
                console.log('🎯 Adding stage filter for new leads:', reassignFilters.stage);
                try {
                    const stageIds: number[] = [];
                    for (const stageName of reassignFilters.stage) {
                        const trimmedStage = stageName.trim();

                        // Special case: "Created" should map to stage ID 0
                        if (trimmedStage.toLowerCase() === 'created') {
                            stageIds.push(0);
                            continue;
                        }

                        const stage = stages.find(s => s.name === trimmedStage);
                        if (stage) {
                            stageIds.push(stage.id);
                        }
                    }

                    if (stageIds.length > 0) {
                        if (stageIds.length === 1) {
                            leadsQuery = leadsQuery.eq('stage', stageIds[0]);
                        } else {
                            leadsQuery = leadsQuery.in('stage', stageIds);
                        }
                    }
                } catch (error) {
                    console.error('⚠️ Stage lookup failed for new leads:', error);
                }
            }
            if (reassignFilters.meetingScheduler) {
                if (isReassignRoleNoneFilter(reassignFilters.meetingScheduler)) {
                    leadsQuery = leadsQuery.or(newLeadsUnassignedTextRoleOr('scheduler'));
                } else {
                    leadsQuery = leadsQuery.ilike('scheduler', `%${reassignFilters.meetingScheduler}%`);
                }
            }
            if (reassignFilters.closer) {
                if (isReassignRoleNoneFilter(reassignFilters.closer)) {
                    leadsQuery = leadsQuery.or(newLeadsUnassignedTextRoleOr('closer'));
                } else {
                    leadsQuery = leadsQuery.ilike('closer', `%${reassignFilters.closer}%`);
                }
            }
            if (reassignFilters.meetingManager) {
                if (isReassignRoleNoneFilter(reassignFilters.meetingManager)) {
                    leadsQuery = leadsQuery.or(newLeadsUnassignedTextRoleOr('manager'));
                } else {
                    leadsQuery = leadsQuery.ilike('manager', `%${reassignFilters.meetingManager}%`);
                }
            }
            if (reassignFilters.handler) {
                if (isReassignRoleNoneFilter(reassignFilters.handler) || isUnassignedHandlerValue(reassignFilters.handler)) {
                    leadsQuery = leadsQuery.or(newLeadsUnassignedTextRoleOr('handler'));
                } else {
                    leadsQuery = leadsQuery.ilike('handler', `%${reassignFilters.handler}%`);
                }
            }
            if (reassignFilters.helper) {
                if (isReassignRoleNoneFilter(reassignFilters.helper)) {
                    leadsQuery = leadsQuery.or(newLeadsUnassignedTextRoleOr('helper'));
                } else {
                    leadsQuery = leadsQuery.ilike('helper', `%${reassignFilters.helper}%`);
                }
            }
            if (reassignFilters.expert) {
                if (isReassignRoleNoneFilter(reassignFilters.expert)) {
                    leadsQuery = leadsQuery.is('expert', null);
                } else {
                    const expertEmp = employees.find(emp => emp.display_name === reassignFilters.expert);
                    if (expertEmp) {
                        leadsQuery = leadsQuery.eq('expert', expertEmp.id);
                    }
                }
            }
            if (reassignFilters.retainer_handler) {
                if (isReassignRoleNoneFilter(reassignFilters.retainer_handler)) {
                    leadsQuery = leadsQuery.is('retainer_handler_id', null);
                } else {
                    const rhEmp = employees.find(emp => emp.display_name === reassignFilters.retainer_handler);
                    if (rhEmp) {
                        leadsQuery = leadsQuery.eq('retainer_handler_id', rhEmp.id);
                    }
                }
            }
            if (reassignFilters.helper_handler) {
                /*
                 * Helper Handler is held by several people at once, so the lead carries an array of
                 * employee ids rather than one. The array is derived from `lead_helper_handlers` by
                 * trigger, which is what makes it safe to filter on here.
                 */
                if (isReassignRoleNoneFilter(reassignFilters.helper_handler)) {
                    leadsQuery = leadsQuery.eq('helper_handler_ids', '{}');
                } else {
                    const hhEmp = employees.find(emp => emp.display_name === reassignFilters.helper_handler);
                    if (hhEmp) {
                        leadsQuery = leadsQuery.contains('helper_handler_ids', [hhEmp.id]);
                    }
                }
            }
            if (reassignFilters.client_support) {
                if (isReassignRoleNoneFilter(reassignFilters.client_support)) {
                    leadsQuery = leadsQuery.is('client_support_id', null);
                } else {
                    const csEmp = employees.find(emp => emp.display_name === reassignFilters.client_support);
                    if (csEmp) {
                        leadsQuery = leadsQuery.eq('client_support_id', csEmp.id);
                    }
                }
            }
            if (reassignFilters.activeHandlerType) {
                // Plain equality: the column holds 1 or 2 on every row of both lead tables, so
                // there is no unset third state to fold in here.
                leadsQuery = leadsQuery.eq(
                    'active_handler_type',
                    ACTIVE_HANDLER_TYPE[reassignFilters.activeHandlerType as keyof typeof ACTIVE_HANDLER_TYPE],
                );
            }
            if (reassignFilters.selectedLeadIds && reassignFilters.selectedLeadIds.length > 0) {
                console.log('🔍 Adding selected lead IDs filter for new leads:', reassignFilters.selectedLeadIds);
                // Filter by IDs (only new leads, not legacy)
                const newLeadIds = reassignFilters.selectedLeadIds
                    .filter(id => !id.toString().startsWith('legacy_'))
                    .map(id => id.toString());
                if (newLeadIds.length > 0) {
                    if (newLeadIds.length === 1) {
                        leadsQuery = leadsQuery.eq('id', newLeadIds[0]); // UUID, not parseInt
                    } else {
                        leadsQuery = leadsQuery.in('id', newLeadIds); // UUIDs, not parseInt
                    }
                } else {
                    // If only legacy leads are selected, use a non-existent UUID to return no results
                    leadsQuery = leadsQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // Non-existent UUID
                }
            }

            searchPromises.push(leadsQuery.order('created_at', { ascending: false }));

            // Search in leads_lead table (legacy leads) with joins for language and category only (source lookup done manually)
            let legacyLeadsQuery = supabase
                .from('leads_lead')
                .select(`
          id,
          lead_number,
          manual_id,
          master_id,
          name,
          cdate,
          meeting_scheduler_id,
          closer_id,
          meeting_manager_id,
          case_handler_id,
          meeting_lawyer_id,
          expert_id,
          retainer_handler_id,
          helper_handler_ids,
          client_support_id,
          active_handler_type,
          category,
          category_id,
          source_id,
          language_id,
          stage,
          total,
          total_base,
          currency_id,
          subcontractor_fee,
          no_of_applicants,
          accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
          case_handler:tenants_employee!case_handler_id(
            id,
            display_name,
            photo_url
          ),
          misc_language!leads_lead_language_id_fkey (
            id,
            name
          ),
          misc_category!category_id (
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          )
        `);

            if (reassignFilters.fromDate) {
                legacyLeadsQuery = legacyLeadsQuery.gte('cdate', `${reassignFilters.fromDate}T00:00:00`);
            }
            if (reassignFilters.toDate) {
                legacyLeadsQuery = legacyLeadsQuery.lte('cdate', `${reassignFilters.toDate}T23:59:59`);
            }
            if (reassignFilters.category && reassignFilters.category.length > 0) {
                console.log('🏷️ Adding category filter for legacy leads:', reassignFilters.category);
                if (reassignFilters.category.length === 1) {
                    legacyLeadsQuery = legacyLeadsQuery.ilike('category', `%${reassignFilters.category[0]}%`);
                } else {
                    // For multiple categories, use OR condition
                    const orConditions = reassignFilters.category.map(cat => `category.ilike.%${cat}%`);
                    legacyLeadsQuery = legacyLeadsQuery.or(orConditions.join(','));
                }
            }
            if (reassignFilters.source && reassignFilters.source.length > 0) {
                console.log('📡 Adding source filter for legacy leads:', reassignFilters.source);
                try {
                    const { data: sourceData } = await supabase
                        .from('misc_leadsource')
                        .select('id')
                        .in('name', reassignFilters.source);

                    if (sourceData && sourceData.length > 0) {
                        const sourceIds = sourceData.map(s => s.id);
                        if (sourceIds.length === 1) {
                            legacyLeadsQuery = legacyLeadsQuery.eq('source_id', sourceIds[0]);
                        } else {
                            legacyLeadsQuery = legacyLeadsQuery.in('source_id', sourceIds);
                        }
                    }
                } catch (error) {
                    console.log('Could not find source IDs for:', reassignFilters.source);
                }
            }
            if (reassignFilters.status && reassignFilters.status.length > 0) {
                console.log('📊 Adding status filter for legacy leads (Active/Not active):', reassignFilters.status);
                const includeActive = reassignFilters.status.includes('Active');
                const includeInactive = reassignFilters.status.includes('Not active');

                // Legacy mapping: status 0 = Active, status 10 = Not active, status null = Active (subleads)
                if (includeActive && !includeInactive) {
                    // Active: status = 0 OR status IS NULL (subleads are considered active)
                    legacyLeadsQuery = legacyLeadsQuery.or('status.eq.0,status.is.null');
                } else if (!includeActive && includeInactive) {
                    // Not active: status = 10 only (excludes status null and status 0)
                    legacyLeadsQuery = legacyLeadsQuery.eq('status', 10);
                }
                // If both selected, don't filter (includes all)
            }
            if (reassignFilters.eligibilityDeterminedOnly) {
                console.log('✅ Adding eligibility filter for legacy leads');
                legacyLeadsQuery = legacyLeadsQuery.eq('eligibile', 'true');
            }
            if (reassignFilters.language && reassignFilters.language.length > 0) {
                console.log('🌐 Adding language filter for legacy leads:', reassignFilters.language);
                // Check if filtering for N/A
                const hasNAFilter = reassignFilters.language.some(lang =>
                    lang.toUpperCase() === 'N/A' || lang === 'N/A'
                );
                const nonNALanguages = reassignFilters.language.filter(lang =>
                    lang.toUpperCase() !== 'N/A' && lang !== 'N/A'
                );

                if (hasNAFilter && nonNALanguages.length === 0) {
                    // Only filtering for N/A - find leads where language_id is null
                    legacyLeadsQuery = legacyLeadsQuery.is('language_id', null);
                } else if (hasNAFilter && nonNALanguages.length > 0) {
                    // Filtering for both N/A and specific languages
                    try {
                        const { data: languageData } = await supabase
                            .from('misc_language')
                            .select('id')
                            .in('name', nonNALanguages);

                        const languageIds = languageData?.map(l => l.id) || [];
                        const orConditions = ['language_id.is.null'];
                        languageIds.forEach(id => {
                            orConditions.push(`language_id.eq.${id}`);
                        });
                        legacyLeadsQuery = legacyLeadsQuery.or(orConditions.join(','));
                    } catch (error) {
                        console.log('Could not find language IDs for:', nonNALanguages);
                    }
                } else {
                    // Only filtering for specific languages (not N/A)
                    try {
                        const { data: languageData } = await supabase
                            .from('misc_language')
                            .select('id')
                            .in('name', nonNALanguages);

                        if (languageData && languageData.length > 0) {
                            const languageIds = languageData.map(l => l.id);
                            if (languageIds.length === 1) {
                                legacyLeadsQuery = legacyLeadsQuery
                                    .eq('language_id', languageIds[0])
                                    .not('language_id', 'is', null);
                            } else {
                                legacyLeadsQuery = legacyLeadsQuery
                                    .in('language_id', languageIds)
                                    .not('language_id', 'is', null);
                            }
                        }
                    } catch (error) {
                        console.log('Could not find language IDs for:', nonNALanguages);
                    }
                }
            }
            if (reassignFilters.stage && reassignFilters.stage.length > 0) {
                console.log('🎯 Adding stage filter for legacy leads:', reassignFilters.stage);
                try {
                    const stageIds: number[] = [];
                    for (const stageName of reassignFilters.stage) {
                        const trimmedStage = stageName.trim();

                        // Special case: "Created" should map to stage ID 0
                        if (trimmedStage.toLowerCase() === 'created') {
                            stageIds.push(0);
                            continue;
                        }

                        const stage = stages.find(s => s.name === trimmedStage);
                        if (stage) {
                            stageIds.push(stage.id);
                        }
                    }

                    if (stageIds.length > 0) {
                        if (stageIds.length === 1) {
                            legacyLeadsQuery = legacyLeadsQuery.eq('stage', stageIds[0]);
                        } else {
                            legacyLeadsQuery = legacyLeadsQuery.in('stage', stageIds);
                        }
                    }
                } catch (error) {
                    console.error('⚠️ Stage lookup failed for legacy leads:', error);
                }
            }
            if (reassignFilters.meetingScheduler) {
                if (isReassignRoleNoneFilter(reassignFilters.meetingScheduler)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('meeting_scheduler_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.meetingScheduler);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('meeting_scheduler_id', employee.id);
                    }
                }
            }
            if (reassignFilters.closer) {
                if (isReassignRoleNoneFilter(reassignFilters.closer)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('closer_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.closer);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('closer_id', employee.id);
                    }
                }
            }
            if (reassignFilters.meetingManager) {
                if (isReassignRoleNoneFilter(reassignFilters.meetingManager)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('meeting_manager_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.meetingManager);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('meeting_manager_id', employee.id);
                    }
                }
            }
            if (reassignFilters.handler) {
                if (isReassignRoleNoneFilter(reassignFilters.handler)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('case_handler_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.handler);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('case_handler_id', employee.id);
                    }
                }
            }
            if (reassignFilters.helper) {
                if (isReassignRoleNoneFilter(reassignFilters.helper)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('meeting_lawyer_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.helper);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('meeting_lawyer_id', employee.id);
                    }
                }
            }
            if (reassignFilters.expert) {
                if (isReassignRoleNoneFilter(reassignFilters.expert)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('expert_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.expert);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('expert_id', employee.id);
                    }
                }
            }
            if (reassignFilters.retainer_handler) {
                if (isReassignRoleNoneFilter(reassignFilters.retainer_handler)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('retainer_handler_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.retainer_handler);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('retainer_handler_id', employee.id);
                    }
                }
            }
            if (reassignFilters.helper_handler) {
                if (isReassignRoleNoneFilter(reassignFilters.helper_handler)) {
                    legacyLeadsQuery = legacyLeadsQuery.eq('helper_handler_ids', '{}');
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.helper_handler);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.contains('helper_handler_ids', [employee.id]);
                    }
                }
            }
            if (reassignFilters.client_support) {
                if (isReassignRoleNoneFilter(reassignFilters.client_support)) {
                    legacyLeadsQuery = legacyLeadsQuery.is('client_support_id', null);
                } else {
                    const employee = employees.find(emp => emp.display_name === reassignFilters.client_support);
                    if (employee) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('client_support_id', employee.id);
                    }
                }
            }
            if (reassignFilters.activeHandlerType) {
                legacyLeadsQuery = legacyLeadsQuery.eq(
                    'active_handler_type',
                    ACTIVE_HANDLER_TYPE[reassignFilters.activeHandlerType as keyof typeof ACTIVE_HANDLER_TYPE],
                );
            }
            if (reassignFilters.selectedLeadIds && reassignFilters.selectedLeadIds.length > 0) {
                console.log('🔍 Adding selected lead IDs filter for legacy leads:', reassignFilters.selectedLeadIds);
                // Filter by IDs (only legacy leads)
                const legacyLeadIds = reassignFilters.selectedLeadIds
                    .filter(id => id.toString().startsWith('legacy_'))
                    .map(id => parseInt(id.toString().replace('legacy_', '')));
                if (legacyLeadIds.length > 0) {
                    if (legacyLeadIds.length === 1) {
                        legacyLeadsQuery = legacyLeadsQuery.eq('id', legacyLeadIds[0]);
                    } else {
                        legacyLeadsQuery = legacyLeadsQuery.in('id', legacyLeadIds);
                    }
                } else {
                    // If only new leads are selected, return empty results for legacy leads
                    legacyLeadsQuery = legacyLeadsQuery.eq('id', -1); // Non-existent ID to return no results
                }
            }

            searchPromises.push(legacyLeadsQuery.order('cdate', { ascending: false }));

            const [leadsResult, legacyLeadsResult] = await Promise.all(searchPromises);

            if (leadsResult.error) throw leadsResult.error;
            if (legacyLeadsResult.error) throw legacyLeadsResult.error;

            // Create mappings for source, category, and language (similar to LeadSearchPage)
            const sourceMapping = new Map<number, string>();
            const categoryMapping = new Map<number, string>();
            const handlerEmployeeMap = new Map<string, { id: number; display_name: string; photo_url?: string | null }>();

            try {
                const [sourcesResult, categoriesResult] = await Promise.all([
                    supabase.from('misc_leadsource').select('id, name'),
                    supabase.from('misc_category').select('id, name, parent_id, misc_maincategory!parent_id(id, name)')
                ]);

                if (sourcesResult.data) {
                    sourcesResult.data.forEach(source => {
                        sourceMapping.set(source.id, source.name);
                    });
                }

                if (categoriesResult.data) {
                    categoriesResult.data.forEach((category: any) => {
                        const mainRel = category.misc_maincategory;
                        const mainCategory = Array.isArray(mainRel)
                            ? mainRel[0]?.name
                            : mainRel?.name;
                        const categoryName = mainCategory
                            ? `${category.name} (${mainCategory})`
                            : category.name;
                        categoryMapping.set(category.id, categoryName);
                    });
                }

                // Fetch handler employees for new leads (handler is stored as text/name)
                const handlerNames = new Set<string>();
                (leadsResult.data || []).forEach((lead: any) => {
                    if (typeof lead.handler === 'string' && !isUnassignedHandlerValue(lead.handler)) {
                        handlerNames.add(lead.handler.trim());
                    }
                });

                if (handlerNames.size > 0) {
                    const { data: handlerEmployees } = await supabase
                        .from('tenants_employee')
                        .select('id, display_name, photo_url')
                        .in('display_name', Array.from(handlerNames));

                    if (handlerEmployees) {
                        handlerEmployees.forEach(emp => {
                            if (emp.display_name) {
                                handlerEmployeeMap.set(emp.display_name, emp);
                            }
                        });
                    }
                }
            } catch (error) {
                console.log('⚠️ Failed to load source/category/handler mapping:', error);
            }

            // Calculate sublead suffixes for new leads (similar to LeadSearchPage.tsx)
            const newLeadsData = leadsResult.data || [];
            const newSubLeadSuffixMap = new Map<string, number>();
            const newMasterIdsWithSubLeads = new Set<string>();
            const newLeadsWithMaster = newLeadsData.filter((l: any) => l.master_id);
            const newMasterIds = Array.from(new Set(newLeadsWithMaster.map((l: any) => l.master_id?.toString()).filter(Boolean)));

            for (const masterId of newMasterIds) {
                const sameMasterLeads = newLeadsData.filter((l: any) => l.master_id?.toString() === masterId);
                sameMasterLeads.sort((a: any, b: any) => {
                    const aId = typeof a.id === 'string' ? parseInt(a.id) || 0 : (a.id || 0);
                    const bId = typeof b.id === 'string' ? parseInt(b.id) || 0 : (b.id || 0);
                    return aId - bId;
                });

                if (sameMasterLeads.length > 0) {
                    newMasterIdsWithSubLeads.add(masterId);
                }

                sameMasterLeads.forEach((lead: any, index: number) => {
                    const leadKey = lead.id?.toString();
                    if (leadKey) {
                        newSubLeadSuffixMap.set(leadKey, index + 2);
                    }
                });
            }

            // Calculate sublead suffixes for legacy leads
            const legacyLeadsData = legacyLeadsResult.data || [];
            const legacySubLeadSuffixMap = new Map<string, number>();
            const legacyMasterIdsWithSubLeads = new Set<string>();
            const legacyLeadsWithMaster = legacyLeadsData.filter((l: any) => l.master_id);
            const legacyMasterIds = Array.from(new Set(legacyLeadsWithMaster.map((l: any) => l.master_id?.toString()).filter(Boolean)));

            for (const masterId of legacyMasterIds) {
                const sameMasterLeads = legacyLeadsData.filter((l: any) => l.master_id?.toString() === masterId);
                sameMasterLeads.sort((a: any, b: any) => {
                    const aId = typeof a.id === 'string' ? parseInt(a.id) || 0 : (a.id || 0);
                    const bId = typeof b.id === 'string' ? parseInt(b.id) || 0 : (b.id || 0);
                    return aId - bId;
                });

                if (sameMasterLeads.length > 0) {
                    legacyMasterIdsWithSubLeads.add(masterId);
                }

                sameMasterLeads.forEach((lead: any, index: number) => {
                    const leadKey = lead.id?.toString();
                    if (leadKey) {
                        legacySubLeadSuffixMap.set(leadKey, index + 2);
                    }
                });
            }

            // Format category display function (similar to LeadSearchPage)
            const formatCategoryDisplay = (lead: any) => {
                // Check if we have joined category data
                if (lead.misc_category) {
                    const category = lead.misc_category;
                    const mainRel = category.misc_maincategory;
                    const mainCategory = Array.isArray(mainRel)
                        ? mainRel[0]?.name
                        : mainRel?.name;
                    const categoryName = mainCategory
                        ? `${category.name} (${mainCategory})`
                        : category.name;
                    return categoryName;
                }
                // Fallback to direct category field or mapping
                if (lead.category_id) {
                    return categoryMapping.get(lead.category_id) || lead.category || 'No Category';
                }
                return lead.category || 'No Category';
            };

            let allResults = [
                ...newLeadsData.map((lead: any) => {
                    // Format lead number with sublead handling
                    let displayLeadNumber: string;
                    if (lead.master_id) {
                        // It's a sublead
                        if (lead.lead_number && String(lead.lead_number).includes('/')) {
                            displayLeadNumber = lead.lead_number;
                        } else {
                            const leadKey = lead.id?.toString();
                            const suffix = leadKey ? newSubLeadSuffixMap.get(leadKey) : undefined;
                            const masterLead = newLeadsData.find((l: any) => l.id === lead.master_id);
                            const masterLeadNumber = masterLead?.lead_number || lead.master_id?.toString() || '';
                            displayLeadNumber = suffix ? `${masterLeadNumber}/${suffix}` : `${masterLeadNumber}/2`;
                        }
                    } else {
                        // It's a master lead or standalone lead
                        const baseNumber = lead.lead_number || lead.manual_id || lead.id?.toString() || '';
                        const leadIdStr = lead.id?.toString();
                        const hasSubLeads = leadIdStr && newMasterIdsWithSubLeads.has(leadIdStr);
                        if (hasSubLeads && baseNumber && !baseNumber.includes('/')) {
                            displayLeadNumber = `${baseNumber}/1`;
                        } else {
                            displayLeadNumber = baseNumber;
                        }
                    }

                    // Format language - use language field if available, otherwise 'N/A'
                    const languageName = lead.language || (lead.language_id === null ? 'N/A' : 'Unknown');

                    // Get handler employee info for new leads
                    const handlerEmployee = !isUnassignedHandlerValue(lead.handler) ? handlerEmployeeMap.get(lead.handler) : null;

                    return {
                        ...lead,
                        lead_type: 'new',
                        display_lead_number: String(displayLeadNumber),
                        scheduler: lead.scheduler || 'Unassigned',
                        created_at: lead.created_at,
                        source: lead.source || 'Unknown',
                        language: languageName,
                        category: formatCategoryDisplay(lead),
                        handlerEmployee: handlerEmployee || null,
                    };
                }),
                ...legacyLeadsData.map((lead: any) => {
                    // Format lead number with sublead handling
                    let displayLeadNumber: string;
                    if (lead.master_id) {
                        // It's a sublead
                        if (lead.lead_number && String(lead.lead_number).includes('/')) {
                            displayLeadNumber = lead.lead_number;
                        } else {
                            const leadKey = lead.id?.toString();
                            const suffix = leadKey ? legacySubLeadSuffixMap.get(leadKey) : undefined;
                            const masterLead = legacyLeadsData.find((l: any) => l.id === lead.master_id);
                            const masterLeadNumber = masterLead?.lead_number || masterLead?.manual_id || lead.master_id?.toString() || '';
                            displayLeadNumber = suffix ? `${masterLeadNumber}/${suffix}` : `${masterLeadNumber}/2`;
                        }
                    } else {
                        // It's a master lead or standalone lead
                        const baseNumber = lead.manual_id || lead.lead_number || lead.id?.toString() || '';
                        const leadIdStr = lead.id?.toString();
                        const hasSubLeads = leadIdStr && legacyMasterIdsWithSubLeads.has(leadIdStr);
                        if (hasSubLeads && baseNumber && !baseNumber.includes('/')) {
                            displayLeadNumber = `${baseNumber}/1`;
                        } else {
                            displayLeadNumber = baseNumber;
                        }
                    }

                    // Get source name from mapping (source is not joined, fetched separately)
                    const sourceName = lead.source_id ?
                        sourceMapping.get(lead.source_id) || 'Unknown' :
                        'Unknown';

                    // Get language name from joined data
                    const languageName = lead.misc_language?.name || 'N/A';

                    // Get category name from joined data or mapping
                    let categoryName = 'No Category';
                    if (lead.misc_category) {
                        const category = lead.misc_category;
                        const mainRel = category.misc_maincategory;
                        const mainCategory = Array.isArray(mainRel)
                            ? mainRel[0]?.name
                            : mainRel?.name;
                        categoryName = mainCategory
                            ? `${category.name} (${mainCategory})`
                            : category.name;
                    } else if (lead.category_id) {
                        categoryName = categoryMapping.get(lead.category_id) || lead.category || 'No Category';
                    } else if (lead.category) {
                        categoryName = lead.category;
                    }

                    // Get handler employee info for legacy leads (from joined case_handler)
                    const handlerEmployee = lead.case_handler ? {
                        id: lead.case_handler.id,
                        display_name: lead.case_handler.display_name,
                        photo_url: lead.case_handler.photo_url
                    } : null;

                    return {
                        ...lead,
                        lead_type: 'legacy',
                        display_lead_number: String(displayLeadNumber),
                        scheduler: lead.meeting_scheduler_id ?
                            employees.find(emp => emp.id === lead.meeting_scheduler_id)?.display_name || 'Unknown' :
                            'Unassigned',
                        created_at: lead.cdate,
                        handlerEmployee: handlerEmployee,
                        source: sourceName,
                        language: languageName,
                        category: categoryName,
                    };
                })
            ];

            // Client-side filtering is no longer needed since we filter server-side
            // The arrays are handled in the Supabase queries above

            setReassignResults(allResults);
        } catch (error) {
            console.error('Error searching leads for re-assignment:', error);
            toast.error('Failed to search leads. Please try again.');
        } finally {
            setReassignLoading(false);
        }
    };

    /**
     * Give one employee the Helper Handler role on these leads, and optionally take it off another.
     *
     * The one role several people can hold at once, so it is not a column to overwrite: assignments
     * are rows in `lead_helper_handlers`, and the `helper_handler_ids` column on each lead table is
     * derived from them by trigger. Re-assigning therefore means adding the new person and, when the
     * search named someone, removing that person from the same leads.
     */
    const assignHelperHandlerRows = async (
        leadsToChange: any[],
        employeeId: number,
        removeEmployeeId: number | null,
        createdBy: string,
    ): Promise<void> => {
        const newLeadIds = leadsToChange
            .filter(lead => lead.lead_type === 'new')
            .map(lead => String(lead.id));
        const legacyLeadIds = leadsToChange
            .filter(lead => lead.lead_type === 'legacy')
            .map(lead => Number(String(lead.id).replace(/^legacy_/, '')))
            .filter(id => Number.isFinite(id));

        /*
         * Who already holds the role. One insert for the whole batch is a single round trip, but a
         * row that is already there would fail the one-per-employee-per-lead index and take the rest
         * of the batch down with it, so those leads are left out of the insert.
         */
        const alreadyHeld = new Set<string>();
        if (newLeadIds.length > 0) {
            const { data, error } = await supabase
                .from('lead_helper_handlers')
                .select('new_lead_id')
                .eq('employee_id', employeeId)
                .in('new_lead_id', newLeadIds);
            if (error) throw error;
            (data ?? []).forEach((row: any) => alreadyHeld.add(`new:${row.new_lead_id}`));
        }
        if (legacyLeadIds.length > 0) {
            const { data, error } = await supabase
                .from('lead_helper_handlers')
                .select('legacy_lead_id')
                .eq('employee_id', employeeId)
                .in('legacy_lead_id', legacyLeadIds);
            if (error) throw error;
            (data ?? []).forEach((row: any) => alreadyHeld.add(`legacy:${row.legacy_lead_id}`));
        }

        const rows = leadsToChange
            .map(lead =>
                buildHelperHandlerRow(
                    lead.lead_type === 'legacy' ? `legacy_${String(lead.id).replace(/^legacy_/, '')}` : String(lead.id),
                    employeeId,
                    createdBy,
                ),
            )
            .filter((row): row is LeadHelperHandlerRow => row !== null)
            .filter(row => !alreadyHeld.has(row.new_lead_id ? `new:${row.new_lead_id}` : `legacy:${row.legacy_lead_id}`));

        if (rows.length > 0) {
            const { error } = await supabase.from('lead_helper_handlers').insert(rows);
            if (error) throw error;
        }

        if (removeEmployeeId) {
            if (newLeadIds.length > 0) {
                const { error } = await supabase
                    .from('lead_helper_handlers')
                    .delete()
                    .eq('employee_id', removeEmployeeId)
                    .in('new_lead_id', newLeadIds);
                if (error) throw error;
            }
            if (legacyLeadIds.length > 0) {
                const { error } = await supabase
                    .from('lead_helper_handlers')
                    .delete()
                    .eq('employee_id', removeEmployeeId)
                    .in('legacy_lead_id', legacyLeadIds);
                if (error) throw error;
            }
        }
    };

    /** The employee a Helper Handler reassignment takes the role away from, if the search named one. */
    const helperHandlerBeingReplaced = () => {
        const name = isReassignRoleNoneFilter(reassignFilters.helper_handler)
            ? ''
            : String(reassignFilters.helper_handler || '').trim();
        if (!name || name === selectedEmployeeForReassign) return null;
        return employees.find(emp => emp.display_name === name) ?? null;
    };

    /**
     * Apply the role change to the selected leads.
     *
     * Split out of `handleReassignLeads` so the confirmation modal can run it from either of its
     * buttons: the assignment is the same work whether or not the clients are emailed afterwards.
     *
     * @returns true when the change was written, so a caller can hold off on notifying clients
     *   about something that did not happen.
     */
    const performReassign = async (): Promise<boolean> => {
        const roleName = REASSIGN_ROLE_LABELS[selectedRoleForReassign] || selectedRoleForReassign;
        setReassigning(true);
        try {
            const account = instance?.getAllAccounts()[0];
            let currentUserFullName = account?.name || 'Unknown User';

            if (account?.username) {
                try {
                    const { data: userData } = await supabase
                        .from('users')
                        .select('full_name')
                        .eq('email', account.username)
                        .single();

                    if (userData?.full_name) {
                        currentUserFullName = userData.full_name;
                    }
                } catch (error) {
                    console.log('Could not fetch user full_name, using account.name as fallback');
                }
            }

            const selectedEmployee = employees.find(emp => emp.display_name === selectedEmployeeForReassign);
            if (!selectedEmployee) {
                throw new Error('Selected employee not found');
            }

            // Filter to only selected leads
            const selectedLeadsArray = reassignResults.filter(lead =>
                selectedLeads.has(lead.id?.toString() || '')
            );

            const newLeads = selectedLeadsArray.filter(lead => lead.lead_type === 'new');
            const legacyLeads = selectedLeadsArray.filter(lead => lead.lead_type === 'legacy');
            const replacedHelperHandler = helperHandlerBeingReplaced();

            // Prepare update object based on selected role
            const updateFields: any = {
                stage_changed_by: currentUserFullName,
                stage_changed_at: new Date().toISOString()
            };

            // For new leads, different roles use different fields
            if (selectedRoleForReassign === 'scheduler') {
                updateFields.scheduler = selectedEmployeeForReassign;
                updateFields.stage = SCHEDULER_STAGE_ID;
            } else if (selectedRoleForReassign === 'closer') {
                updateFields.closer = selectedEmployeeForReassign;
            } else if (selectedRoleForReassign === 'meetingManager') {
                updateFields.manager = selectedEmployeeForReassign;
                updateFields.meeting_manager_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'handler') {
                updateFields.handler = selectedEmployeeForReassign;
                updateFields.case_handler_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'helper') {
                updateFields.helper = selectedEmployeeForReassign;
                updateFields.meeting_lawyer_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'expert') {
                // New leads: expert column is employee id (RolesTab)
                updateFields.expert = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'retainer_handler') {
                updateFields.retainer_handler_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'client_support') {
                updateFields.client_support_id = selectedEmployee.id;
            }

            if (newLeads.length > 0) {
                const newLeadIds = newLeads.map(lead => lead.id);
                const { error: newLeadsError } = await supabase
                    .from('leads')
                    .update(updateFields)
                    .in('id', newLeadIds);

                if (newLeadsError) throw newLeadsError;
            }

            // For legacy leads, different roles use different ID fields
            const legacyUpdateFields: any = {
                stage_changed_by: currentUserFullName,
                stage_changed_at: new Date().toISOString()
            };

            if (selectedRoleForReassign === 'scheduler') {
                legacyUpdateFields.meeting_scheduler_id = selectedEmployee.id;
                legacyUpdateFields.stage = SCHEDULER_STAGE_ID;
            } else if (selectedRoleForReassign === 'closer') {
                legacyUpdateFields.closer_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'meetingManager') {
                legacyUpdateFields.meeting_manager_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'handler') {
                legacyUpdateFields.case_handler_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'helper') {
                legacyUpdateFields.meeting_lawyer_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'expert') {
                legacyUpdateFields.expert_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'retainer_handler') {
                legacyUpdateFields.retainer_handler_id = selectedEmployee.id;
            } else if (selectedRoleForReassign === 'client_support') {
                legacyUpdateFields.client_support_id = selectedEmployee.id;
            }

            if (legacyLeads.length > 0) {
                const legacyLeadIds = legacyLeads.map(lead => lead.id);
                const { error: legacyLeadsError } = await supabase
                    .from('leads_lead')
                    .update(legacyUpdateFields)
                    .in('id', legacyLeadIds);

                if (legacyLeadsError) throw legacyLeadsError;
            }

            if (selectedRoleForReassign === 'helper_handler') {
                await assignHelperHandlerRows(
                    selectedLeadsArray,
                    selectedEmployee.id,
                    replacedHelperHandler?.id ?? null,
                    currentUserFullName,
                );
            }

            // Only insert stage records if reassigning to scheduler (which changes stage)
            if (selectedRoleForReassign === 'scheduler') {
                const stageRecords = selectedLeadsArray.map(lead => ({
                    cdate: new Date().toISOString(),
                    udate: new Date().toISOString(),
                    stage: SCHEDULER_STAGE_ID,
                    date: new Date().toISOString(),
                    creator_id: selectedEmployee.id,
                    lead_id: lead.lead_number ? parseInt(lead.lead_number.replace('L', '')) : lead.id
                }));

                const { error: stageError } = await supabase
                    .from('leads_leadstage')
                    .insert(stageRecords);

                if (stageError) {
                    console.error('Error inserting stage records:', stageError);
                }
            }

            toast.success(
                selectedRoleForReassign === 'helper_handler'
                    ? `${selectedEmployeeForReassign} is now a ${roleName} on ${selectedLeads.size} lead(s)` +
                      (replacedHelperHandler ? `, and ${replacedHelperHandler.display_name} is not.` : '. Other helper handlers were kept.')
                    : `Assigned ${selectedEmployeeForReassign} as ${roleName} on ${selectedLeads.size} lead(s). Other roles were not changed.`
            );

            // Keep leads in the list (search filter may still apply); clear selection and assign bar
            setSelectedLeads(new Set());
            setSelectedEmployeeForReassign('');
            setAssignEmployeeSearchTerm('');

            return true;
        } catch (error) {
            console.error('Error assigning role on leads:', error);
            toast.error('Failed to assign role. Please try again.');
            return false;
        } finally {
            setReassigning(false);
        }
    };

    /**
     * The bulk "Assign role" button.
     *
     * Case handler and retention handler open the confirmation modal, because those two are the ones
     * the client gets told about and the list of who is about to be emailed is worth seeing first.
     * Every other role is internal, so it keeps the original confirm dialog.
     */
    const handleReassignLeads = async () => {
        if (selectedLeads.size === 0) {
            toast.error('Please select at least one lead.');
            return;
        }

        if (!selectedEmployeeForReassign || !selectedRoleForReassign) {
            toast.error('Choose a role to assign and an employee.');
            return;
        }

        const roleName = REASSIGN_ROLE_LABELS[selectedRoleForReassign] || selectedRoleForReassign;
        const notifyRole = REASSIGN_NOTIFY_ROLE_BY_KEY[selectedRoleForReassign];

        if (notifyRole) {
            const employee = employees.find(emp => emp.display_name === selectedEmployeeForReassign);
            if (!employee) {
                toast.error('That employee could not be found. Pick someone from the list.');
                return;
            }
            setNotifyFlow({
                role: notifyRole,
                employeeId: employee.id,
                employeeName: employee.display_name,
                // Captured now: the assignment clears the selection before the emails go out.
                leads: reassignResults
                    .filter(lead => selectedLeads.has(lead.id?.toString() || ''))
                    .map(toReassignNotifyLead),
            });
            return;
        }

        const replaced = selectedRoleForReassign === 'helper_handler' ? helperHandlerBeingReplaced() : null;
        const confirmReassign = confirm(
            selectedRoleForReassign === 'helper_handler'
                ? `Add ${selectedEmployeeForReassign} as a ${roleName} on ${selectedLeads.size} selected lead(s)?\n\n` +
                      (replaced
                          ? `${replaced.display_name} loses the role on those leads. Any other helper handler keeps it, and no other role changes.`
                          : `Several people can hold this role, so anyone already holding it keeps it. No other role changes.`)
                : `Assign ${selectedEmployeeForReassign} as ${roleName} on ${selectedLeads.size} selected lead(s)?\n\n` +
                      `Only the ${roleName} field will be updated; other roles on each lead stay unchanged.`
        );
        if (!confirmReassign) return;

        await performReassign();
    };

    const closeNotifyFlow = () => {
        setNotifyFlow(null);
        setNotifyProgress(null);
    };

    const handleAssignWithoutEmail = async () => {
        setNotifySending(true);
        try {
            await performReassign();
            closeNotifyFlow();
        } finally {
            setNotifySending(false);
        }
    };

    const handleAssignAndEmail = async (options: {
        language: ReassignNotifyLanguage;
        emailLeadIds: string[];
    }) => {
        const flow = notifyFlow;
        if (!flow) return;

        setNotifySending(true);
        try {
            // Nothing is emailed about an assignment that failed to save.
            if (!(await performReassign())) return;

            const leads = flow.leads.filter(lead => options.emailLeadIds.includes(lead.id));
            if (leads.length === 0) {
                closeNotifyFlow();
                return;
            }

            setNotifyProgress({ done: 0, total: leads.length });
            const outcome = await sendReassignNotifications({
                role: flow.role,
                language: options.language,
                newEmployeeId: flow.employeeId,
                leads,
                onProgress: (done, total) => setNotifyProgress({ done, total }),
            });

            if (outcome.sent.length > 0) {
                toast.success(`Notified ${outcome.sent.length} client${outcome.sent.length === 1 ? '' : 's'}.`);
            }
            if (outcome.skipped.length > 0) {
                toast(`${outcome.skipped.length} lead(s) had no client email: ${outcome.skipped.map(s => s.leadNumber).join(', ')}`);
            }
            if (outcome.failed.length > 0) {
                console.error('Reassignment notification failures:', outcome.failed);
                toast.error(`${outcome.failed.length} email(s) failed to send: ${outcome.failed.map(f => f.leadNumber).join(', ')}`);
            }
            closeNotifyFlow();
        } catch (error) {
            if (error instanceof MailboxNotConnectedError) {
                // The reassignment is already saved, so this is only about the emails.
                toast.error('Connect your Outlook mailbox to send these emails. The leads were still reassigned.');
                closeNotifyFlow();
                return;
            }
            console.error('Reassignment notification send failed:', error);
            toast.error('The leads were reassigned, but the emails could not be sent.');
            closeNotifyFlow();
        } finally {
            setNotifySending(false);
        }
    };

    const openActiveHandlerModal = () => {
        if (selectedLeads.size === 0) {
            toast.error('Select at least one lead.');
            return;
        }
        setSingleLeadActiveFlow(null);
        const first = reassignResults.find(lead => selectedLeads.has(lead.id?.toString() || ''));
        const t = Number((first as any)?.active_handler_type);
        setActiveHandlerTypeChoice(t === 1 ? 1 : 2);
        setShowActiveHandlerModal(true);
    };

    const performBulkActiveHandlerUpdate = async (selectedList: any[], choice: 1 | 2) => {
        const newLeads = selectedList.filter(lead => lead.lead_type === 'new');
        const legacyLeads = selectedList.filter(lead => lead.lead_type === 'legacy');
        const newIds = newLeads.map(l => l.id).filter(Boolean);
        const legacyIds = legacyLeads.map(l => l.id).filter(Boolean);

        if (newIds.length === 0 && legacyIds.length === 0) {
            throw new Error('NO_MATCHING_IDS');
        }

        if (newIds.length > 0) {
            const { error } = await supabase
                .from('leads')
                .update({ active_handler_type: choice })
                .in('id', newIds as string[]);
            if (error) throw error;
        }
        if (legacyIds.length > 0) {
            const { error } = await supabase
                .from('leads_lead')
                .update({ active_handler_type: choice })
                .in('id', legacyIds as (string | number)[]);
            if (error) throw error;
        }
    };

    const resolveStageAttribution = async () => {
        const account = instance?.getAllAccounts()[0];
        let currentUserFullName = account?.name || 'Unknown User';
        if (account?.username) {
            try {
                const { data: userData } = await supabase
                    .from('users')
                    .select('full_name')
                    .eq('email', account.username)
                    .single();
                if (userData?.full_name) {
                    currentUserFullName = userData.full_name;
                }
            } catch {
                // keep fallback name
            }
        }
        return {
            stage_changed_by: currentUserFullName,
            stage_changed_at: new Date().toISOString(),
        };
    };

    const assignMissingRoleToLeads = async (
        leads: any[],
        role: 'handler' | 'retainer_handler',
        employeeDisplayName: string
    ) => {
        const selectedEmployee = employees.find(emp => emp.display_name === employeeDisplayName);
        if (!selectedEmployee) {
            throw new Error('EMPLOYEE_NOT_FOUND');
        }
        const { stage_changed_by, stage_changed_at } = await resolveStageAttribution();
        const newLeads = leads.filter(l => l.lead_type === 'new');
        const legacyLeads = leads.filter(l => l.lead_type === 'legacy');

        if (role === 'handler') {
            const newIds = newLeads.map(l => l.id).filter(Boolean);
            const legacyIds = legacyLeads.map(l => l.id).filter(Boolean);
            if (newIds.length > 0) {
                const { error } = await supabase
                    .from('leads')
                    .update({
                        handler: employeeDisplayName,
                        case_handler_id: selectedEmployee.id,
                        stage_changed_by,
                        stage_changed_at,
                    })
                    .in('id', newIds as string[]);
                if (error) throw error;
            }
            if (legacyIds.length > 0) {
                const { error } = await supabase
                    .from('leads_lead')
                    .update({
                        case_handler_id: selectedEmployee.id,
                        stage_changed_by,
                        stage_changed_at,
                    })
                    .in('id', legacyIds as (string | number)[]);
                if (error) throw error;
            }
        } else {
            const newIds = newLeads.map(l => l.id).filter(Boolean);
            const legacyIds = legacyLeads.map(l => l.id).filter(Boolean);
            if (newIds.length > 0) {
                const { error } = await supabase
                    .from('leads')
                    .update({
                        retainer_handler_id: selectedEmployee.id,
                        stage_changed_by,
                        stage_changed_at,
                    })
                    .in('id', newIds as string[]);
                if (error) throw error;
            }
            if (legacyIds.length > 0) {
                const { error } = await supabase
                    .from('leads_lead')
                    .update({
                        retainer_handler_id: selectedEmployee.id,
                        stage_changed_by,
                        stage_changed_at,
                    })
                    .in('id', legacyIds as (string | number)[]);
                if (error) throw error;
            }
        }
    };

    const handleMissingFlowAssignAndApply = async () => {
        const flow = activeHandlerMissingFlow;
        if (!flow || flow.step !== 'assign') return;
        if (!missingFlowAssignName.trim()) {
            toast.error('Choose an employee to assign.');
            return;
        }
        setSavingMissingFlowAssign(true);
        try {
            await assignMissingRoleToLeads(flow.missingLeads, flow.missingRole, missingFlowAssignName.trim());
            await performBulkActiveHandlerUpdate(flow.allSelected, flow.activeChoice);

            const n = flow.allSelected.length;
            const roleWord = flow.missingRole === 'handler' ? 'case handler' : 'retention handler';
            const activeSummary =
                flow.activeChoice === 2
                    ? 'Case handler is now active on the selected cases.'
                    : 'Retention handler is now active on the selected cases.';
            toast.success(`Assigned ${missingFlowAssignName.trim()} as ${roleWord} on ${flow.missingLeads.length} lead(s), then updated active role. ${activeSummary} (${n} lead${n === 1 ? '' : 's'}).`);

            setActiveHandlerMissingFlow(null);
            setMissingFlowAssignName('');
            setMissingFlowAssignSearch('');
            setShowMissingFlowAssignDropdown(false);
            await handleReassignSearch();
        } catch (e: any) {
            if (e?.message === 'EMPLOYEE_NOT_FOUND') {
                toast.error('That employee could not be found. Pick someone from the list.');
            } else {
                console.error('Assign missing role then active:', e);
                toast.error('Assignment or active-role update failed. Please try again.');
            }
        } finally {
            setSavingMissingFlowAssign(false);
        }
    };

    const applySingleLeadActiveType = async (lead: any, choice: 1 | 2) => {
        const id = lead.id?.toString() || '';
        setSavingSingleLeadId(id);
        try {
            await performBulkActiveHandlerUpdate([lead], choice);
            toast.success(
                choice === 2 ? 'Case handler is now active on this lead.' : 'Retention handler is now active on this lead.'
            );
            await handleReassignSearch();
        } catch (e: any) {
            if (e?.message === 'NO_MATCHING_IDS') {
                toast.error('Could not update this lead. Try search again.');
            } else {
                console.error('Single lead active_handler_type:', e);
                toast.error('Could not update active role.');
            }
        } finally {
            setSavingSingleLeadId(null);
        }
    };

    const handleSingleLeadActivePick = (lead: any, targetChoice: 1 | 2, e: React.MouseEvent) => {
        e.stopPropagation();
        setActiveHandlerMissingFlow(null);
        const current = Number((lead as any).active_handler_type) === 1 ? 1 : 2;
        if (current === targetChoice) return;

        if (targetChoice === 2 && !leadHasCaseHandler(lead)) {
            setSingleActiveAssignName('');
            setSingleActiveAssignSearch('');
            setSingleLeadActiveFlow({ lead, targetChoice: 2, step: 'ask' });
            return;
        }
        if (targetChoice === 1 && !leadHasRetentionHandler(lead)) {
            setSingleActiveAssignName('');
            setSingleActiveAssignSearch('');
            setSingleLeadActiveFlow({ lead, targetChoice: 1, step: 'ask' });
            return;
        }
        void applySingleLeadActiveType(lead, targetChoice);
    };

    const handleSingleFlowAssignAndApply = async () => {
        const flow = singleLeadActiveFlow;
        if (!flow || flow.step !== 'assign') return;
        if (!singleActiveAssignName.trim()) {
            toast.error('Pick an employee.');
            return;
        }
        setSingleActiveModalSaving(true);
        try {
            const missingRole = flow.targetChoice === 2 ? 'handler' : 'retainer_handler';
            await assignMissingRoleToLeads([flow.lead], missingRole, singleActiveAssignName.trim());
            await performBulkActiveHandlerUpdate([flow.lead], flow.targetChoice);
            toast.success('Assigned and set active role on this lead.');
            setSingleLeadActiveFlow(null);
            setSingleActiveAssignName('');
            setSingleActiveAssignSearch('');
            await handleReassignSearch();
        } catch (e: any) {
            if (e?.message === 'EMPLOYEE_NOT_FOUND') {
                toast.error('Employee not found.');
            } else {
                console.error('Single flow assign then active:', e);
                toast.error('Assignment or update failed.');
            }
        } finally {
            setSingleActiveModalSaving(false);
        }
    };

    const handleSaveBulkActiveHandlerType = async () => {
        if (selectedLeads.size === 0) {
            toast.error('Select at least one lead.');
            return;
        }
        const selectedList = reassignResults.filter(lead => selectedLeads.has(lead.id?.toString() || ''));
        const choice = activeHandlerTypeChoice;

        const missingRole: 'handler' | 'retainer_handler' | null =
            choice === 2
                ? selectedList.some(l => !leadHasCaseHandler(l))
                    ? 'handler'
                    : null
                : selectedList.some(l => !leadHasRetentionHandler(l))
                  ? 'retainer_handler'
                  : null;

        if (missingRole) {
            const missingLeads = selectedList.filter(l =>
                missingRole === 'handler' ? !leadHasCaseHandler(l) : !leadHasRetentionHandler(l)
            );
            setSingleLeadActiveFlow(null);
            setShowActiveHandlerModal(false);
            setMissingFlowAssignName('');
            setMissingFlowAssignSearch('');
            setShowMissingFlowAssignDropdown(false);
            setActiveHandlerMissingFlow({
                step: 'ask',
                activeChoice: choice,
                missingRole,
                missingLeads,
                allSelected: selectedList,
            });
            return;
        }

        setSavingActiveHandlerType(true);
        try {
            await performBulkActiveHandlerUpdate(selectedList, choice);

            const n = selectedLeads.size;
            const summary =
                choice === 2
                    ? 'Case handler is now active on the selected cases.'
                    : 'Retention handler is now active on the selected cases.';
            toast.success(`${summary} (${n} lead${n === 1 ? '' : 's'}).`);

            setShowActiveHandlerModal(false);
            await handleReassignSearch();
        } catch (e: any) {
            if (e?.message === 'NO_MATCHING_IDS') {
                toast.error('Could not match selected rows to update. Try running search again.');
            } else {
                console.error('Bulk active_handler_type update:', e);
                toast.error('Could not update who is active on all leads. Please try again.');
            }
        } finally {
            setSavingActiveHandlerType(false);
        }
    };

    const filteredEmployees = getFilteredEmployees();

    // First non-empty role filter that is not "NONE (unassigned)" — drives which field is the primary employee filter.
    const getActiveRoleFilter = (): string | null => {
        if (reassignFilters.meetingScheduler && !isReassignRoleNoneFilter(reassignFilters.meetingScheduler)) return 'scheduler';
        if (reassignFilters.closer && !isReassignRoleNoneFilter(reassignFilters.closer)) return 'closer';
        if (reassignFilters.meetingManager && !isReassignRoleNoneFilter(reassignFilters.meetingManager)) return 'meetingManager';
        if (reassignFilters.handler && !isReassignRoleNoneFilter(reassignFilters.handler)) return 'handler';
        if (reassignFilters.helper && !isReassignRoleNoneFilter(reassignFilters.helper)) return 'helper';
        if (reassignFilters.expert && !isReassignRoleNoneFilter(reassignFilters.expert)) return 'expert';
        if (reassignFilters.retainer_handler && !isReassignRoleNoneFilter(reassignFilters.retainer_handler)) return 'retainer_handler';
        if (reassignFilters.helper_handler && !isReassignRoleNoneFilter(reassignFilters.helper_handler)) return 'helper_handler';
        if (reassignFilters.client_support && !isReassignRoleNoneFilter(reassignFilters.client_support)) return 'client_support';
        return null;
    };

    const activeRoleFilter = getActiveRoleFilter();
    const isRoleSecondary = (roleKey: string) => Boolean(activeRoleFilter && activeRoleFilter !== roleKey);

    // Filters persisted before this one existed have no value for it, which reads as "Any".
    const activeHandlerFilter = (reassignFilters.activeHandlerType || '') as ActiveHandlerFilterValue;

    /*
     * The cross-role "missing" pills reuse the other role's own NONE filter instead of introducing a
     * second way to ask the same thing. One source of truth means the two can never disagree, the
     * queries for both lead tables already handle it (including the placeholder names a new lead's
     * `handler` column uses for nobody), and the choice still lists itself under "Filtered by:".
     */
    const otherRoleMissing = (roleKey: 'handler' | 'retainer_handler'): boolean =>
        isReassignRoleNoneFilter(reassignFilters[roleKey] as string);

    /** The employee a role's filter names, if it names one rather than being blank or NONE. */
    const roleFilterEmployee = (selectedName: string) =>
        selectedName ? employees.find(emp => emp.display_name === selectedName) ?? null : null;

    /** The two setters that, with `reassignFilters`, hold each role's chosen employee. */
    const roleFilterSetters: Record<ReassignRoleFilterKey, [(v: string) => void, (v: string) => void]> = {
        meetingScheduler: [setSelectedMeetingScheduler, setMeetingSchedulerSearchTerm],
        closer: [setSelectedCloser, setCloserSearchTerm],
        meetingManager: [setSelectedMeetingManager, setMeetingManagerSearchTerm],
        handler: [setSelectedHandler, setHandlerSearchTerm],
        helper: [setSelectedHelper, setHelperSearchTerm],
        expert: [setSelectedExpert, setExpertSearchTerm],
        retainer_handler: [setSelectedRetainerHandler, setRetainerHandlerSearchTerm],
        helper_handler: [setSelectedHelperHandler, setHelperHandlerSearchTerm],
        client_support: [setSelectedClientSupport, setClientSupportSearchTerm],
    };

    const setRoleFilterEmployee = (role: ReassignRoleFilterKey, name: string) => {
        const [setSelected, setSearchTerm] = roleFilterSetters[role];
        setSelected(name);
        setSearchTerm(name);
    };

    /**
     * Filter one role by a person, which drops any other role that was filtered by a person.
     *
     * Only one role at a time can be "the employee we are looking at", since the point of the tool
     * is to take that person's leads and hand them to someone else. A role left on NONE is a
     * different question — "and nobody holds this one" — so those stay.
     */
    const pickRoleFilterEmployee = (role: ReassignRoleFilterKey, name: string) => {
        const snapshot = reassignFiltersRef.current;
        setReassignFilters(prev => {
            const next: any = { ...prev, [role]: name };
            ALL_ROLE_FILTER_KEYS.forEach((key) => {
                if (key !== role && !isReassignRoleNoneFilter(prev[key] as string)) next[key] = '';
            });
            return next;
        });
        ALL_ROLE_FILTER_KEYS.forEach((key) => {
            if (key === role) return;
            if (!isReassignRoleNoneFilter(snapshot[key] as string)) setRoleFilterEmployee(key, '');
        });
        setRoleFilterEmployee(role, name);
    };

    /** The "NONE (unassigned)" choice, which shows the role's own label in its field. */
    const pickRoleFilterNone = (role: ReassignRoleFilterKey) => {
        setReassignFilters(prev => ({ ...prev, [role]: REASSIGN_ROLE_FILTER_NONE }));
        const [setSelected, setSearchTerm] = roleFilterSetters[role];
        setSelected('');
        setSearchTerm(REASSIGN_ROLE_NONE_LABEL);
    };

    /** Drops a role's filter, clearing all three pieces of state that together hold it. */
    const clearRoleFilter = (role: ReassignRoleFilterKey) => {
        setReassignFilters(prev => ({ ...prev, [role]: '' }));
        setRoleFilterEmployee(role, '');
    };

    /**
     * Changing tab asks the same question about a different role, so the chosen employee moves with
     * it. Leaving them behind would hide the filter on a panel that is no longer on screen, and only
     * one role can be filtered by a person at a time anyway.
     */
    const changeRoleFilterTab = (tab: ReassignRoleFilterTab) => {
        setRoleFilterTab(tab);
        if (!activeRoleFilter || activeRoleFilter === tab) return;

        const fromKey = ROLE_TAB_FILTER_KEY[activeRoleFilter as ReassignRoleFilterTab];
        const toKey = ROLE_TAB_FILTER_KEY[tab];
        const employeeName = (reassignFilters[fromKey] as string) || '';

        setReassignFilters(prev => ({ ...prev, [fromKey]: '', [toKey]: employeeName }));
        setRoleFilterEmployee(fromKey, '');
        setRoleFilterEmployee(toKey, employeeName);
    };

    /** Everything a result row shows, derived once so the card and list views cannot drift apart. */
    const describeResultLead = (lead: any) => {
        const leadId = lead.id?.toString() || '';
        const handlerEmployee = lead.handlerEmployee;
        const handlerName =
            handlerEmployee?.display_name ||
            (!isUnassignedHandlerValue(lead.handler) ? String(lead.handler).trim() : null);

        return {
            leadId,
            isSelected: selectedLeads.has(leadId),
            // The name is only shown when the lead really has a handler; `handler` can hold a
            // placeholder that reads like a name.
            handlerName: leadHasCaseHandler(lead) ? handlerName : null,
            handlerPhoto: handlerEmployee?.photo_url ?? null,
            retention: getRetentionEmployeeForLead(lead, employees),
            activeType: (Number(lead.active_handler_type) === 1 ? 1 : 2) as 1 | 2,
            busy: savingSingleLeadId === leadId,
            balance: getLeadBalance(lead),
            applicants: getLeadApplicants(lead),
            displayNumber: lead.display_lead_number || lead.lead_number || lead.id || 'Unknown Lead',
            category: lead.category || 'N/A',
            source: lead.source || 'N/A',
            language: lead.language || 'N/A',
            created: lead.created_at ? new Date(lead.created_at).toLocaleDateString() : 'Unknown',
        };
    };

    /*
     * Roles are looked up by id far more often than they are listed, so the two directions get a map
     * each: the id one for the roles that store an employee id, the name one to find a photo for the
     * roles a new lead stores as plain text.
     */
    const employeeById = useMemo(
        () => new Map<number, any>(employees.map(emp => [Number(emp.id), emp])),
        [employees],
    );
    const employeeByName = useMemo(
        () => new Map<string, any>(employees.map(emp => [String(emp.display_name).toLowerCase(), emp])),
        [employees],
    );

    const roleColumnVisible = (role: ReassignRoleFilterKey) => visibleRoleColumns.includes(role);
    const roleAssignees = (role: ReassignRoleFilterKey, lead: any) =>
        roleColumnAssignees(role, lead, employeeById, employeeByName);

    /*
     * Handler and Retention keep the columns they have always had, either side of the active-handler
     * switch, so the roles added to the view are every other one that is switched on.
     */
    const extraRoleColumns = ROLE_COLUMN_ORDER.filter(
        role => role !== 'handler' && role !== 'retainer_handler' && roleColumnVisible(role),
    );

    const toggleRoleColumn = (role: string) => {
        setVisibleRoleColumns(prev =>
            prev.includes(role) ? prev.filter(entry => entry !== role) : [...prev, role],
        );
    };

    const formatResultBalance = (balance: { value: number | null; currency: string }) =>
        balance.value && balance.value > 0
            ? `${balance.currency}${balance.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
            : 'N/A';

    const setOtherRoleMissing = (roleKey: 'handler' | 'retainer_handler', missing: boolean) => {
        const setSelected = roleKey === 'handler' ? setSelectedHandler : setSelectedRetainerHandler;
        const setSearchTerm = roleKey === 'handler' ? setHandlerSearchTerm : setRetainerHandlerSearchTerm;

        if (missing) {
            setReassignFilters(prev => ({ ...prev, [roleKey]: REASSIGN_ROLE_FILTER_NONE }));
            setSelected('');
            setSearchTerm(REASSIGN_ROLE_NONE_LABEL);
            return;
        }
        // Switching back to Any drops the unassigned filter and leaves an employee pick for that
        // role alone, since that is a different filter that happens to live in the same field.
        if (!otherRoleMissing(roleKey)) return;
        setReassignFilters(prev => ({ ...prev, [roleKey]: '' }));
        setSearchTerm('');
    };

    // Show loading state while checking access
    if (checkingAccess) {
        return (
            <div className="p-4 md:p-6">
                <div className="flex items-center justify-center min-h-[400px]">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </div>
        );
    }

    // Show access denied message if user doesn't have collection access
    if (!hasCollectionAccess) {
        return (
            <div className="p-4 md:p-6">
                <div className="alert alert-error shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <h3 className="font-bold">Access Denied</h3>
                        <div className="text-sm">You do not have permission to access this report. This tool is only available for users with collection access (is_collection = true).</div>
                    </div>
                </div>
            </div>
        );
    }

    const bottomBarNoResults = showFloatingBar && !reassignLoading && reassignResults.length === 0;

    return (
        <>
            <div className="fixed top-14 left-0 right-0 z-40 flex justify-center px-2 pointer-events-none md:top-16">
                <div className="pointer-events-auto flex max-w-[min(100vw-0.75rem,34rem)] flex-nowrap items-center gap-1.5 rounded-full border border-base-300/70 bg-base-100/92 px-2.5 py-1 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-base-100/85 sm:gap-2 sm:px-4 sm:py-1.5 sm:shadow-lg">
                    <div className="flex shrink-0 items-center gap-1">
                        <input
                            type="date"
                            title="From"
                            className="input input-bordered input-xs h-8 w-[8.75rem] min-w-0 shrink rounded-full border-base-300 px-2 text-[11px] leading-tight sm:w-36 sm:text-xs"
                            value={reassignFilters.fromDate}
                            onChange={(e) => setReassignFilters(prev => ({ ...prev, fromDate: e.target.value }))}
                        />
                        <input
                            type="date"
                            title="To"
                            className="input input-bordered input-xs h-8 w-[8.75rem] min-w-0 shrink rounded-full border-base-300 px-2 text-[11px] leading-tight sm:w-36 sm:text-xs"
                            value={reassignFilters.toDate}
                            onChange={(e) => setReassignFilters(prev => ({ ...prev, toDate: e.target.value }))}
                        />
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary btn-xs h-8 w-8 min-h-8 shrink-0 rounded-full p-0 sm:btn-sm sm:h-9 sm:w-9"
                        onClick={handleReassignSearch}
                        disabled={reassignLoading}
                        title="Search"
                        aria-label="Search leads with current filters"
                    >
                        {reassignLoading ? (
                            <span className="loading loading-spinner loading-xs" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 sm:h-[1.125rem] sm:w-[1.125rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                            </svg>
                        )}
                    </button>
                    {!showFilters && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-xs h-8 shrink-0 rounded-full border border-base-300/60 px-2.5 text-xs sm:btn-sm sm:h-9"
                            onClick={() => setShowFilters(true)}
                        >
                            Filters
                        </button>
                    )}
                </div>
            </div>
        <div ref={scrollContainerRef} className="p-4 md:p-6 pb-8 pt-[4.25rem] sm:pt-20 md:pt-[4.75rem]">

            {/* Filters Section - Two Column Layout */}
            {showFilters && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
                    {/* Left Side - General Filters */}
                    <div className="lg:col-span-3 self-start rounded-2xl bg-base-100 p-4 shadow-sm sm:p-6">
                        <h3 className="text-lg font-semibold mb-4 text-base-content/80 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            General Filters
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Lead Numbers Filter */}
                            <div className="form-control md:col-span-2 lead-search-dropdown-container relative">
                                <label className="label mb-2">
                                    <span className="label-text">Filter by Lead Numbers</span>
                                    {reassignFilters.selectedLeadIds && reassignFilters.selectedLeadIds.length > 0 && (
                                        <span className="label-text-alt text-primary font-medium">
                                            {reassignFilters.selectedLeadIds.length} selected
                                        </span>
                                    )}
                                </label>

                                <div className="text-xs text-base-content/60 mb-2">
                                    Search for lead numbers (e.g., 205857, L18, L18/2, C19/1) and select from results
                                </div>

                                <input
                                    type="text"
                                    placeholder="Search lead numbers (e.g., 205857, L18, L18/2)..."
                                    className="input input-bordered w-full font-mono text-sm"
                                    value={leadSearchTerm}
                                    onChange={(e) => {
                                        setLeadSearchTerm(e.target.value);
                                    }}
                                    onFocus={() => {
                                        if (leadSearchTerm.trim().length >= 1 && leadSearchResults.length > 0) {
                                            setShowLeadSearchDropdown(true);
                                        }
                                    }}
                                />

                                {/* Search Results Dropdown */}
                                {showLeadSearchDropdown && leadSearchResults.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                        <div className="p-2">
                                            {leadSearchResults.map((lead) => {
                                                const isSelected = reassignFilters.selectedLeadIds?.includes(lead.id);
                                                return (
                                                    <button
                                                        key={lead.id}
                                                        type="button"
                                                        className={`w-full text-left px-3 py-2 rounded-md transition-colors ${isSelected
                                                            ? 'bg-primary text-primary-content'
                                                            : 'hover:bg-base-200'
                                                            }`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (!isSelected) {
                                                                setReassignFilters(prev => ({
                                                                    ...prev,
                                                                    selectedLeadIds: [...(prev.selectedLeadIds || []), lead.id]
                                                                }));
                                                                setSelectedLeadsInfo(prev => {
                                                                    const newMap = new Map(prev);
                                                                    newMap.set(lead.id, {
                                                                        lead_number: lead.lead_number,
                                                                        name: lead.name,
                                                                        isLegacy: lead.isLegacy
                                                                    });
                                                                    return newMap;
                                                                });
                                                                setLeadSearchTerm(''); // Clear search input
                                                                setShowLeadSearchDropdown(false); // Close dropdown
                                                            } else {
                                                                setReassignFilters(prev => ({
                                                                    ...prev,
                                                                    selectedLeadIds: (prev.selectedLeadIds || []).filter(id => id !== lead.id)
                                                                }));
                                                                setSelectedLeadsInfo(prev => {
                                                                    const newMap = new Map(prev);
                                                                    newMap.delete(lead.id);
                                                                    return newMap;
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1">
                                                                <div className="font-medium">
                                                                    {lead.name}
                                                                </div>
                                                                <div className="text-xs opacity-80">
                                                                    Lead #{lead.lead_number || lead.id}
                                                                </div>
                                                            </div>
                                                            {isSelected && (
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* No Results Message */}
                                {showLeadSearchDropdown && leadSearchTerm.trim().length >= 1 && leadSearchResults.length === 0 && (
                                    <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full p-4 text-center text-base-content/60 text-sm">
                                        No leads found
                                    </div>
                                )}

                                {/* Selected Lead Numbers */}
                                {reassignFilters.selectedLeadIds && reassignFilters.selectedLeadIds.length > 0 && (
                                    <div className="mt-3">
                                        <div className="flex flex-wrap gap-2">
                                            {reassignFilters.selectedLeadIds.map((leadId) => {
                                                // Get lead info from stored info or search results
                                                const storedInfo = selectedLeadsInfo.get(leadId);
                                                const searchInfo = leadSearchResults.find(l => l.id === leadId);
                                                const leadInfo = storedInfo || searchInfo;
                                                const displayNumber = leadInfo?.lead_number || leadId.toString().replace('legacy_', '');
                                                return (
                                                    <span
                                                        key={leadId}
                                                        className="badge badge-primary badge-lg gap-2 cursor-pointer hover:badge-error transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setReassignFilters(prev => ({
                                                                ...prev,
                                                                selectedLeadIds: (prev.selectedLeadIds || []).filter(id => id !== leadId)
                                                            }));
                                                            // Remove from stored info
                                                            setSelectedLeadsInfo(prev => {
                                                                const newMap = new Map(prev);
                                                                newMap.delete(leadId);
                                                                return newMap;
                                                            });
                                                        }}
                                                        title="Click to remove"
                                                    >
                                                        {displayNumber}
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Category */}
                            <MultiSelectInput
                                label="Category"
                                field="category"
                                values={reassignFilters.category}
                                placeholder="Type category or choose from suggestions..."
                                options={mainCategories}
                                showDropdown={showReassignCategoryDropdown}
                                onSelect={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: [...(prev[field as keyof typeof prev] as string[]), value]
                                    }));
                                }}
                                onRemove={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: (prev[field as keyof typeof prev] as string[]).filter(item => item !== value)
                                    }));
                                }}
                                onFilterChange={(field, value) => {
                                    // Do nothing - MultiSelectInput handles its own input state
                                }}
                                onShowDropdown={() => setShowReassignCategoryDropdown(true)}
                                onHideDropdown={() => setShowReassignCategoryDropdown(false)}
                            />

                            {/* Language */}
                            <MultiSelectInput
                                label="Language"
                                field="language"
                                values={reassignFilters.language}
                                placeholder="Type language or choose from suggestions..."
                                options={reassignLanguageOptions}
                                showDropdown={showLanguageDropdown}
                                onSelect={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: [...(prev[field as keyof typeof prev] as string[]), value]
                                    }));
                                }}
                                onRemove={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: (prev[field as keyof typeof prev] as string[]).filter(item => item !== value)
                                    }));
                                }}
                                onFilterChange={(field, value) => {
                                    // Do nothing - MultiSelectInput handles its own input state
                                }}
                                onShowDropdown={() => setShowLanguageDropdown(true)}
                                onHideDropdown={() => setShowLanguageDropdown(false)}
                            />

                            {/* Status */}
                            <MultiSelectInput
                                label="Status"
                                field="status"
                                values={reassignFilters.status}
                                placeholder="Type status or choose from suggestions..."
                                options={filteredStatusOptions}
                                showDropdown={showStatusDropdown}
                                onSelect={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: [...(prev[field as keyof typeof prev] as string[]), value]
                                    }));
                                }}
                                onRemove={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: (prev[field as keyof typeof prev] as string[]).filter(item => item !== value)
                                    }));
                                }}
                                onFilterChange={(field, value) => {
                                    // Do nothing - MultiSelectInput handles its own input state
                                }}
                                onShowDropdown={() => setShowStatusDropdown(true)}
                                onHideDropdown={() => setShowStatusDropdown(false)}
                            />

                            {/* Source */}
                            <MultiSelectInput
                                label="Source"
                                field="source"
                                values={reassignFilters.source}
                                placeholder="Type source or choose from suggestions..."
                                options={reassignSourceOptions}
                                showDropdown={showReassignSourceDropdown}
                                onSelect={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: [...(prev[field as keyof typeof prev] as string[]), value]
                                    }));
                                }}
                                onRemove={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: (prev[field as keyof typeof prev] as string[]).filter(item => item !== value)
                                    }));
                                }}
                                onFilterChange={(field, value) => {
                                    // Do nothing - MultiSelectInput handles its own input state
                                }}
                                onShowDropdown={() => setShowReassignSourceDropdown(true)}
                                onHideDropdown={() => setShowReassignSourceDropdown(false)}
                            />

                            {/* Stage */}
                            <MultiSelectInput
                                label="Stage"
                                field="stage"
                                values={reassignFilters.stage}
                                placeholder="Type stage or choose from suggestions..."
                                options={stages.map(stage => stage.name)}
                                showDropdown={showReassignStageDropdown}
                                onSelect={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: [...(prev[field as keyof typeof prev] as string[]), value]
                                    }));
                                }}
                                onRemove={(field, value) => {
                                    setReassignFilters(prev => ({
                                        ...prev,
                                        [field]: (prev[field as keyof typeof prev] as string[]).filter(item => item !== value)
                                    }));
                                }}
                                onFilterChange={(field, value) => {
                                    // Do nothing - MultiSelectInput handles its own input state
                                }}
                                onShowDropdown={() => setShowReassignStageDropdown(true)}
                                onHideDropdown={() => setShowReassignStageDropdown(false)}
                            />

                            {/* Eligibility */}
                            <div className="form-control flex flex-col md:col-span-2">
                                <label className="label mb-2">
                                    <span className="label-text">Eligible</span>
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        className="toggle toggle-primary"
                                        checked={reassignFilters.eligibilityDeterminedOnly}
                                        onChange={(e) => setReassignFilters(prev => ({ ...prev, eligibilityDeterminedOnly: e.target.checked }))}
                                    />
                                    <span className="text-xs text-gray-500">
                                        Show only leads where eligibility is determined
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Side - Role Filters */}
                    <div className="lg:col-span-2">
                        <div className="sticky top-6 rounded-2xl bg-base-100 p-4 shadow-sm sm:p-6">
                            <h3 className="text-lg font-semibold mb-4 text-base-content/80 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                                Role Filters
                            </h3>
                            <div
                                className="mb-3 flex flex-wrap gap-1 border-b border-base-200 pb-2"
                                role="tablist"
                                aria-label="Role filters"
                            >
                                {(
                                    [
                                        ['scheduler', 'Scheduler'],
                                        ['closer', 'Closer'],
                                        ['meetingManager', 'Meeting mgr'],
                                        ['handler', 'Handler'],
                                        ['helper', 'Helper'],
                                        ['expert', 'Expert'],
                                        ['retainer_handler', 'Retention'],
                                        ['helper_handler', 'Helper handler'],
                                        ['client_support', 'Client support'],
                                    ] as const
                                ).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        role="tab"
                                        aria-selected={roleFilterTab === id}
                                        className={`btn btn-sm rounded-full normal-case text-sm sm:btn-md sm:text-base ${roleFilterTab === id ? 'btn-primary' : 'btn-ghost btn-outline border-base-300'}`}
                                        onClick={() => changeRoleFilterTab(id)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div>
                                {roleFilterTab === 'scheduler' && (
                                <div>
                                    <div className="relative meeting-scheduler-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedMeetingScheduler) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('scheduler')}
                                            value={meetingSchedulerSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('scheduler')) return;
                                                setMeetingSchedulerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, meetingScheduler: e.target.value }));
                                            }}
                                            onFocus={() => setShowMeetingSchedulerDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedMeetingScheduler) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedMeetingScheduler)!}
                                                onClear={() => clearRoleFilter('meetingScheduler')}
                                            />
                                        )}
                                        {showMeetingSchedulerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('scheduler') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedMeetingScheduler('');
                                                                setMeetingSchedulerSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, meetingScheduler: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowMeetingSchedulerDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('scheduler') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(meetingSchedulerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('meetingScheduler', emp.display_name);
                                                                    setShowMeetingSchedulerDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('scheduler') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(meetingSchedulerSearchTerm.toLowerCase())
                                                    ).length === 0 && meetingSchedulerSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Meeting scheduler:</label>
                                </div>
                                )}
                                {roleFilterTab === 'closer' && (
                                <div>
                                    <div className="relative closer-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedCloser) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('closer')}
                                            value={closerSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('closer')) return;
                                                setCloserSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, closer: e.target.value }));
                                            }}
                                            onFocus={() => setShowCloserDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedCloser) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedCloser)!}
                                                onClear={() => clearRoleFilter('closer')}
                                            />
                                        )}
                                        {showCloserDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('closer') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedCloser('');
                                                                setCloserSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, closer: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowCloserDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('closer') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(closerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('closer', emp.display_name);
                                                                    setShowCloserDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('closer') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(closerSearchTerm.toLowerCase())
                                                    ).length === 0 && closerSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Closer:</label>
                                </div>
                                )}
                                {roleFilterTab === 'meetingManager' && (
                                <div>
                                    <div className="relative meeting-manager-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedMeetingManager) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('meetingManager')}
                                            value={meetingManagerSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('meetingManager')) return;
                                                setMeetingManagerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, meetingManager: e.target.value }));
                                            }}
                                            onFocus={() => setShowMeetingManagerDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedMeetingManager) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedMeetingManager)!}
                                                onClear={() => clearRoleFilter('meetingManager')}
                                            />
                                        )}
                                        {showMeetingManagerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('meetingManager') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedMeetingManager('');
                                                                setMeetingManagerSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, meetingManager: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowMeetingManagerDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('meetingManager') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(meetingManagerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('meetingManager', emp.display_name);
                                                                    setShowMeetingManagerDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('meetingManager') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(meetingManagerSearchTerm.toLowerCase())
                                                    ).length === 0 && meetingManagerSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Meeting Manager:</label>
                                </div>
                                )}
                                {roleFilterTab === 'handler' && (
                                <div>
                                    <div className="relative handler-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedHandler) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('handler')}
                                            value={handlerSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('handler')) return;
                                                setHandlerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, handler: e.target.value }));
                                            }}
                                            onFocus={() => setShowHandlerDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedHandler) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedHandler)!}
                                                onClear={() => clearRoleFilter('handler')}
                                            />
                                        )}
                                        {showHandlerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('handler') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedHandler('');
                                                                setHandlerSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, handler: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowHandlerDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('handler') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(handlerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('handler', emp.display_name);
                                                                    setShowHandlerDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('handler') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(handlerSearchTerm.toLowerCase())
                                                    ).length === 0 && handlerSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Handler:</label>
                                    <ReassignActiveHandlerFilter
                                        tab="handler"
                                        value={activeHandlerFilter}
                                        onChange={(next) => setReassignFilters(prev => ({ ...prev, activeHandlerType: next }))}
                                    />
                                    <ReassignMissingRoleFilter
                                        missingLabel="Missing retention"
                                        fieldLabel="Retention role:"
                                        missing={otherRoleMissing('retainer_handler')}
                                        onChange={(missing) => setOtherRoleMissing('retainer_handler', missing)}
                                    />
                                </div>
                                )}
                                {roleFilterTab === 'helper' && (
                                <div>
                                    <div className="relative helper-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedHelper) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('helper')}
                                            value={helperSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('helper')) return;
                                                setHelperSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, helper: e.target.value }));
                                            }}
                                            onFocus={() => setShowHelperDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedHelper) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedHelper)!}
                                                onClear={() => clearRoleFilter('helper')}
                                            />
                                        )}
                                        {showHelperDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('helper') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedHelper('');
                                                                setHelperSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, helper: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowHelperDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('helper') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(helperSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('helper', emp.display_name);
                                                                    setShowHelperDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('helper') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(helperSearchTerm.toLowerCase())
                                                    ).length === 0 && helperSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Helper (lawyer):</label>
                                </div>
                                )}
                                {roleFilterTab === 'expert' && (
                                <div>
                                    <div className="relative expert-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedExpert) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('expert')}
                                            value={expertSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('expert')) return;
                                                setExpertSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, expert: e.target.value }));
                                            }}
                                            onFocus={() => setShowExpertDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedExpert) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedExpert)!}
                                                onClear={() => clearRoleFilter('expert')}
                                            />
                                        )}
                                        {showExpertDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('expert') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedExpert('');
                                                                setExpertSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, expert: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowExpertDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('expert') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(expertSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('expert', emp.display_name);
                                                                    setShowExpertDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('expert') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(expertSearchTerm.toLowerCase())
                                                    ).length === 0 && expertSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Expert:</label>
                                </div>
                                )}
                                {roleFilterTab === 'retainer_handler' && (
                                <div>
                                    <div className="relative retainer-handler-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className={`input input-bordered w-full ${roleFilterEmployee(selectedRetainerHandler) ? 'pl-12 pr-10' : ''}`}
                                            readOnly={isRoleSecondary('retainer_handler')}
                                            value={retainerHandlerSearchTerm}
                                            onChange={(e) => {
                                                if (isRoleSecondary('retainer_handler')) return;
                                                setRetainerHandlerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, retainer_handler: e.target.value }));
                                            }}
                                            onFocus={() => setShowRetainerHandlerDropdown(true)}
                                        />
                                        {roleFilterEmployee(selectedRetainerHandler) && (
                                            <ReassignRoleFieldEmployee
                                                employee={roleFilterEmployee(selectedRetainerHandler)!}
                                                onClear={() => clearRoleFilter('retainer_handler')}
                                            />
                                        )}
                                        {showRetainerHandlerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    {isRoleSecondary('retainer_handler') && (
                                                        <button
                                                            type="button"
                                                            className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors text-base-content/80"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedRetainerHandler('');
                                                                setRetainerHandlerSearchTerm(REASSIGN_ROLE_NONE_LABEL);
                                                                setReassignFilters(prev => ({ ...prev, retainer_handler: REASSIGN_ROLE_FILTER_NONE }));
                                                                setShowRetainerHandlerDropdown(false);
                                                            }}
                                                        >
                                                            {REASSIGN_ROLE_NONE_LABEL}
                                                        </button>
                                                    )}
                                                    {!isRoleSecondary('retainer_handler') && employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(retainerHandlerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <ReassignRoleEmployeeRow
                                                                key={emp.id}
                                                                emp={emp}
                                                                getInitials={getInitials}
                                                                onPick={() => {
                                                                    pickRoleFilterEmployee('retainer_handler', emp.display_name);
                                                                    setShowRetainerHandlerDropdown(false);
                                                                }}
                                                            />
                                                        ))}
                                                    {!isRoleSecondary('retainer_handler') && employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(retainerHandlerSearchTerm.toLowerCase())
                                                    ).length === 0 && retainerHandlerSearchTerm.trim() !== '' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-sm font-medium mt-2">Retention handler:</label>
                                    <ReassignActiveHandlerFilter
                                        tab="retainer_handler"
                                        value={activeHandlerFilter}
                                        onChange={(next) => setReassignFilters(prev => ({ ...prev, activeHandlerType: next }))}
                                    />
                                    <ReassignMissingRoleFilter
                                        missingLabel="Missing handler"
                                        fieldLabel="Handler role:"
                                        missing={otherRoleMissing('handler')}
                                        onChange={(missing) => setOtherRoleMissing('handler', missing)}
                                    />
                                </div>
                                )}
                                {roleFilterTab === 'helper_handler' && (
                                    <ReassignRoleFilterPanel
                                        label="Helper handler:"
                                        containerClassName="helper-handler-role-dropdown-container"
                                        secondary={isRoleSecondary('helper_handler')}
                                        searchTerm={helperHandlerSearchTerm}
                                        selectedEmployee={roleFilterEmployee(selectedHelperHandler)}
                                        employees={employees}
                                        getInitials={getInitials}
                                        open={showHelperHandlerDropdown}
                                        onOpen={() => setShowHelperHandlerDropdown(true)}
                                        onSearchTermChange={(value) => {
                                            setHelperHandlerSearchTerm(value);
                                            setReassignFilters(prev => ({ ...prev, helper_handler: value }));
                                        }}
                                        onPickNone={() => {
                                            pickRoleFilterNone('helper_handler');
                                            setShowHelperHandlerDropdown(false);
                                        }}
                                        onPickEmployee={(emp) => {
                                            pickRoleFilterEmployee('helper_handler', emp.display_name);
                                            setShowHelperHandlerDropdown(false);
                                        }}
                                        onClear={() => clearRoleFilter('helper_handler')}
                                    >
                                        <p className="mt-2 text-xs text-base-content/60">
                                            Several people can hold this role on one lead. Assigning adds the person you
                                            pick; the employee searched for here is the one it is taken away from.
                                        </p>
                                    </ReassignRoleFilterPanel>
                                )}
                                {roleFilterTab === 'client_support' && (
                                    <ReassignRoleFilterPanel
                                        label="Client support:"
                                        containerClassName="client-support-dropdown-container"
                                        secondary={isRoleSecondary('client_support')}
                                        searchTerm={clientSupportSearchTerm}
                                        selectedEmployee={roleFilterEmployee(selectedClientSupport)}
                                        employees={employees}
                                        getInitials={getInitials}
                                        open={showClientSupportDropdown}
                                        onOpen={() => setShowClientSupportDropdown(true)}
                                        onSearchTermChange={(value) => {
                                            setClientSupportSearchTerm(value);
                                            setReassignFilters(prev => ({ ...prev, client_support: value }));
                                        }}
                                        onPickNone={() => {
                                            pickRoleFilterNone('client_support');
                                            setShowClientSupportDropdown(false);
                                        }}
                                        onPickEmployee={(emp) => {
                                            pickRoleFilterEmployee('client_support', emp.display_name);
                                            setShowClientSupportDropdown(false);
                                        }}
                                        onClear={() => clearRoleFilter('client_support')}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Filter Bar */}
            {showFloatingBar && (
                <FloatingFilterBar
                    fromDate={reassignFilters.fromDate}
                    toDate={reassignFilters.toDate}
                    onFromDateChange={(date) => setReassignFilters(prev => ({ ...prev, fromDate: date }))}
                    onToDateChange={(date) => setReassignFilters(prev => ({ ...prev, toDate: date }))}
                    filteredEmployees={filteredEmployees}
                    // The chips carry the filter key itself, so every role is dropped the same way.
                    onRemoveFilter={(role) => clearRoleFilter(role as ReassignRoleFilterKey)}
                    onSearch={handleReassignSearch}
                    isLoading={reassignLoading}
                    // Opening the filters keeps the bar up; it is how you get back to assigning.
                    onShowFilters={() => setShowFilters(true)}
                    getInitials={getInitials}
                    employees={employees}
                    assignEmployeeSearchTerm={assignEmployeeSearchTerm}
                    setAssignEmployeeSearchTerm={setAssignEmployeeSearchTerm}
                    selectedEmployeeForReassign={selectedEmployeeForReassign}
                    setSelectedEmployeeForReassign={setSelectedEmployeeForReassign}
                    showAssignEmployeeDropdown={showAssignEmployeeDropdown}
                    setShowAssignEmployeeDropdown={setShowAssignEmployeeDropdown}
                    handleReassignLeads={handleReassignLeads}
                    reassigning={reassigning}
                    selectedLeadsCount={selectedLeads.size}
                    selectedRoleForReassign={selectedRoleForReassign}
                    setSelectedRoleForReassign={setSelectedRoleForReassign}
                    showRoleDropdown={showRoleDropdown}
                    setShowRoleDropdown={setShowRoleDropdown}
                    roleColumnOptions={ROLE_COLUMN_OPTIONS}
                    visibleRoleColumns={visibleRoleColumns}
                    onToggleRoleColumn={toggleRoleColumn}
                    onOpenActiveHandlerModal={openActiveHandlerModal}
                    interactionsDisabled={bottomBarNoResults}
                />
            )}

            {notifyFlow && (
                <ReassignNotifyEmailModal
                    role={notifyFlow.role}
                    newEmployeeName={notifyFlow.employeeName}
                    leads={notifyFlow.leads}
                    busy={notifySending || reassigning}
                    progress={notifyProgress}
                    onCancel={closeNotifyFlow}
                    onAssignOnly={handleAssignWithoutEmail}
                    onAssignAndEmail={handleAssignAndEmail}
                />
            )}

            {showActiveHandlerModal && (
                <dialog open className="modal modal-open z-[10050]">
                    <div className="modal-box max-w-md w-full">
                        <h3 className="text-lg font-bold">Who is active on the case?</h3>
                        <div className="mt-4 space-y-2">
                            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${activeHandlerTypeChoice === 2 ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/20'}`}>
                                <input
                                    type="radio"
                                    name="bulkActiveHandlerType"
                                    className="radio radio-primary mt-0.5"
                                    checked={activeHandlerTypeChoice === 2}
                                    onChange={() => setActiveHandlerTypeChoice(2)}
                                    disabled={savingActiveHandlerType}
                                />
                                <span>
                                    <span className="font-medium">Case handler active</span>
                                    <span className="mt-0.5 block text-xs text-base-content/60">The case handler is the active role on the case.</span>
                                </span>
                            </label>
                            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${activeHandlerTypeChoice === 1 ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/20'}`}>
                                <input
                                    type="radio"
                                    name="bulkActiveHandlerType"
                                    className="radio radio-primary mt-0.5"
                                    checked={activeHandlerTypeChoice === 1}
                                    onChange={() => setActiveHandlerTypeChoice(1)}
                                    disabled={savingActiveHandlerType}
                                />
                                <span>
                                    <span className="font-medium">Retention handler active</span>
                                    <span className="mt-0.5 block text-xs text-base-content/60">The retention handler is the active role on the case.</span>
                                </span>
                            </label>
                        </div>
                        <div className="modal-action mt-2 flex-wrap gap-2">
                            <button
                                type="button"
                                className="btn"
                                disabled={savingActiveHandlerType}
                                onClick={() => setShowActiveHandlerModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={savingActiveHandlerType}
                                onClick={handleSaveBulkActiveHandlerType}
                            >
                                {savingActiveHandlerType ? (
                                    <>
                                        <span className="loading loading-spinner loading-sm" />
                                        Saving…
                                    </>
                                ) : (
                                    'Save'
                                )}
                            </button>
                        </div>
                    </div>
                    <form
                        method="dialog"
                        className="modal-backdrop"
                        onClick={() => {
                            if (!savingActiveHandlerType) setShowActiveHandlerModal(false);
                        }}
                    >
                        <button type="button">close</button>
                    </form>
                </dialog>
            )}

            {activeHandlerMissingFlow && (
                <dialog open className="modal modal-open z-[10060]">
                    <div
                        className={`modal-box flex w-[min(100vw-1.5rem,42rem)] max-w-none flex-col p-5 sm:p-6 ${
                            activeHandlerMissingFlow.step === 'assign'
                                ? 'max-h-[min(92vh,44rem)] min-h-[min(70vh,28rem)]'
                                : 'max-h-[min(92vh,36rem)]'
                        }`}
                    >
                        {activeHandlerMissingFlow.step === 'ask' ? (
                            <>
                                <h3 className="shrink-0 text-lg font-bold">
                                    {activeHandlerMissingFlow.missingRole === 'handler'
                                        ? 'No case handler'
                                        : 'No retention handler'}
                                    <span className="ml-1 font-semibold text-base-content/80">
                                        ({activeHandlerMissingFlow.missingLeads.length})
                                    </span>
                                </h3>
                                <p className="mt-1 shrink-0 text-sm text-base-content/60">
                                    Assign first, then set active?
                                </p>
                                <ul className="mt-3 max-h-40 shrink-0 overflow-y-auto rounded-lg border border-base-300 bg-base-200/40 px-3 py-2 font-mono text-xs">
                                    {activeHandlerMissingFlow.missingLeads.slice(0, 20).map((lead: any) => (
                                        <li key={String(lead.id)}>
                                            {lead.display_lead_number || lead.lead_number || lead.id}
                                            {lead.name ? ` — ${lead.name}` : ''}
                                        </li>
                                    ))}
                                    {activeHandlerMissingFlow.missingLeads.length > 20 && (
                                        <li className="text-base-content/60">
                                            …+{activeHandlerMissingFlow.missingLeads.length - 20}
                                        </li>
                                    )}
                                </ul>
                                <div className="modal-action mt-4 shrink-0 flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={savingMissingFlowAssign}
                                        onClick={() => {
                                            setActiveHandlerMissingFlow(null);
                                            setShowActiveHandlerModal(true);
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={savingMissingFlowAssign}
                                        onClick={() => {
                                            setMissingFlowAssignName('');
                                            setMissingFlowAssignSearch('');
                                            setShowMissingFlowAssignDropdown(false);
                                            setActiveHandlerMissingFlow(prev =>
                                                prev ? { ...prev, step: 'assign' } : null
                                            );
                                        }}
                                    >
                                        Yes
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 className="shrink-0 text-lg font-bold">
                                    Assign{' '}
                                    {activeHandlerMissingFlow.missingRole === 'handler'
                                        ? 'case handler'
                                        : 'retention handler'}
                                </h3>
                                <p className="mt-1 shrink-0 text-xs text-base-content/55">
                                    Then active role applies to all {activeHandlerMissingFlow.allSelected.length}{' '}
                                    selected.
                                </p>
                                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 missing-flow-assign-dropdown">
                                    <input
                                        type="text"
                                        placeholder="Filter…"
                                        className="input input-bordered input-sm w-full shrink-0"
                                        value={missingFlowAssignSearch}
                                        onChange={e => {
                                            setMissingFlowAssignSearch(e.target.value);
                                            setShowMissingFlowAssignDropdown(true);
                                        }}
                                        onFocus={() => setShowMissingFlowAssignDropdown(true)}
                                    />
                                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-base-200 bg-base-100">
                                        <div className="p-2">
                                            {employees
                                                .filter(emp =>
                                                    emp.display_name
                                                        .toLowerCase()
                                                        .includes(missingFlowAssignSearch.toLowerCase())
                                                )
                                                .map(emp => (
                                                    <ReassignRoleEmployeeRow
                                                        key={emp.id}
                                                        emp={emp}
                                                        getInitials={getInitials}
                                                        onPick={() => {
                                                            setMissingFlowAssignName(emp.display_name);
                                                            setMissingFlowAssignSearch(emp.display_name);
                                                            setShowMissingFlowAssignDropdown(false);
                                                        }}
                                                    />
                                                ))}
                                            {employees.filter(emp =>
                                                emp.display_name
                                                    .toLowerCase()
                                                    .includes(missingFlowAssignSearch.toLowerCase())
                                            ).length === 0 && (
                                                <div className="px-3 py-6 text-center text-sm text-base-content/60">
                                                    No matches
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="modal-action mt-4 shrink-0 flex-wrap gap-2 border-t border-base-200 pt-4">
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        disabled={savingMissingFlowAssign}
                                        onClick={() => {
                                            setMissingFlowAssignName('');
                                            setMissingFlowAssignSearch('');
                                            setShowMissingFlowAssignDropdown(false);
                                            setActiveHandlerMissingFlow(prev =>
                                                prev ? { ...prev, step: 'ask' } : null
                                            );
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={
                                            savingMissingFlowAssign || !missingFlowAssignName.trim()
                                        }
                                        onClick={handleMissingFlowAssignAndApply}
                                    >
                                        {savingMissingFlowAssign ? (
                                            <>
                                                <span className="loading loading-spinner loading-sm" />
                                                Saving…
                                            </>
                                        ) : (
                                            'Assign & apply'
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    <form
                        method="dialog"
                        className="modal-backdrop"
                        onClick={() => {
                            if (savingMissingFlowAssign) return;
                            if (activeHandlerMissingFlow?.step === 'assign') {
                                setMissingFlowAssignName('');
                                setMissingFlowAssignSearch('');
                                setShowMissingFlowAssignDropdown(false);
                                setActiveHandlerMissingFlow(prev =>
                                    prev ? { ...prev, step: 'ask' } : null
                                );
                                return;
                            }
                            setActiveHandlerMissingFlow(null);
                        }}
                    >
                        <button type="button">close</button>
                    </form>
                </dialog>
            )}

            {singleLeadActiveFlow && (
                <dialog open className="modal modal-open z-[10065]">
                    <div
                        className={`modal-box flex w-[min(100vw-1.5rem,38rem)] max-w-none flex-col p-5 sm:p-6 ${
                            singleLeadActiveFlow.step === 'assign'
                                ? 'max-h-[min(92vh,42rem)] min-h-[22rem]'
                                : 'max-h-[90vh]'
                        }`}
                    >
                        {singleLeadActiveFlow.step === 'ask' ? (
                            <>
                                <h3 className="shrink-0 text-lg font-bold">
                                    {singleLeadActiveFlow.targetChoice === 2
                                        ? 'No case handler'
                                        : 'No retention handler'}
                                </h3>
                                <p className="mt-1 shrink-0 font-mono text-sm text-base-content/60">
                                    #
                                    {(singleLeadActiveFlow.lead as any).display_lead_number ||
                                        singleLeadActiveFlow.lead.lead_number ||
                                        singleLeadActiveFlow.lead.id}
                                </p>
                                <p className="mt-2 shrink-0 text-sm text-base-content/60">Assign first?</p>
                                <div className="modal-action mt-4 shrink-0 flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={singleActiveModalSaving}
                                        onClick={() => setSingleLeadActiveFlow(null)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={singleActiveModalSaving}
                                        onClick={() =>
                                            setSingleLeadActiveFlow(prev =>
                                                prev ? { ...prev, step: 'assign' } : null
                                            )
                                        }
                                    >
                                        Yes
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 className="shrink-0 text-lg font-bold">
                                    Assign{' '}
                                    {singleLeadActiveFlow.targetChoice === 2
                                        ? 'case handler'
                                        : 'retention handler'}
                                </h3>
                                <p className="mt-1 shrink-0 font-mono text-xs text-base-content/55">
                                    #
                                    {(singleLeadActiveFlow.lead as any).display_lead_number ||
                                        singleLeadActiveFlow.lead.lead_number ||
                                        singleLeadActiveFlow.lead.id}
                                </p>
                                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
                                    <input
                                        type="text"
                                        placeholder="Filter…"
                                        className="input input-bordered input-sm w-full shrink-0"
                                        value={singleActiveAssignSearch}
                                        onChange={e => setSingleActiveAssignSearch(e.target.value)}
                                    />
                                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-base-200 bg-base-100">
                                        <div className="p-2">
                                            {employees
                                                .filter(emp =>
                                                    emp.display_name
                                                        .toLowerCase()
                                                        .includes(singleActiveAssignSearch.toLowerCase())
                                                )
                                                .map(emp => (
                                                    <ReassignRoleEmployeeRow
                                                        key={emp.id}
                                                        emp={emp}
                                                        getInitials={getInitials}
                                                        onPick={() => {
                                                            setSingleActiveAssignName(emp.display_name);
                                                            setSingleActiveAssignSearch(emp.display_name);
                                                        }}
                                                    />
                                                ))}
                                            {employees.filter(emp =>
                                                emp.display_name
                                                    .toLowerCase()
                                                    .includes(singleActiveAssignSearch.toLowerCase())
                                            ).length === 0 && (
                                                <div className="px-3 py-6 text-center text-sm text-base-content/60">
                                                    No matches
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="modal-action mt-4 shrink-0 flex-wrap gap-2 border-t border-base-200 pt-4">
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        disabled={singleActiveModalSaving}
                                        onClick={() => {
                                            setSingleActiveAssignName('');
                                            setSingleActiveAssignSearch('');
                                            setSingleLeadActiveFlow(prev =>
                                                prev ? { ...prev, step: 'ask' } : null
                                            );
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={
                                            singleActiveModalSaving || !singleActiveAssignName.trim()
                                        }
                                        onClick={handleSingleFlowAssignAndApply}
                                    >
                                        {singleActiveModalSaving ? (
                                            <>
                                                <span className="loading loading-spinner loading-sm" />
                                                Saving…
                                            </>
                                        ) : (
                                            'Assign & apply'
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    <form
                        method="dialog"
                        className="modal-backdrop"
                        onClick={() => {
                            if (singleActiveModalSaving) return;
                            if (singleLeadActiveFlow?.step === 'assign') {
                                setSingleActiveAssignName('');
                                setSingleActiveAssignSearch('');
                                setSingleLeadActiveFlow(prev =>
                                    prev ? { ...prev, step: 'ask' } : null
                                );
                                return;
                            }
                            setSingleLeadActiveFlow(null);
                        }}
                    >
                        <button type="button">close</button>
                    </form>
                </dialog>
            )}

            {/* Results Section */}
            {reassignResults.length > 0 && (() => {
                // Calculate totals for all filtered leads
                let totalValueInNIS = 0;
                let totalApplicants = 0;

                reassignResults.forEach(lead => {
                    const balance = getLeadBalance(lead);
                    if (balance.value && balance.value > 0) {
                        // Convert to NIS for proper summation across currencies
                        totalValueInNIS += convertToNIS(balance.value, balance.currency);
                    }
                    const applicants = getLeadApplicants(lead);
                    if (applicants && applicants > 0) {
                        totalApplicants += applicants;
                    }
                });

                // Calculate totals for selected leads only
                let selectedTotalValueInNIS = 0;
                let selectedTotalApplicants = 0;

                if (selectedLeads.size > 0) {
                    reassignResults.forEach(lead => {
                        const leadId = lead.id?.toString() || '';
                        if (selectedLeads.has(leadId)) {
                            const balance = getLeadBalance(lead);
                            if (balance.value && balance.value > 0) {
                                selectedTotalValueInNIS += convertToNIS(balance.value, balance.currency);
                            }
                            const applicants = getLeadApplicants(lead);
                            if (applicants && applicants > 0) {
                                selectedTotalApplicants += applicants;
                            }
                        }
                    });
                }

                return (
                    <div className="mb-4 sm:mb-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4 gap-3">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                <h3 className="text-base sm:text-lg font-semibold">
                                    Found {reassignResults.length} lead(s)
                                    {selectedLeads.size > 0 && (
                                        <span className="ml-2 text-primary font-medium">
                                            ({selectedLeads.size} selected)
                                        </span>
                                    )}
                                </h3>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-base-content/70">
                                    {totalValueInNIS > 0 && (
                                        <span>
                                            Total Value: ₪{totalValueInNIS.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                        </span>
                                    )}
                                    {totalApplicants > 0 && (
                                        <span>
                                            Total Applicants: {totalApplicants}
                                        </span>
                                    )}
                                    {selectedLeads.size > 0 && selectedTotalValueInNIS > 0 && (
                                        <span>
                                            Selected Value: ₪{selectedTotalValueInNIS.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                        </span>
                                    )}
                                    {selectedLeads.size > 0 && selectedTotalApplicants > 0 && (
                                        <span>
                                            Selected Applicants: {selectedTotalApplicants}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <div role="tablist" aria-label="Result layout" className="flex rounded-full bg-base-200/80 p-1">
                                    {([
                                        ['list', 'List', Bars3Icon],
                                        ['cards', 'Boxes', Squares2X2Icon],
                                    ] as const).map(([mode, label, Icon]) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            role="tab"
                                            aria-selected={viewMode === mode}
                                            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${viewMode === mode ? 'bg-base-100 font-semibold text-base-content shadow-sm' : 'font-medium text-base-content/60 hover:text-base-content/80'}`}
                                            onClick={() => setViewMode(mode)}
                                        >
                                            <Icon className="h-4 w-4" />
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-sm btn-outline"
                                    onClick={selectAllLeads}
                                    disabled={selectedLeads.size === reassignResults.length}
                                >
                                    Select All
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-sm btn-outline"
                                    onClick={deselectAllLeads}
                                    disabled={selectedLeads.size === 0}
                                >
                                    Deselect All
                                </button>
                            </div>
                        </div>
                        {viewMode === 'list' ? (
                            <div className={`${PIPELINE_TABLE_SHELL} mt-2`}>
                                <table className="pipeline-flat-table table-auto border-separate border-spacing-0 w-full text-sm">
                                    <thead className="sticky top-0 z-10 bg-[#f3f4f6] text-xs uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th className="w-10 px-2 py-3" />
                                            <th className="px-2 py-3 text-left">Lead</th>
                                            <th className="px-2 py-3 text-center">Stage</th>
                                            {roleColumnVisible('handler') && <th className="px-2 py-3 text-left">Handler</th>}
                                            <th className="px-2 py-3 text-center">Active</th>
                                            {roleColumnVisible('retainer_handler') && <th className="px-2 py-3 text-left">Retention</th>}
                                            {extraRoleColumns.map(role => (
                                                <th key={role} className="px-2 py-3 text-left">
                                                    {ROLE_COLUMN_SOURCES[role].label}
                                                </th>
                                            ))}
                                            <th className="px-2 py-3 text-center">Created</th>
                                            <th className="px-2 py-3 text-center">Category</th>
                                            <th className="px-2 py-3 text-center">Source</th>
                                            <th className="px-2 py-3 text-center">Language</th>
                                            <th className="px-2 py-3 text-right">Value</th>
                                            <th className="px-2 py-3 text-center">App.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reassignResults.map((lead) => {
                                            const info = describeResultLead(lead);
                                            return (
                                                <tr
                                                    key={lead.id}
                                                    className={`pipeline-flat-row group cursor-pointer [&>td]:border-b [&>td]:border-gray-100 ${info.isSelected ? 'pipeline-flat-row-selected' : ''}`}
                                                    onClick={() => toggleLeadSelection(info.leadId)}
                                                >
                                                    <td className="px-2 py-3 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="checkbox checkbox-primary checkbox-sm"
                                                            checked={info.isSelected}
                                                            onChange={() => toggleLeadSelection(info.leadId)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    </td>
                                                    <td className="px-2 py-3 text-left max-w-[16rem]">
                                                        <button
                                                            type="button"
                                                            title="Open client (⌘ or Ctrl+click for new tab)"
                                                            className="block max-w-full font-mono text-xs font-bold text-gray-500 hover:text-primary hover:underline"
                                                            onClick={e => navigateToClientFromReassignLead(lead, e)}
                                                        >
                                                            {info.displayNumber}
                                                        </button>
                                                        <span className="block truncate font-semibold text-base-content group-hover:text-primary">
                                                            {lead.name || 'No Name'}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-3 text-center">
                                                        <ReassignStageBadge stage={lead.stage} />
                                                    </td>
                                                    {roleColumnVisible('handler') && (
                                                        <td className="px-2 py-3 text-left">
                                                            {info.handlerName ? (
                                                                <div className="flex items-center gap-2">
                                                                    <ReassignRoleAvatar
                                                                        name={info.handlerName}
                                                                        photoUrl={info.handlerPhoto}
                                                                        tone="primary"
                                                                        className="h-8 w-8"
                                                                    />
                                                                    <span className="truncate text-xs font-medium">{info.handlerName}</span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-base-content/30">-</span>
                                                            )}
                                                        </td>
                                                    )}
                                                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex justify-center">
                                                            <ReassignActiveToggle
                                                                activeType={info.activeType}
                                                                disabled={info.busy || singleActiveModalSaving}
                                                                onPick={(type, e) => handleSingleLeadActivePick(lead, type, e)}
                                                                className="h-7 w-[4.25rem]"
                                                            />
                                                        </div>
                                                    </td>
                                                    {roleColumnVisible('retainer_handler') && (
                                                        <td className="px-2 py-3 text-left">
                                                            {info.retention ? (
                                                                <div className="flex items-center gap-2">
                                                                    <ReassignRoleAvatar
                                                                        name={info.retention.display_name}
                                                                        photoUrl={info.retention.photo_url}
                                                                        tone="secondary"
                                                                        className="h-8 w-8"
                                                                    />
                                                                    <span className="truncate text-xs font-medium">{info.retention.display_name}</span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-base-content/30">-</span>
                                                            )}
                                                        </td>
                                                    )}
                                                    {extraRoleColumns.map(role => (
                                                        <td key={role} className="px-2 py-3 text-left">
                                                            <ReassignRoleCell assignees={roleAssignees(role, lead)} />
                                                        </td>
                                                    ))}
                                                    <td className="px-2 py-3 text-center whitespace-nowrap text-xs">{info.created}</td>
                                                    <td className="px-2 py-3 text-center text-xs">{info.category}</td>
                                                    <td className="px-2 py-3 text-center text-xs">{info.source}</td>
                                                    <td className="px-2 py-3 text-center text-xs">{info.language}</td>
                                                    <td className="px-2 py-3 text-right whitespace-nowrap font-medium">
                                                        {formatResultBalance(info.balance)}
                                                    </td>
                                                    <td className="px-2 py-3 text-center font-medium">
                                                        {info.applicants && info.applicants > 0 ? info.applicants : 'N/A'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                            {reassignResults.map((lead) => {
                                const info = describeResultLead(lead);
                                const { leadId, isSelected, activeType: activeTypeCard, busy: busyThisLead } = info;

                                return (
                                    <div
                                        key={lead.id}
                                        className={`card shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group border ${isSelected ? 'ring-2 ring-primary bg-primary/5' : 'bg-base-100 border-base-200'
                                            }`}
                                        onClick={() => toggleLeadSelection(leadId)}
                                    >
                                        <div className="card-body p-5 relative">
                                            <div className="flex items-start gap-2 mb-2">
                                                <input
                                                    type="checkbox"
                                                    className="checkbox checkbox-primary mt-1"
                                                    checked={isSelected}
                                                    onChange={() => toggleLeadSelection(leadId)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                                                            {lead.name || 'No Name'}
                                                        </h2>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        <ReassignStageBadge stage={lead.stage} />
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                title="Open client (⌘ or Ctrl+click for new tab)"
                                                className="mb-2 block w-full text-left font-mono text-sm text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                                                onClick={e => navigateToClientFromReassignLead(lead, e)}
                                            >
                                                #{(lead as any).display_lead_number || lead.lead_number || lead.id || 'Unknown Lead'}
                                            </button>

                                            {(roleColumnVisible('handler') || roleColumnVisible('retainer_handler')) && (
                                            <div
                                                className="mb-3 rounded-2xl border border-base-300/50 bg-base-200/20 px-2 py-3 sm:px-3"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1.5 sm:gap-x-2">
                                                    {roleColumnVisible('handler') && (
                                                    <div
                                                        className={`min-w-0 text-center transition-opacity duration-300 ${
                                                            activeTypeCard === 2 ? 'opacity-100' : 'opacity-[0.52]'
                                                        }`}
                                                    >
                                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-base-content/55">
                                                            Handler
                                                        </span>
                                                        <div className="mt-1.5 flex min-h-[2.5rem] flex-col items-center justify-center gap-1 sm:min-h-[2.75rem]">
                                                            {info.handlerName ? (
                                                                <>
                                                                    <ReassignRoleAvatar
                                                                        name={info.handlerName}
                                                                        photoUrl={info.handlerPhoto}
                                                                        tone="primary"
                                                                    />
                                                                    <span className="line-clamp-2 max-w-full px-0.5 text-[11px] font-medium leading-tight text-base-content sm:text-xs">
                                                                        {info.handlerName}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <span className="text-[11px] text-base-content/40">Not assigned</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    )}

                                                    <div className="flex shrink-0 flex-col items-center justify-center px-0.5">
                                                        <ReassignActiveToggle
                                                            activeType={activeTypeCard}
                                                            disabled={busyThisLead || singleActiveModalSaving}
                                                            onPick={(type, e) => handleSingleLeadActivePick(lead, type, e)}
                                                        />
                                                    </div>

                                                    {roleColumnVisible('retainer_handler') && (
                                                    <div
                                                        className={`min-w-0 text-center transition-opacity duration-300 ${
                                                            activeTypeCard === 1 ? 'opacity-100' : 'opacity-[0.52]'
                                                        }`}
                                                    >
                                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-base-content/55">
                                                            Retention
                                                        </span>
                                                        <div className="mt-1.5 flex min-h-[2.5rem] flex-col items-center justify-center gap-1 sm:min-h-[2.75rem]">
                                                            {info.retention ? (
                                                                <>
                                                                    <ReassignRoleAvatar
                                                                        name={info.retention.display_name}
                                                                        photoUrl={info.retention.photo_url}
                                                                        tone="secondary"
                                                                    />
                                                                    <span className="line-clamp-2 max-w-full px-0.5 text-[11px] font-medium leading-tight text-base-content sm:text-xs">
                                                                        {info.retention.display_name}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <span className="text-[11px] text-base-content/40">Not assigned</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            )}

                                            {extraRoleColumns.length > 0 && (
                                                <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2">
                                                    {extraRoleColumns.map(role => (
                                                        <div key={role} className="min-w-0">
                                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-base-content/55">
                                                                {ROLE_COLUMN_SOURCES[role].label}
                                                            </span>
                                                            <div className="mt-1">
                                                                <ReassignRoleCell assignees={roleAssignees(role, lead)} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="divider my-0"></div>

                                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                                                <div className="flex items-center gap-2" title="Date Created">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                    <span className="font-medium">{info.created}</span>
                                                </div>
                                                <div className="flex items-center gap-2" title="Category">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                    <span>{info.category}</span>
                                                </div>
                                                <div className="flex items-center gap-2" title="Source">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                    </svg>
                                                    <span>{info.source}</span>
                                                </div>
                                                <div className="flex items-center gap-2" title="Language">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                                    </svg>
                                                    <span>{info.language}</span>
                                                </div>

                                                {/* Total Value */}
                                                <div className="flex items-center gap-2" title="Total Value">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <span className="font-medium">{formatResultBalance(info.balance)}</span>
                                                </div>

                                                {/* Total Applicants */}
                                                <div className="flex items-center gap-2" title="Total Applicants">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                                    </svg>
                                                    <span className="font-medium">
                                                        {info.applicants && info.applicants > 0 ? info.applicants : 'N/A'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        )}
                    </div>
                );
            })()}

            {reassignResults.length === 0 && !reassignLoading && (
                <div className="text-center py-8 text-base-content/60">
                    <p className="mb-4">No results found. Try adjusting your filters and search again.</p>
                    <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowFilters(true)}
                    >
                        Filters
                    </button>
                </div>
            )}
        </div>
        </>
    );
};

export default ReassignLeadsReport;
