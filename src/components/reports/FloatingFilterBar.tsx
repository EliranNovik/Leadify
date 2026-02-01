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
    activeRoleFilter: string | null;
    showRoleDropdown: boolean;
    setShowRoleDropdown: (show: boolean) => void;
}

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
    activeRoleFilter,
    showRoleDropdown,
    setShowRoleDropdown
}) => {
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
        { value: 'helper', label: 'Helper' }
    ];

    const roleLabels: { [key: string]: string } = {
        scheduler: 'Scheduler',
        closer: 'Closer',
        meetingManager: 'Meeting Manager',
        handler: 'Handler',
        helper: 'Helper'
    };
    return (
        <>
            {/* Mobile View - Sticky Bar Under Header (only filtered by and filter button) */}
            <div className="md:hidden sticky top-0 z-[9999] pointer-events-auto w-full -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-base-100/95 backdrop-blur-sm border-b border-base-200">
                <div className="bg-white/95 backdrop-blur-xl rounded-full px-3 py-2 shadow-lg border border-white/70 flex items-center gap-2 flex-wrap justify-between hover:shadow-xl transition-all duration-300 w-full">
                    {/* Show Filters Button */}
                    <button
                        onClick={onShowFilters}
                        className="btn btn-xs btn-ghost rounded-full px-2 flex-shrink-0"
                        title="Show all filters"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                    </button>

                    {/* Filtered by Employee Box - Mobile Only */}
                    {filteredEmployees.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0 justify-end">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {filteredEmployees.map(({ employee, role, roleLabel }, index) => (
                                    <div
                                        key={`floating-mobile-${employee.id}-${role}-${index}`}
                                        className="flex items-center gap-1.5 px-2 py-1 bg-gradient-to-r from-primary/20 to-primary/10 rounded-full border border-primary/30 backdrop-blur-sm flex-shrink-0"
                                    >
                                        {employee.photo_url ? (
                                            <img
                                                src={employee.photo_url}
                                                alt={employee.display_name}
                                                className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.style.display = 'none';
                                                    const parent = target.parentElement;
                                                    if (parent) {
                                                        const fallback = document.createElement('div');
                                                        fallback.className = 'w-5 h-5 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-xs flex-shrink-0';
                                                        fallback.textContent = getInitials(employee.display_name);
                                                        parent.appendChild(fallback);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <div className="w-5 h-5 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-xs flex-shrink-0">
                                                {getInitials(employee.display_name)}
                                            </div>
                                        )}
                                        <span className="text-xs font-medium truncate max-w-[80px]">{employee.display_name}</span>
                                        <span className="text-xs text-base-content/60 hidden sm:inline">({roleLabel})</span>
                                        <button
                                            onClick={() => onRemoveFilter(role)}
                                            className="btn btn-ghost btn-xs p-0 h-4 w-4 min-h-0 text-error hover:bg-error/10 rounded-full flex-shrink-0"
                                            title="Remove filter"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Desktop View - Bottom Fixed Bar */}
            <div className="hidden md:flex fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[9999] pointer-events-auto">
                <div className="bg-white/95 backdrop-blur-xl rounded-full px-6 py-4 shadow-2xl border border-white/70 flex items-center gap-3 flex-wrap justify-center max-w-[95vw] hover:shadow-3xl transition-all duration-300 min-w-fit">
                    {/* Show Filters Button */}
                    <button
                        onClick={onShowFilters}
                        className="btn btn-sm btn-ghost rounded-full px-4"
                        title="Show all filters"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        Filters
                    </button>

                    {/* Role Selection Dropdown - Only show when no role filter is active */}
                    {!activeRoleFilter && (
                        <div className="relative role-dropdown-container" ref={roleDropdownRef}>
                            <button
                                type="button"
                                className="btn btn-sm btn-outline rounded-full px-4"
                                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                            >
                                Assign as: {roleLabels[selectedRoleForReassign] || 'Select Role'}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showRoleDropdown && (
                                <div className="absolute bottom-full left-0 mb-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-48">
                                    <div className="p-2">
                                        {roleOptions.map((role) => (
                                            <button
                                                key={role.value}
                                                type="button"
                                                className={`w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors ${selectedRoleForReassign === role.value ? 'bg-primary/10 text-primary font-medium' : ''}`}
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
                    )}

                    {/* Assign to Employee Dropdown */}
                    <div className="relative assign-employee-dropdown-container" ref={assignEmployeeDropdownRef}>
                        <input
                            type="text"
                            placeholder="Assign to employee..."
                            className="input input-bordered input-sm rounded-full w-48"
                            value={assignEmployeeSearchTerm}
                            onChange={(e) => {
                                setAssignEmployeeSearchTerm(e.target.value);
                            }}
                            onFocus={() => {
                                setShowAssignEmployeeDropdown(true);
                            }}
                        />
                        {showAssignEmployeeDropdown && (
                            <div className="absolute bottom-full left-0 mb-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-48 max-h-80 overflow-y-auto">
                                <div className="p-2">
                                    {employees
                                        .filter(emp =>
                                            emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                        )
                                        .map((emp) => (
                                            <button
                                                key={emp.id}
                                                type="button"
                                                className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedEmployeeForReassign(emp.display_name);
                                                    setAssignEmployeeSearchTerm(emp.display_name);
                                                    setShowAssignEmployeeDropdown(false);
                                                }}
                                            >
                                                {emp.display_name}
                                            </button>
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

                    {/* Re-assign Button */}
                    <button
                        className="btn btn-primary btn-sm rounded-full px-4"
                        onClick={handleReassignLeads}
                        disabled={reassigning || !selectedEmployeeForReassign || selectedLeadsCount === 0}
                    >
                        {reassigning ? (
                            <>
                                <span className="loading loading-spinner loading-xs"></span>
                                Re-assigning...
                            </>
                        ) : (
                            `Re-assign ${selectedLeadsCount > 0 ? selectedLeadsCount : 'Selected'} Lead(s)`
                        )}
                    </button>
                </div>
            </div>
        </>
    );
};

export default FloatingFilterBar;
