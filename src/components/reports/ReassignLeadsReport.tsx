import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { usePersistedFilters, usePersistedState } from '../../hooks/usePersistedState';
import { getStageName, getStageColour, fetchStageNames } from '../../lib/stageUtils';
import { convertToNIS } from '../../lib/currencyConversion';
import FloatingFilterBar from './FloatingFilterBar';

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
        eligibilityDeterminedOnly: false,
        selectedLeadIds: [] as string[]
    }, {
        storage: 'sessionStorage',
    });
    const [reassignResults, setReassignResults] = usePersistedState<any[]>('reassignLeadsReport_results', [], {
        storage: 'sessionStorage',
    });
    const [reassignLoading, setReassignLoading] = useState(false);
    const [selectedEmployeeForReassign, setSelectedEmployeeForReassign] = usePersistedState<string>('reassignLeadsReport_selectedEmployee', '', {
        storage: 'sessionStorage',
    });
    const [selectedRoleForReassign, setSelectedRoleForReassign] = usePersistedState<string>('reassignLeadsReport_selectedRole', 'handler', {
        storage: 'sessionStorage',
    });
    const [reassigning, setReassigning] = useState(false);
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

    // Helper function to calculate contrasting text color based on background
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

    // Get filtered employees with their roles
    const getFilteredEmployees = () => {
        const filtered: Array<{ employee: any; role: string; roleLabel: string }> = [];

        if (reassignFilters.meetingScheduler) {
            const emp = employees.find(e => e.display_name === reassignFilters.meetingScheduler);
            if (emp) filtered.push({ employee: emp, role: 'meetingScheduler', roleLabel: 'Scheduler' });
        }
        if (reassignFilters.closer) {
            const emp = employees.find(e => e.display_name === reassignFilters.closer);
            if (emp) filtered.push({ employee: emp, role: 'closer', roleLabel: 'Closer' });
        }
        if (reassignFilters.meetingManager) {
            const emp = employees.find(e => e.display_name === reassignFilters.meetingManager);
            if (emp) filtered.push({ employee: emp, role: 'meetingManager', roleLabel: 'Meeting Manager' });
        }
        if (reassignFilters.handler) {
            const emp = employees.find(e => e.display_name === reassignFilters.handler);
            if (emp) filtered.push({ employee: emp, role: 'handler', roleLabel: 'Handler' });
        }
        if (reassignFilters.helper) {
            const emp = employees.find(e => e.display_name === reassignFilters.helper);
            if (emp) filtered.push({ employee: emp, role: 'helper', roleLabel: 'Helper' });
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
        };

        if (showMeetingSchedulerDropdown || showCloserDropdown || showMeetingManagerDropdown || showHandlerDropdown || showHelperDropdown || showAssignEmployeeDropdown || showLeadSearchDropdown || showReassignCategoryDropdown || showReassignSourceDropdown || showReassignStageDropdown || showLanguageDropdown || showStatusDropdown || showRoleDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showMeetingSchedulerDropdown, selectedMeetingScheduler, showCloserDropdown, selectedCloser, showMeetingManagerDropdown, selectedMeetingManager, showHandlerDropdown, selectedHandler, showHelperDropdown, selectedHelper, showAssignEmployeeDropdown, selectedEmployeeForReassign, showLeadSearchDropdown, showReassignCategoryDropdown, showReassignSourceDropdown, showReassignStageDropdown, showLanguageDropdown, showStatusDropdown, showRoleDropdown]);

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
                leadsQuery = leadsQuery.ilike('scheduler', `%${reassignFilters.meetingScheduler}%`);
            }
            if (reassignFilters.closer) {
                leadsQuery = leadsQuery.ilike('closer', `%${reassignFilters.closer}%`);
            }
            if (reassignFilters.meetingManager) {
                // For new leads, manager field stores employee name as text
                leadsQuery = leadsQuery.ilike('manager', `%${reassignFilters.meetingManager}%`);
            }
            if (reassignFilters.handler) {
                // For new leads, handler field stores employee name as text
                leadsQuery = leadsQuery.ilike('handler', `%${reassignFilters.handler}%`);
            }
            if (reassignFilters.helper) {
                // For new leads, helper field stores employee name as text
                leadsQuery = leadsQuery.ilike('helper', `%${reassignFilters.helper}%`);
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
                const employee = employees.find(emp => emp.display_name === reassignFilters.meetingScheduler);
                if (employee) {
                    legacyLeadsQuery = legacyLeadsQuery.eq('meeting_scheduler_id', employee.id);
                }
            }
            if (reassignFilters.closer) {
                const employee = employees.find(emp => emp.display_name === reassignFilters.closer);
                if (employee) {
                    legacyLeadsQuery = legacyLeadsQuery.eq('closer_id', employee.id);
                }
            }
            if (reassignFilters.meetingManager) {
                const employee = employees.find(emp => emp.display_name === reassignFilters.meetingManager);
                if (employee) {
                    legacyLeadsQuery = legacyLeadsQuery.eq('meeting_manager_id', employee.id);
                }
            }
            if (reassignFilters.handler) {
                const employee = employees.find(emp => emp.display_name === reassignFilters.handler);
                if (employee) {
                    legacyLeadsQuery = legacyLeadsQuery.eq('case_handler_id', employee.id);
                }
            }
            if (reassignFilters.helper) {
                const employee = employees.find(emp => emp.display_name === reassignFilters.helper);
                if (employee) {
                    legacyLeadsQuery = legacyLeadsQuery.eq('meeting_lawyer_id', employee.id);
                }
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
                    if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---') {
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
                    const handlerEmployee = lead.handler ? handlerEmployeeMap.get(lead.handler) : null;

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

    // Re-assign leads function
    const handleReassignLeads = async () => {
        if (selectedLeads.size === 0) {
            toast.error('Please select at least one lead to reassign.');
            return;
        }

        if (!selectedEmployeeForReassign || !selectedRoleForReassign) {
            toast.error('Please select an employee to assign leads to.');
            return;
        }

        const roleLabels: { [key: string]: string } = {
            scheduler: 'Scheduler',
            closer: 'Closer',
            meetingManager: 'Meeting Manager',
            handler: 'Handler',
            helper: 'Helper'
        };

        const confirmReassign = confirm(`Are you sure you want to re-assign ${selectedLeads.size} selected lead(s) to ${selectedEmployeeForReassign} as ${roleLabels[selectedRoleForReassign]}?`);
        if (!confirmReassign) return;

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
            }

            if (legacyLeads.length > 0) {
                const legacyLeadIds = legacyLeads.map(lead => lead.id);
                const { error: legacyLeadsError } = await supabase
                    .from('leads_lead')
                    .update(legacyUpdateFields)
                    .in('id', legacyLeadIds);

                if (legacyLeadsError) throw legacyLeadsError;
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

            toast.success(`Successfully re-assigned ${selectedLeads.size} lead(s) to ${selectedEmployeeForReassign} as ${roleLabels[selectedRoleForReassign]}!`);

            // Remove reassigned leads from results and clear selection
            setReassignResults(prev => prev.filter(lead => !selectedLeads.has(lead.id?.toString() || '')));
            setSelectedLeads(new Set());
            setSelectedEmployeeForReassign('');
            setAssignEmployeeSearchTerm('');

        } catch (error) {
            console.error('Error re-assigning leads:', error);
            toast.error('Failed to re-assign leads. Please try again.');
        } finally {
            setReassigning(false);
        }
    };

    const filteredEmployees = getFilteredEmployees();

    // Helper function to determine which role is currently filtered
    const getActiveRoleFilter = (): string | null => {
        if (reassignFilters.meetingScheduler) return 'scheduler';
        if (reassignFilters.closer) return 'closer';
        if (reassignFilters.meetingManager) return 'meetingManager';
        if (reassignFilters.handler) return 'handler';
        if (reassignFilters.helper) return 'helper';
        return null;
    };

    const activeRoleFilter = getActiveRoleFilter();

    // Auto-set selectedRoleForReassign when a role filter is active
    useEffect(() => {
        if (activeRoleFilter) {
            setSelectedRoleForReassign(activeRoleFilter);
        }
    }, [activeRoleFilter]);

    return (
        <div ref={scrollContainerRef} className="p-4 md:p-6">
            <div className="mb-6">
            </div>

            {/* Filters Section - Two Column Layout */}
            {showFilters && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    {/* Left Side - General Filters */}
                    <div className="lg:col-span-2">
                        <h3 className="text-lg font-semibold mb-4 text-base-content/80 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            General Filters
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Date Range */}
                            <div className="grid grid-cols-2 gap-4 md:col-span-2">
                                <div>
                                    <label className="block text-sm font-medium mb-2">From date:</label>
                                    <input
                                        type="date"
                                        className="input input-bordered w-full"
                                        value={reassignFilters.fromDate}
                                        onChange={(e) => setReassignFilters(prev => ({ ...prev, fromDate: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">To date:</label>
                                    <input
                                        type="date"
                                        className="input input-bordered w-full"
                                        value={reassignFilters.toDate}
                                        onChange={(e) => setReassignFilters(prev => ({ ...prev, toDate: e.target.value }))}
                                    />
                                </div>
                            </div>

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
                                                                    {lead.isLegacy ? 'Legacy' : 'New'} Lead #{lead.lead_number || lead.id}
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
                    <div className="lg:col-span-1">
                        <div className="sticky top-6">
                            <h3 className="text-lg font-semibold mb-4 text-base-content/80 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                                Role Filters
                            </h3>
                            {activeRoleFilter && (
                                <p className="text-xs text-base-content/60 mb-4 p-2 bg-info/10 rounded-md border border-info/20">
                                    Only one role filter can be active at a time. Clear the current filter to select a different role.
                                </p>
                            )}

                            {/* Employee Filter Indicators - At Top */}
                            {filteredEmployees.length > 0 && (
                                <div className="mb-6 pb-6 border-b border-base-300">
                                    <h4 className="text-sm font-semibold mb-3 text-base-content/70">Filtered by:</h4>
                                    <div className="space-y-3">
                                        {filteredEmployees.map(({ employee, role, roleLabel }, index) => (
                                            <div
                                                key={`${employee.id}-${role}-${index}`}
                                                className="flex items-center gap-3 p-3 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20 hover:shadow-md transition-all"
                                            >
                                                {employee.photo_url ? (
                                                    <img
                                                        src={employee.photo_url}
                                                        alt={employee.display_name}
                                                        className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/30"
                                                        onError={(e) => {
                                                            const target = e.target as HTMLImageElement;
                                                            target.style.display = 'none';
                                                            const parent = target.parentElement;
                                                            if (parent) {
                                                                const fallback = document.createElement('div');
                                                                fallback.className = 'w-12 h-12 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-sm ring-2 ring-primary/30';
                                                                fallback.textContent = getInitials(employee.display_name);
                                                                parent.appendChild(fallback);
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-12 h-12 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-sm ring-2 ring-primary/30">
                                                        {getInitials(employee.display_name)}
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm text-base-content truncate">
                                                        {employee.display_name}
                                                    </div>
                                                    <div className="text-xs text-base-content/60">
                                                        {roleLabel}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        // Clear the filter for this role
                                                        if (role === 'meetingScheduler') {
                                                            setReassignFilters(prev => ({ ...prev, meetingScheduler: '' }));
                                                            setSelectedMeetingScheduler('');
                                                            setMeetingSchedulerSearchTerm('- ALL -');
                                                        } else if (role === 'closer') {
                                                            setReassignFilters(prev => ({ ...prev, closer: '' }));
                                                            setSelectedCloser('');
                                                            setCloserSearchTerm('- ALL -');
                                                        } else if (role === 'meetingManager') {
                                                            setReassignFilters(prev => ({ ...prev, meetingManager: '' }));
                                                            setSelectedMeetingManager('');
                                                            setMeetingManagerSearchTerm('- ALL -');
                                                        } else if (role === 'handler') {
                                                            setReassignFilters(prev => ({ ...prev, handler: '' }));
                                                            setSelectedHandler('');
                                                            setHandlerSearchTerm('- ALL -');
                                                        } else if (role === 'helper') {
                                                            setReassignFilters(prev => ({ ...prev, helper: '' }));
                                                            setSelectedHelper('');
                                                            setHelperSearchTerm('- ALL -');
                                                        }
                                                    }}
                                                    className="btn btn-ghost btn-xs text-error hover:bg-error/10"
                                                    title="Remove filter"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-4">
                                {/* Meeting Scheduler */}
                                <div>
                                    <label className="block text-sm font-medium mb-2">Meeting scheduler:</label>
                                    <div className="relative meeting-scheduler-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className="input input-bordered w-full"
                                            value={meetingSchedulerSearchTerm}
                                            onChange={(e) => {
                                                setMeetingSchedulerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, meetingScheduler: e.target.value }));
                                            }}
                                            onFocus={() => {
                                                if (!activeRoleFilter || activeRoleFilter === 'scheduler') {
                                                    setShowMeetingSchedulerDropdown(true);
                                                }
                                            }}
                                            disabled={activeRoleFilter !== null && activeRoleFilter !== 'scheduler'}
                                        />
                                        {showMeetingSchedulerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    <button
                                                        className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedMeetingScheduler('');
                                                            setMeetingSchedulerSearchTerm('- ALL -');
                                                            setReassignFilters(prev => ({ ...prev, meetingScheduler: '' }));
                                                            setShowMeetingSchedulerDropdown(false);
                                                        }}
                                                    >
                                                        - ALL -
                                                    </button>
                                                    {employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(meetingSchedulerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <button
                                                                key={emp.id}
                                                                className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedMeetingScheduler(emp.display_name);
                                                                    setMeetingSchedulerSearchTerm(emp.display_name);
                                                                    setReassignFilters(prev => ({ ...prev, meetingScheduler: emp.display_name }));
                                                                    setShowMeetingSchedulerDropdown(false);
                                                                }}
                                                            >
                                                                {emp.display_name}
                                                            </button>
                                                        ))}
                                                    {employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(meetingSchedulerSearchTerm.toLowerCase())
                                                    ).length === 0 && meetingSchedulerSearchTerm !== '- ALL -' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Closer:</label>
                                    <div className="relative closer-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className="input input-bordered w-full"
                                            value={closerSearchTerm}
                                            onChange={(e) => {
                                                setCloserSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, closer: e.target.value }));
                                            }}
                                            onFocus={() => {
                                                if (!activeRoleFilter || activeRoleFilter === 'closer') {
                                                    setShowCloserDropdown(true);
                                                }
                                            }}
                                            disabled={activeRoleFilter !== null && activeRoleFilter !== 'closer'}
                                        />
                                        {showCloserDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    <button
                                                        className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedCloser('');
                                                            setCloserSearchTerm('- ALL -');
                                                            setReassignFilters(prev => ({ ...prev, closer: '' }));
                                                            setShowCloserDropdown(false);
                                                        }}
                                                    >
                                                        - ALL -
                                                    </button>
                                                    {employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(closerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <button
                                                                key={emp.id}
                                                                className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedCloser(emp.display_name);
                                                                    setCloserSearchTerm(emp.display_name);
                                                                    setReassignFilters(prev => ({ ...prev, closer: emp.display_name }));
                                                                    setShowCloserDropdown(false);
                                                                }}
                                                            >
                                                                {emp.display_name}
                                                            </button>
                                                        ))}
                                                    {employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(closerSearchTerm.toLowerCase())
                                                    ).length === 0 && closerSearchTerm !== '- ALL -' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Meeting Manager:</label>
                                    <div className="relative meeting-manager-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className="input input-bordered w-full"
                                            value={meetingManagerSearchTerm}
                                            onChange={(e) => {
                                                setMeetingManagerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, meetingManager: e.target.value }));
                                            }}
                                            onFocus={() => {
                                                if (!activeRoleFilter || activeRoleFilter === 'meetingManager') {
                                                    setShowMeetingManagerDropdown(true);
                                                }
                                            }}
                                            disabled={activeRoleFilter !== null && activeRoleFilter !== 'meetingManager'}
                                        />
                                        {showMeetingManagerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    <button
                                                        className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedMeetingManager('');
                                                            setMeetingManagerSearchTerm('- ALL -');
                                                            setReassignFilters(prev => ({ ...prev, meetingManager: '' }));
                                                            setShowMeetingManagerDropdown(false);
                                                        }}
                                                    >
                                                        - ALL -
                                                    </button>
                                                    {employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(meetingManagerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <button
                                                                key={emp.id}
                                                                className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedMeetingManager(emp.display_name);
                                                                    setMeetingManagerSearchTerm(emp.display_name);
                                                                    setReassignFilters(prev => ({ ...prev, meetingManager: emp.display_name }));
                                                                    setShowMeetingManagerDropdown(false);
                                                                }}
                                                            >
                                                                {emp.display_name}
                                                            </button>
                                                        ))}
                                                    {employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(meetingManagerSearchTerm.toLowerCase())
                                                    ).length === 0 && meetingManagerSearchTerm !== '- ALL -' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Handler */}
                                <div>
                                    <label className="block text-sm font-medium mb-2">Handler:</label>
                                    <div className="relative handler-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className="input input-bordered w-full"
                                            value={handlerSearchTerm}
                                            onChange={(e) => {
                                                setHandlerSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, handler: e.target.value }));
                                            }}
                                            onFocus={() => {
                                                if (!activeRoleFilter || activeRoleFilter === 'handler') {
                                                    setShowHandlerDropdown(true);
                                                }
                                            }}
                                            disabled={activeRoleFilter !== null && activeRoleFilter !== 'handler'}
                                        />
                                        {showHandlerDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    <button
                                                        className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedHandler('');
                                                            setHandlerSearchTerm('- ALL -');
                                                            setReassignFilters(prev => ({ ...prev, handler: '' }));
                                                            setShowHandlerDropdown(false);
                                                        }}
                                                    >
                                                        - ALL -
                                                    </button>
                                                    {employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(handlerSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <button
                                                                key={emp.id}
                                                                className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedHandler(emp.display_name);
                                                                    setHandlerSearchTerm(emp.display_name);
                                                                    setReassignFilters(prev => ({ ...prev, handler: emp.display_name }));
                                                                    setShowHandlerDropdown(false);
                                                                }}
                                                            >
                                                                {emp.display_name}
                                                            </button>
                                                        ))}
                                                    {employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(handlerSearchTerm.toLowerCase())
                                                    ).length === 0 && handlerSearchTerm !== '- ALL -' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Helper (lawyer) */}
                                <div>
                                    <label className="block text-sm font-medium mb-2">Helper (lawyer):</label>
                                    <div className="relative helper-dropdown-container">
                                        <input
                                            type="text"
                                            placeholder="Search employee..."
                                            className="input input-bordered w-full"
                                            value={helperSearchTerm}
                                            onChange={(e) => {
                                                setHelperSearchTerm(e.target.value);
                                                setReassignFilters(prev => ({ ...prev, helper: e.target.value }));
                                            }}
                                            onFocus={() => {
                                                if (!activeRoleFilter || activeRoleFilter === 'helper') {
                                                    setShowHelperDropdown(true);
                                                }
                                            }}
                                            disabled={activeRoleFilter !== null && activeRoleFilter !== 'helper'}
                                        />
                                        {showHelperDropdown && (
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-lg shadow-lg w-full max-h-80 overflow-y-auto">
                                                <div className="p-2">
                                                    <button
                                                        className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedHelper('');
                                                            setHelperSearchTerm('- ALL -');
                                                            setReassignFilters(prev => ({ ...prev, helper: '' }));
                                                            setShowHelperDropdown(false);
                                                        }}
                                                    >
                                                        - ALL -
                                                    </button>
                                                    {employees
                                                        .filter(emp =>
                                                            emp.display_name.toLowerCase().includes(helperSearchTerm.toLowerCase())
                                                        )
                                                        .map((emp) => (
                                                            <button
                                                                key={emp.id}
                                                                className="w-full text-left px-3 py-2 hover:bg-base-200 rounded-md transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedHelper(emp.display_name);
                                                                    setHelperSearchTerm(emp.display_name);
                                                                    setReassignFilters(prev => ({ ...prev, helper: emp.display_name }));
                                                                    setShowHelperDropdown(false);
                                                                }}
                                                            >
                                                                {emp.display_name}
                                                            </button>
                                                        ))}
                                                    {employees.filter(emp =>
                                                        emp.display_name.toLowerCase().includes(helperSearchTerm.toLowerCase())
                                                    ).length === 0 && helperSearchTerm !== '- ALL -' && (
                                                            <div className="px-3 py-2 text-sm text-base-content/60">
                                                                No employees found
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Search Button */}
            {showFilters && (
                <div className="flex justify-end mb-6">
                    <button
                        className="btn btn-primary"
                        onClick={handleReassignSearch}
                        disabled={reassignLoading}
                    >
                        {reassignLoading ? (
                            <>
                                <span className="loading loading-spinner loading-sm"></span>
                                Searching...
                            </>
                        ) : (
                            'Search'
                        )}
                    </button>
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
                    onRemoveFilter={(role) => {
                        if (role === 'meetingScheduler') {
                            setReassignFilters(prev => ({ ...prev, meetingScheduler: '' }));
                            setSelectedMeetingScheduler('');
                            setMeetingSchedulerSearchTerm('- ALL -');
                        } else if (role === 'closer') {
                            setReassignFilters(prev => ({ ...prev, closer: '' }));
                            setSelectedCloser('');
                            setCloserSearchTerm('- ALL -');
                        } else if (role === 'meetingManager') {
                            setReassignFilters(prev => ({ ...prev, meetingManager: '' }));
                            setSelectedMeetingManager('');
                            setMeetingManagerSearchTerm('- ALL -');
                        } else if (role === 'handler') {
                            setReassignFilters(prev => ({ ...prev, handler: '' }));
                            setSelectedHandler('');
                            setHandlerSearchTerm('- ALL -');
                        } else if (role === 'helper') {
                            setReassignFilters(prev => ({ ...prev, helper: '' }));
                            setSelectedHelper('');
                            setHelperSearchTerm('- ALL -');
                        }
                    }}
                    onSearch={handleReassignSearch}
                    isLoading={reassignLoading}
                    onShowFilters={() => {
                        setShowFilters(true);
                        setShowFloatingBar(false);
                    }}
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
                    activeRoleFilter={activeRoleFilter}
                    showRoleDropdown={showRoleDropdown}
                    setShowRoleDropdown={setShowRoleDropdown}
                />
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
                            <div className="flex gap-2">
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
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                            {reassignResults.map((lead) => {
                                const leadId = lead.id?.toString() || '';
                                const isSelected = selectedLeads.has(leadId);
                                // Get stage badge with color
                                const getStageBadge = (stage: string | number | null | undefined) => {
                                    if (!stage && stage !== 0) return <span className="badge badge-outline">No Stage</span>;

                                    const stageStr = String(stage);
                                    const stageName = getStageName(stageStr);
                                    const stageColour = getStageColour(stageStr);
                                    const badgeTextColour = getContrastingTextColor(stageColour);
                                    const backgroundColor = stageColour || '#3f28cd';
                                    const textColor = stageColour ? badgeTextColour : '#ffffff';

                                    return (
                                        <span
                                            className="badge stage-badge hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
                                            style={{
                                                backgroundColor: backgroundColor,
                                                borderColor: backgroundColor,
                                                color: textColor,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                display: 'inline-block'
                                            }}
                                            title={stageName}
                                        >
                                            {stageName}
                                        </span>
                                    );
                                };

                                const anyLead = lead as any;
                                const displayCategory = anyLead.category || 'N/A';
                                const displaySource = anyLead.source || 'N/A';
                                const displayLanguage = anyLead.language || 'N/A';

                                // Get balance and applicants (always show, not just when filtered by handler)
                                const balance = getLeadBalance(lead);
                                const applicants = getLeadApplicants(lead);

                                // Get handler employee info
                                const handlerEmployee = anyLead.handlerEmployee;

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
                                                <div className="flex-1 flex justify-between items-start">
                                                    <div className="flex items-center gap-2">
                                                        <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                                                            {lead.name || 'No Name'}
                                                        </h2>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        {getStageBadge(lead.stage)}
                                                        {/* Handler Display - Right Side */}
                                                        {handlerEmployee && (
                                                            <div className="flex items-center gap-2">
                                                                {handlerEmployee.photo_url ? (
                                                                    <img
                                                                        src={handlerEmployee.photo_url}
                                                                        alt={handlerEmployee.display_name}
                                                                        className="w-8 h-8 rounded-full object-cover ring-2 ring-primary/30"
                                                                        onError={(e) => {
                                                                            const target = e.target as HTMLImageElement;
                                                                            target.style.display = 'none';
                                                                            const parent = target.parentElement;
                                                                            if (parent) {
                                                                                const fallback = document.createElement('div');
                                                                                fallback.className = 'w-8 h-8 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-sm ring-2 ring-primary/30';
                                                                                fallback.textContent = getInitials(handlerEmployee.display_name);
                                                                                parent.appendChild(fallback);
                                                                            }
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-primary text-primary-content font-bold text-sm ring-2 ring-primary/30">
                                                                        {getInitials(handlerEmployee.display_name)}
                                                                    </div>
                                                                )}
                                                                <span className="text-base font-semibold text-base-content">
                                                                    {handlerEmployee.display_name}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <p className="text-sm text-base-content/60 font-mono mb-4">
                                                #{(lead as any).display_lead_number || lead.lead_number || lead.id || 'Unknown Lead'}
                                            </p>

                                            <div className="divider my-0"></div>

                                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                                                <div className="flex items-center gap-2" title="Date Created">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                    <span className="font-medium">
                                                        {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : 'Unknown'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2" title="Category">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                    <span>{displayCategory}</span>
                                                </div>
                                                <div className="flex items-center gap-2" title="Source">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                    </svg>
                                                    <span>{displaySource}</span>
                                                </div>
                                                <div className="flex items-center gap-2" title="Language">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                                    </svg>
                                                    <span>{displayLanguage}</span>
                                                </div>

                                                {/* Total Value */}
                                                <div className="flex items-center gap-2" title="Total Value">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <span className="font-medium">
                                                        {balance && balance.value && balance.value > 0
                                                            ? `${balance.currency}${balance.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                                            : 'N/A'}
                                                    </span>
                                                </div>

                                                {/* Total Applicants */}
                                                <div className="flex items-center gap-2" title="Total Applicants">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                                    </svg>
                                                    <span className="font-medium">
                                                        {applicants && applicants > 0 ? applicants : 'N/A'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {reassignResults.length === 0 && !reassignLoading && (
                <div className="text-center py-8 text-base-content/60">
                    No results found. Try adjusting your filters and search again.
                </div>
            )}
        </div>
    );
};

export default ReassignLeadsReport;
