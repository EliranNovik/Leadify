import React from 'react';

interface FloatingFilterBarProps {
    fromDate: string;
    toDate: string;
    onFromDateChange: (date: string) => void;
    onToDateChange: (date: string) => void;
    filteredEmployees: Array<{
        employee: {
            id: number;
            display_name: string;
            photo_url?: string | null;
        };
        role: string;
        roleLabel: string;
    }>;
    onRemoveFilter: (role: string) => void;
    onSearch: () => void;
    isLoading: boolean;
    onShowFilters: () => void;
    getInitials: (name: string) => string;
    // New props for assign employee dropdown and reassign button
    employees: Array<{
        id: number;
        display_name: string;
        photo_url?: string | null;
    }>;
    assignEmployeeSearchTerm: string;
    setAssignEmployeeSearchTerm: (term: string) => void;
    selectedEmployeeForReassign: string;
    setSelectedEmployeeForReassign: (name: string) => void;
    showAssignEmployeeDropdown: boolean;
    setShowAssignEmployeeDropdown: (show: boolean) => void;
    handleReassignLeads: () => void;
    reassigning: boolean;
    selectedLeadsCount: number;
    // Role selection props
    selectedRoleForReassign: string;
    setSelectedRoleForReassign: (role: string) => void;
    showRoleDropdown: boolean;
    setShowRoleDropdown: (show: boolean) => void;
    /** Opens modal to set case handler vs retention as active (only for handler / retention assign role). */
    onOpenActiveHandlerModal?: () => void;
    /** When true (e.g. zero search results), bar is visible but not interactive */
    interactionsDisabled?: boolean;
    /** Every role the results can show, and the ones showing now. Omit to hide the settings button. */
    roleColumnOptions?: Array<{ value: string; label: string }>;
    visibleRoleColumns?: string[];
    onToggleRoleColumn?: (role: string) => void;
}

type AssignEmployee = {
    id: number;
    display_name: string;
    photo_url?: string | null;
};

const AssignEmployeeDropdownRow: React.FC<{
    emp: AssignEmployee;
    getInitials: (name: string) => string;
    onPick: () => void;
}> = ({ emp, getInitials, onPick }) => {
    const [photoFailed, setPhotoFailed] = React.useState(false);
    const showPhoto = Boolean(emp.photo_url) && !photoFailed;

    return (
        <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200 rounded-md transition-colors"
            onClick={(e) => {
                e.stopPropagation();
                onPick();
            }}
        >
            {showPhoto ? (
                <img
                    src={emp.photo_url!}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-base-300/80"
                    onError={() => setPhotoFailed(true)}
                />
            ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-base-300/80">
                    {getInitials(emp.display_name)}
                </div>
            )}
            <span className="min-w-0 truncate">{emp.display_name}</span>
        </button>
    );
};

/**
 * Which roles the results show, as a menu rather than a row of toggles: nine roles would take more
 * of the bar than the assigning it exists for.
 *
 * Opens upwards, because the bar it hangs off sits at the bottom of the window.
 */
