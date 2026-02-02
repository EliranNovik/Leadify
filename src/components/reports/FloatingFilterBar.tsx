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
            {/* Mobile View - Bottom Fixed Bar */}
            <div className="md:hidden fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[9999] pointer-events-auto w-[95vw] max-w-[95vw]">
                <div className="bg-white/60 backdrop-blur-2xl rounded-full px-4 py-3 shadow-2xl border border-white/40 flex items-center gap-2 flex-wrap justify-center hover:shadow-3xl transition-all duration-300">
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

                    {/* Role Selection Dropdown - Only show when no role filter is active */}
                    {!activeRoleFilter && (
                        <div className="relative role-dropdown-container" ref={roleDropdownRef}>
                            <button
                                type="button"
                                className="btn btn-sm btn-outline rounded-full px-3 text-sm"
                                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                            >
                                <span className="hidden sm:inline">Assign as: </span>
                                <span className="sm:hidden">Role: </span>
                                {roleLabels[selectedRoleForReassign] || 'Select'}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showRoleDropdown && (
                                <div className="absolute bottom-full left-0 mb-2 z-50 bg-white/80 backdrop-blur-xl border border-white/40 rounded-lg shadow-lg w-56">
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
                    )}

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
                            <div className="absolute bottom-full left-0 mb-2 z-50 bg-white/80 backdrop-blur-xl border border-white/40 rounded-lg shadow-lg w-full max-h-60 overflow-y-auto">
                                <div className="p-2">
                                    {employees
                                        .filter(emp =>
                                            emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                        )
                                        .map((emp) => (
                                            <button
                                                key={emp.id}
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-base-200 rounded-md transition-colors"
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
                        className="btn btn-primary btn-sm rounded-full px-3 text-sm flex-shrink-0"
                        onClick={handleReassignLeads}
                        disabled={reassigning || !selectedEmployeeForReassign || selectedLeadsCount === 0}
                    >
                        {reassigning ? (
                            <>
                                <span className="loading loading-spinner loading-xs"></span>
                                <span className="hidden xs:inline">Re-assigning...</span>
                            </>
                        ) : (
                            'Re-assign'
                        )}
                    </button>
                </div>
            </div>

            {/* Desktop View - Bottom Fixed Bar */}
            <div className="hidden md:flex fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[9999] pointer-events-auto">
                <div className="bg-white/60 backdrop-blur-2xl rounded-full px-8 py-4 shadow-2xl border border-white/40 flex items-center gap-4 flex-nowrap justify-center max-w-[97vw] hover:shadow-3xl transition-all duration-300">
                    {/* Show Filters Button */}
                    <button
                        onClick={onShowFilters}
                        className="btn btn-sm btn-ghost rounded-full px-4 text-sm"
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
                                className="btn btn-sm btn-outline rounded-full px-4 text-sm"
                                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                            >
                                Assign as: {roleLabels[selectedRoleForReassign] || 'Select Role'}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showRoleDropdown && (
                                <div className="absolute bottom-full left-0 mb-2 z-50 bg-white/80 backdrop-blur-xl border border-white/40 rounded-lg shadow-lg w-56">
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
                    )}

                    {/* Assign to Employee Dropdown */}
                    <div className="relative assign-employee-dropdown-container" ref={assignEmployeeDropdownRef}>
                        <input
                            type="text"
                            placeholder="Assign to employee..."
                            className="input input-bordered input-sm rounded-full w-72 text-sm"
                            value={assignEmployeeSearchTerm}
                            onChange={(e) => {
                                setAssignEmployeeSearchTerm(e.target.value);
                            }}
                            onFocus={() => {
                                setShowAssignEmployeeDropdown(true);
                            }}
                        />
                        {showAssignEmployeeDropdown && (
                            <div className="absolute bottom-full left-0 mb-2 z-50 bg-white/80 backdrop-blur-xl border border-white/40 rounded-lg shadow-lg w-72 max-h-80 overflow-y-auto">
                                <div className="p-2">
                                    {employees
                                        .filter(emp =>
                                            emp.display_name.toLowerCase().includes(assignEmployeeSearchTerm.toLowerCase())
                                        )
                                        .map((emp) => (
                                            <button
                                                key={emp.id}
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-base-200 rounded-md transition-colors"
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
                        className="btn btn-primary btn-sm rounded-full px-4 text-sm"
                        onClick={handleReassignLeads}
                        disabled={reassigning || !selectedEmployeeForReassign || selectedLeadsCount === 0}
                    >
                        {reassigning ? (
                            <>
                                <span className="loading loading-spinner loading-xs"></span>
                                Re-assigning...
                            </>
                        ) : (
                            'Re-assign'
                        )}
                    </button>
                </div>
            </div>
        </>
    );
};

export default FloatingFilterBar;