const ReassignViewSettingsMenu: React.FC<{
    options: Array<{ value: string; label: string }>;
    visible: string[];
    onToggle: (role: string) => void;
}> = ({ options, visible, onToggle }) => {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    return (
        <div className="relative shrink-0" ref={containerRef}>
            <button
                type="button"
                className={`btn btn-sm btn-circle ${open ? 'btn-primary' : 'btn-ghost'}`}
                title="Choose which roles the results show"
                aria-label="View settings"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
            {open && (
                <div className="absolute bottom-full right-0 mb-2 z-50 w-64 rounded-xl border border-base-300/70 bg-white shadow-lg">
                    <div className="border-b border-base-200 px-3 py-2">
                        <p className="text-sm font-semibold">Roles shown</p>
                        <p className="text-xs text-base-content/60">In the table and the card view.</p>
                    </div>
                    <div className="max-h-72 overflow-y-auto p-2">
                        {options.map(option => (
                            <label
                                key={option.value}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-base-200"
                            >
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-sm checkbox-primary"
                                    checked={visible.includes(option.value)}
                                    onChange={() => onToggle(option.value)}
                                />
                                <span className="min-w-0 truncate">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const FloatingFilterBar: React.FC<FloatingFilterBarProps> = ({
    fromDate,
    toDate,
    onFromDateChange,
    onToDateChange,
    filteredEmployees,
    onRemoveFilter,
    onSearch,
    isLoading,
    onShowFilters,
    getInitials,
    employees,
    assignEmployeeSearchTerm,
    setAssignEmployeeSearchTerm,
    selectedEmployeeForReassign,
    setSelectedEmployeeForReassign,
    showAssignEmployeeDropdown,
    setShowAssignEmployeeDropdown,
    handleReassignLeads,
    reassigning,
    selectedLeadsCount,
    selectedRoleForReassign,
    setSelectedRoleForReassign,
    showRoleDropdown,
    setShowRoleDropdown,
    onOpenActiveHandlerModal,
    interactionsDisabled = false,
    roleColumnOptions,
    visibleRoleColumns = [],
    onToggleRoleColumn
}) => {
    // Dimmed enough to read as disabled, but still clearly present: on the grey page background the
    // old 40% left the bar looking like it had disappeared.
    const barLockClass = interactionsDisabled ? 'pointer-events-none opacity-70 select-none' : '';
    const roleColumnMenu =
        roleColumnOptions && roleColumnOptions.length > 0 && onToggleRoleColumn ? (
            <ReassignViewSettingsMenu
                options={roleColumnOptions}
                visible={visibleRoleColumns}
                onToggle={onToggleRoleColumn}
            />
        ) : null;
    const showActiveHandlerBulk =
        Boolean(onOpenActiveHandlerModal) &&
        (selectedRoleForReassign === 'handler' || selectedRoleForReassign === 'retainer_handler');
    const roleDropdownRef = React.useRef<HTMLDivElement>(null);
    const assignEmployeeDropdownRef = React.useRef<HTMLDivElement>(null);

    // Close role dropdown when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
                setShowRoleDropdown(false);
            }
            if (assignEmployeeDropdownRef.current && !assignEmployeeDropdownRef.current.contains(event.target as Node)) {
                setShowAssignEmployeeDropdown(false);
            }
        };
        if (showRoleDropdown || showAssignEmployeeDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showRoleDropdown, showAssignEmployeeDropdown, setShowRoleDropdown, setShowAssignEmployeeDropdown]);

    const roleOptions = [
        { value: 'scheduler', label: 'Scheduler' },
        { value: 'closer', label: 'Closer' },
        { value: 'meetingManager', label: 'Meeting Manager' },
        { value: 'handler', label: 'Handler' },
        { value: 'helper', label: 'Helper' },
        { value: 'expert', label: 'Expert' },
        { value: 'retainer_handler', label: 'Retention Handler' },
        { value: 'helper_handler', label: 'Helper Handler' },
        { value: 'client_support', label: 'Client Support' },
    ];

    const roleLabels: { [key: string]: string } = {
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
    return (
        <>
            {/* Mobile View - Bottom Fixed Bar */}
            <div className={`md:hidden fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[9999] w-[95vw] max-w-[95vw] ${barLockClass}`} aria-disabled={interactionsDisabled}>
                <div className="bg-white rounded-full px-4 py-3 shadow-2xl border border-base-300/70 flex items-center gap-2 flex-wrap justify-center hover:shadow-3xl transition-all duration-300">
                    {/* Show Filters Button */}
                    <button
                        onClick={onShowFilters}
                        className="btn btn-sm btn-ghost rounded-full px-3 text-sm flex-shrink-0"
                        title="Show all filters"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        <span className="hidden xs:inline">Filters</span>
                    </button>

                    {/* Role to assign (independent of sidebar role filter) */}
                    <div className="relative role-dropdown-container" ref={roleDropdownRef}>
                        <button
                            type="button"
                            className="btn btn-sm btn-outline rounded-full px-3 text-sm"
                            onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                        >
                            <span className="hidden sm:inline">Role to assign: </span>
                            <span className="sm:hidden">Role: </span>
                            {roleLabels[selectedRoleForReassign] || 'Select'}
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {showRoleDropdown && (
                            <div className="absolute bottom-full left-0 mb-2 z-50 bg-white border border-base-300/70 rounded-lg shadow-lg w-56">
                                <div className="p-2">
                                    {roleOptions.map((role) => (
                                        <button
                                            key={role.value}
                                            type="button"
                                            className={`w-full text-left px-3 py-2 text-sm hover:bg-base-200 rounded-md transition-colors ${selectedRoleForReassign === role.value ? 'bg-primary/10 text-primary font-medium' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedRoleForReassign(role.value);
                                                setShowRoleDropdown(false);
                                            }}
                                        >
                                            {role.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Assign to Employee Dropdown */}
                    <div className="relative assign-employee-dropdown-container flex-1 min-w-[120px]" ref={assignEmployeeDropdownRef}>
                        <input
                            type="text"
                            placeholder="Assign to..."
                            className="input input-bordered input-sm rounded-full w-full text-sm"
                            value={assignEmployeeSearchTerm}
                            onChange={(e) => {
                                setAssignEmployeeSearchTerm(e.target.value);
                            }}
                            onFocus={() => {
                                setShowAssignEmployeeDropdown(true);
                            }}
                        />
                        {showAssignEmployeeDropdown && (
                            <div className="absolute bottom-full left-0 mb-2 z-50 bg-white border border-base-300/70 rounded-lg shadow-lg w-full max-h-60 overflow-y-auto">
                                <div className="p-2">
                                    {employees
                                        .filter(emp =>
                                            emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                        )
                                        .map((emp) => (
                                            <AssignEmployeeDropdownRow
                                                key={emp.id}
                                                emp={emp}
                                                getInitials={getInitials}
                                                onPick={() => {
                                                    setSelectedEmployeeForReassign(emp.display_name);
                                                    setAssignEmployeeSearchTerm(emp.display_name);
                                                    setShowAssignEmployeeDropdown(false);
                                                }}
                                            />
                                        ))}
                                    {employees.filter(emp =>
                                        emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                    ).length === 0 && (
                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                No employees found
                                            </div>
                                        )}
                                </div>
                            </div>
                        )}
                    </div>

                    {showActiveHandlerBulk && (
                        <button
                            type="button"
                            className="btn btn-outline btn-sm rounded-full px-3 text-sm flex-shrink-0 border-primary/30"
                            title="Set whether the case handler or retention handler is active on the case"
                            onClick={() => onOpenActiveHandlerModal?.()}
                            disabled={selectedLeadsCount === 0}
                        >
                            <span className="hidden xs:inline">Set active</span>
                            <span className="xs:hidden" aria-hidden>
                                Active
                            </span>
                        </button>
                    )}

                    {/* Assign role */}
                    <button
                        className="btn btn-primary btn-sm rounded-full px-3 text-sm flex-shrink-0"
                        onClick={handleReassignLeads}
                        disabled={reassigning || !selectedEmployeeForReassign || selectedLeadsCount === 0}
                    >
                        {reassigning ? (
                            <>
                                <span className="loading loading-spinner loading-xs"></span>
                                <span className="hidden xs:inline">Assigning…</span>
                            </>
                        ) : (
                            'Assign role'
                        )}
                    </button>

                    {roleColumnMenu}
                </div>
            </div>

            {/* Desktop View - Bottom Fixed Bar */}
            <div className={`hidden md:flex fixed bottom-6 left-32 right-0 z-[9999] justify-center px-4 ${barLockClass}`} aria-disabled={interactionsDisabled}>
                <div className="w-full max-w-[52rem] bg-white rounded-full px-4 py-3 shadow-2xl border border-base-300/70 flex items-center justify-center gap-3 flex-nowrap hover:shadow-3xl transition-all duration-300">
                    {/* Show Filters Button */}
                    <button
                        onClick={onShowFilters}
                        className="btn btn-sm btn-ghost shrink-0 rounded-full px-3 text-sm"
                        title="Show all filters"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        Filters
                    </button>

                    {/* Role to assign (independent of sidebar role filter) */}
                    <div className="relative role-dropdown-container shrink-0" ref={roleDropdownRef}>
                        <button
                            type="button"
                            className="btn btn-sm btn-outline whitespace-nowrap rounded-full px-3 text-sm"
                            onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                        >
                            Role: {roleLabels[selectedRoleForReassign] || 'Select role'}                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {showRoleDropdown && (
                            <div className="absolute bottom-full left-0 mb-2 z-50 bg-white border border-base-300/70 rounded-lg shadow-lg w-56">
                                <div className="p-2">
                                    {roleOptions.map((role) => (
                                        <button
                                            key={role.value}
                                            type="button"
                                            className={`w-full text-left px-3 py-2 text-sm hover:bg-base-200 rounded-md transition-colors ${selectedRoleForReassign === role.value ? 'bg-primary/10 text-primary font-medium' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedRoleForReassign(role.value);
                                                setShowRoleDropdown(false);
                                            }}
                                        >
                                            {role.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Assign to Employee Dropdown */}
                    <div className="relative assign-employee-dropdown-container min-w-0 flex-1 max-w-[16rem]" ref={assignEmployeeDropdownRef}>
                        <input
                            type="text"
                            placeholder="Assign to employee..."
                            className="input input-bordered input-sm w-full min-w-0 rounded-full text-sm"
                            value={assignEmployeeSearchTerm}
                            onChange={(e) => {
                                setAssignEmployeeSearchTerm(e.target.value);
                            }}
                            onFocus={() => {
                                setShowAssignEmployeeDropdown(true);
                            }}
                        />
                        {showAssignEmployeeDropdown && (
                            <div className="absolute bottom-full left-0 mb-2 z-50 bg-white border border-base-300/70 rounded-lg shadow-lg w-72 max-h-80 overflow-y-auto">
                                <div className="p-2">
                                    {employees
                                        .filter(emp =>
                                            emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                        )
                                        .map((emp) => (
                                            <AssignEmployeeDropdownRow
                                                key={emp.id}
                                                emp={emp}
                                                getInitials={getInitials}
                                                onPick={() => {
                                                    setSelectedEmployeeForReassign(emp.display_name);
                                                    setAssignEmployeeSearchTerm(emp.display_name);
                                                    setShowAssignEmployeeDropdown(false);
                                                }}
                                            />
                                        ))}
                                    {employees.filter(emp =>
                                        emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                    ).length === 0 && (
                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                No employees found
                                            </div>
                                        )}
                                </div>
                            </div>
                        )}
                    </div>

                    {showActiveHandlerBulk && (
                        <button
                            type="button"
                            className="btn btn-outline btn-sm shrink-0 whitespace-nowrap rounded-full px-3 text-sm border-primary/30"
                            title="Set whether the case handler or retention handler is active on the case"
                            onClick={() => onOpenActiveHandlerModal?.()}
                            disabled={selectedLeadsCount === 0}
                        >
                            Set active on case
                        </button>
                    )}

                    {/* Assign role */}
                    <button
                        className="btn btn-primary btn-sm shrink-0 whitespace-nowrap rounded-full px-4 text-sm"
                        onClick={handleReassignLeads}
                        disabled={reassigning || !selectedEmployeeForReassign || selectedLeadsCount === 0}
                    >
                        {reassigning ? (
                            <>
                                <span className="loading loading-spinner loading-xs"></span>
                                Assigning…
                            </>
                        ) : (
                            'Assign role'
                        )}
                    </button>

                    {roleColumnMenu}
                </div>
            </div>
        </>
    );
};

export default FloatingFilterBar;
