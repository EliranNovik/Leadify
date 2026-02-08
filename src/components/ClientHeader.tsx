import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    UserIcon,
    EnvelopeIcon,
    PhoneIcon,
    TagIcon,
    GlobeAltIcon,
    CurrencyDollarIcon,
    CalendarDaysIcon,
    ChartBarIcon,
    CheckCircleIcon,
    ExclamationTriangleIcon,
    DocumentDuplicateIcon,
    ArrowRightIcon,
    PencilIcon,
    ChevronDownIcon,
    PlayIcon,
    DocumentCheckIcon,
    NoSymbolIcon,
    StarIcon,
    PencilSquareIcon,
    Squares2X2Icon,
    TrashIcon,
    ArrowPathIcon,
    ChatBubbleLeftRightIcon,
    HandThumbUpIcon,
    HandThumbDownIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { getStageName, getStageColour, areStagesEquivalent } from '../lib/stageUtils';
import { addToHighlights, removeFromHighlights } from '../lib/highlightsUtils';
import { getUnactivationReasonFromId } from '../lib/unactivationReasons';
import CallOptionsModal from './CallOptionsModal';

// Helper to get contrasting text color
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
    return luminance > 0.55 ? '#111827' : '#ffffff';
};

interface ClientHeaderProps {
    selectedClient: any;
    refreshClientData: (clientId: number | string) => Promise<void>;
    isSubLead?: boolean;
    masterLeadNumber?: string | null;
    isMasterLead?: boolean;
    subLeadsCount?: number;
    nextDuePayment?: any;
    setIsBalanceModalOpen: (isOpen: boolean) => void;
    currentStageName: string;
    handleStartCase: () => void;
    updateLeadStage: (newStage: string) => Promise<void>;
    isInHighlightsState: boolean;
    isSuperuser: boolean;
    setShowDeleteModal: (show: boolean) => void;
    duplicateContacts: any[];
    setIsDuplicateModalOpen: (isOpen: boolean) => void;
    setIsDuplicateDropdownOpen: (isOpen: boolean) => void;
    isDuplicateDropdownOpen: boolean;
    setShowSubLeadDrawer: (show: boolean) => void;
    openEditLeadDrawer: () => void;
    handleActivation: () => void;
    setShowUnactivationModal: (show: boolean) => void;
    renderStageBadge: (anchor?: 'badge' | 'mobile' | 'desktop') => React.ReactNode;
    getEmployeeDisplayName: (id: string | null | undefined) => string;
    allEmployees?: any[];
    dropdownsContent?: React.ReactNode;
    dropdownItems?: React.ReactNode;
    // Additional handlers for stage actions
    handlePaymentReceivedNewClient?: () => void;
    handleScheduleMenuClick?: () => void;
    handleStageUpdate?: (newStage: string) => Promise<void>;
    openSendOfferModal?: () => void;
    handleOpenSignedDrawer?: () => void;
    handleOpenDeclinedDrawer?: () => void;
    setShowRescheduleDrawer?: (show: boolean) => void;
    scheduleMenuLabel?: string;
    hasScheduledMeetings?: boolean;
    isStageNumeric?: boolean;
    stageNumeric?: number;
}

const ClientHeader: React.FC<ClientHeaderProps> = ({
    selectedClient,
    refreshClientData,
    isSubLead,
    masterLeadNumber,
    isMasterLead,
    subLeadsCount,
    nextDuePayment,
    setIsBalanceModalOpen,
    currentStageName,
    handleStartCase,
    updateLeadStage,
    isInHighlightsState,
    isSuperuser,
    setShowDeleteModal,
    duplicateContacts,
    setIsDuplicateModalOpen,
    setIsDuplicateDropdownOpen,
    isDuplicateDropdownOpen,
    setShowSubLeadDrawer,
    openEditLeadDrawer,
    handleActivation,
    setShowUnactivationModal,
    renderStageBadge,
    getEmployeeDisplayName,
    allEmployees = [],
    dropdownsContent,
    dropdownItems,
    handlePaymentReceivedNewClient,
    handleScheduleMenuClick,
    handleStageUpdate,
    openSendOfferModal,
    handleOpenSignedDrawer,
    handleOpenDeclinedDrawer,
    setShowRescheduleDrawer,
    scheduleMenuLabel,
    hasScheduledMeetings,
    isStageNumeric,
    stageNumeric,
}) => {
    const navigate = useNavigate();
    const [isEditingCategory, setIsEditingCategory] = useState(false);

    // Helper function to get employee by ID (matching CalendarPage logic)
    const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
        if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
            return null;
        }

        // First, try to match by ID (for legacy leads and new leads with ID fields)
        const employeeById = allEmployees.find((emp: any) => {
            const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
            const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

            // Skip if searchId is NaN (not a valid number)
            if (isNaN(Number(searchId))) return false;

            // Try exact match
            if (empId.toString() === searchId.toString()) return true;
            if (Number(empId) === Number(searchId)) return true;

            return false;
        });

        if (employeeById) {
            return employeeById;
        }

        // If not found by ID, try to match by display name (for new leads where display_name is saved)
        if (typeof employeeIdOrName === 'string') {
            const employeeByName = allEmployees.find((emp: any) => {
                if (!emp.display_name) return false;
                // Case-insensitive match, trim whitespace
                return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
            });

            if (employeeByName) {
                return employeeByName;
            }
        }

        return null;
    };

    // Helper function to get employee initials
    const getEmployeeInitials = (name: string | null | undefined): string => {
        if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    // Helper function to format role display value
    const formatRoleDisplay = (value: string | number | null | undefined): string => {
        // Convert to string first to handle numbers and other types
        const stringValue = value != null ? String(value) : '';

        if (!stringValue || stringValue === '---' || stringValue === '--' || stringValue === 'Not assigned' || stringValue === 'Unassigned' || stringValue.trim() === '') {
            return '---';
        }
        return stringValue;
    };

    // Component to render employee avatar (matching CalendarPage logic)
    const EmployeeAvatar: React.FC<{
        employeeId: string | number | null | undefined;
        size?: 'sm' | 'md' | 'lg';
    }> = ({ employeeId, size = 'md' }) => {
        const [imageError, setImageError] = useState(false);
        const employee = getEmployeeById(employeeId);
        const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

        if (!employee) {
            return null;
        }

        const photoUrl = employee.photo_url || employee.photo;
        const initials = getEmployeeInitials(employee.display_name);

        // If we know there's no photo URL or we have an error, show initials immediately
        if (imageError || !photoUrl) {
            return (
                <div
                    className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
                    onClick={() => {
                        if (employee.id) {
                            navigate(`/my-profile/${employee.id}`);
                        }
                    }}
                    title={`View ${employee.display_name}'s profile`}
                >
                    {initials}
                </div>
            );
        }

        // Try to render image
        return (
            <img
                src={photoUrl}
                alt={employee.display_name}
                className={`${sizeClasses} rounded-full object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
                onClick={() => {
                    if (employee.id) {
                        navigate(`/my-profile/${employee.id}`);
                    }
                }}
                onError={() => setImageError(true)}
                title={`View ${employee.display_name}'s profile`}
            />
        );
    };
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [categoryInputValue, setCategoryInputValue] = useState(selectedClient?.category || '');
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [allCategories, setAllCategories] = useState<any[]>([]);
    const [isLoadingCategories, setIsLoadingCategories] = useState(false);
    const [allSources, setAllSources] = useState<Array<{ id: number | string, name: string }>>([]);
    const [showStageDropdown, setShowStageDropdown] = useState(false);
    const [isCallModalOpen, setIsCallModalOpen] = useState(false);
    const [callPhoneNumber, setCallPhoneNumber] = useState('');
    const [callContactName, setCallContactName] = useState('');

    // Persisted contact info state (ported from ClientInformationBox)
    const [legacyContactInfo, setLegacyContactInfo] = useState<{ email: string | null, phone: string | null }>({
        email: null,
        phone: null
    });

    // Fetch sources from misc_leadsource table
    useEffect(() => {
        const fetchSources = async () => {
            try {
                const { data, error } = await supabase
                    .from('misc_leadsource')
                    .select('id, name')
                    .eq('active', true)
                    .order('order', { ascending: true, nullsFirst: false });

                if (error) throw error;
                setAllSources(data || []);
            } catch (error) {
                console.error('Error fetching sources:', error);
            }
        };

        fetchSources();
    }, []);

    // Fetch categories
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                setIsLoadingCategories(true);
                const { data, error } = await supabase
                    .from('misc_category')
                    .select(`
            id,
            name,
            misc_maincategory ( id, name )
          `)
                    .order('name');

                if (error) throw error;
                setAllCategories(data || []);
            } catch (error) {
                console.error('Error fetching categories:', error);
            } finally {
                setIsLoadingCategories(false);
            }
        };
        fetchCategories();
    }, []);

    // Fetch legacy contact info
    useEffect(() => {
        const fetchLegacyContactInfo = async () => {
            if (!selectedClient) return;
            const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');

            if (isLegacyLead) {
                const legacyId = selectedClient.id.toString().replace('legacy_', '');
                try {
                    const persistedContactKey = `clientsPage_contactData_${legacyId}`;
                    const persistedContactData = sessionStorage.getItem(persistedContactKey);
                    if (persistedContactData) {
                        setLegacyContactInfo(JSON.parse(persistedContactData));
                        return;
                    }
                } catch (error) { console.error(error); }

                try {
                    const { data: leadContacts } = await supabase
                        .from('lead_leadcontact')
                        .select(`main, contact_id`)
                        .eq('lead_id', legacyId)
                        .eq('main', 'true');

                    if (leadContacts && leadContacts.length > 0) {
                        const mainContactId = leadContacts[0].contact_id;
                        const { data: contactData } = await supabase
                            .from('leads_contact')
                            .select('email, phone')
                            .eq('id', mainContactId)
                            .single();

                        if (contactData) {
                            setLegacyContactInfo(contactData);
                            try {
                                sessionStorage.setItem(`clientsPage_contactData_${legacyId}`, JSON.stringify(contactData));
                            } catch (e) { }
                        }
                    }
                } catch (error) { console.error(error); }
            }
        };
        fetchLegacyContactInfo();
    }, [selectedClient]);

    // Handle category save
    const handleSaveCategory = async () => {
        if (!selectedClient || !categoryInputValue.trim()) return;
        try {
            const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
            const tableName = isLegacyLead ? 'leads_lead' : 'leads';
            const idField = 'id';
            const clientId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

            const foundCategory = allCategories.find((cat: any) => {
                const expectedFormat = cat.misc_maincategory?.name
                    ? `${cat.name} (${cat.misc_maincategory.name})`
                    : cat.name;
                return expectedFormat.toLowerCase().includes(categoryInputValue.toLowerCase()) ||
                    cat.name.toLowerCase().includes(categoryInputValue.toLowerCase());
            });

            if (!foundCategory) {
                toast.error('Category not found. Please select from the dropdown.');
                return;
            }

            const { error } = await supabase
                .from(tableName)
                .update({
                    category_id: foundCategory.id,
                    category: foundCategory.name,
                    category_last_edited_by: 'System User', // Simplified for now
                    category_last_edited_at: new Date().toISOString(),
                })
                .eq(idField, clientId);

            if (error) throw error;
            toast.success('Category updated');
            setIsEditingCategory(false);
            setShowCategoryDropdown(false);
            if (refreshClientData) await refreshClientData(selectedClient.id);
        } catch (error) {
            console.error(error);
            toast.error('Failed to update category');
        }
    };

    const displayEmail = legacyContactInfo.email || selectedClient?.email;
    const displayPhone = legacyContactInfo.phone || selectedClient?.phone;

    // Helper function to get category display name with main category
    const getCategoryDisplayName = (categoryId: number | string | null | undefined, fallbackCategory?: string): string => {
        if (!categoryId) {
            return fallbackCategory || 'No Category';
        }

        const category = allCategories.find((cat: any) => {
            const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
            const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
            return catId === searchId || Number(catId) === Number(searchId);
        });

        if (category) {
            if (category.misc_maincategory?.name) {
                return `${category.name} (${category.misc_maincategory.name})`;
            } else {
                return category.name;
            }
        }

        return fallbackCategory || 'No Category';
    };

    // Get the full category display name (subcategory + main category)
    const displayCategory = getCategoryDisplayName(selectedClient?.category_id, selectedClient?.category);

    const filteredCategories = allCategories.filter((category) => {
        const categoryName = category.misc_maincategory?.name
            ? `${category.name} (${category.misc_maincategory.name})`
            : category.name;
        // Safely handle categoryInputValue being potentially undefined
        return categoryName.toLowerCase().includes((categoryInputValue || '').toLowerCase());
    });


    // --- Render Helpers ---

    // Helper function to get source display name from misc_leadsource
    const getSourceDisplayName = (sourceId: string | number | null | undefined, fallbackSource?: string) => {
        if (!sourceId || sourceId === '---' || sourceId === '' || sourceId === null || sourceId === undefined) {
            return fallbackSource || '';
        }

        // Convert sourceId to string/number for comparison (handle bigint)
        const sourceIdStr = String(sourceId).trim();
        if (sourceIdStr === '' || sourceIdStr === 'null' || sourceIdStr === 'undefined') {
            return fallbackSource || '';
        }

        // Find source in loaded sources - compare as numbers or strings
        const source = allSources.find((src: any) => {
            const srcId = String(src.id).trim();
            const searchId = sourceIdStr;
            return srcId === searchId || Number(srcId) === Number(searchId);
        });

        if (source) {
            return source.name;
        }

        // Fallback to the source name if source_id not found
        return fallbackSource || '';
    };

    // Lead Number
    const renderLeadNumber = () => {
        if (!selectedClient) return '---';
        let displayNumber = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id || '---';
        const displayStr = displayNumber.toString();
        const hasExistingSuffix = displayStr.includes('/');
        let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
        const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

        const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
        if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
            baseNumber = baseNumber.toString().replace(/^L/, 'C');
        }

        const hasNoMasterId = !selectedClient.master_id || String(selectedClient.master_id).trim() === '';
        const isMasterWithSubLeads = hasNoMasterId && (isMasterLead); // Simplified

        if (isMasterWithSubLeads && !hasExistingSuffix) {
            return `${baseNumber}/1`;
        } else if (hasExistingSuffix) {
            return `${baseNumber}/${existingSuffix}`;
        }
        return baseNumber;
    };



    if (!selectedClient) return null;

    return (
        <div className="bg-white dark:bg-gray-900">
            <div className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">

                {/* Top Row: Identity & Status */}
                <div className="flex flex-col gap-4 mb-8">
                    {/* First row: Client name and info */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
                                <UserIcon className="w-8 h-8" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-none">
                                        #{renderLeadNumber()}
                                        <span className="mx-2 text-gray-300">|</span>
                                        {selectedClient.name || 'Unnamed Lead'}
                                    </h1>
                                    {/* Master/Sub Links */}
                                    {isSubLead && masterLeadNumber && (
                                        <span onClick={() => navigate(`/clients/${masterLeadNumber}/master`)} className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold cursor-pointer hover:bg-purple-200">
                                            Master Dashboard
                                        </span>
                                    )}
                                    {isMasterLead && (
                                        <span
                                            onClick={() => {
                                                if (!selectedClient) return;
                                                // Use the same logic as MasterLeadPage and LeadSearchPage
                                                // For legacy leads: use numeric id from leads_lead table
                                                // For new leads: use lead_number or manual_id
                                                const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                                                let identifier: string;
                                                if (isLegacyLead) {
                                                    // Legacy leads: use numeric id (remove 'legacy_' prefix if present)
                                                    identifier = selectedClient.id.toString().replace('legacy_', '');
                                                } else {
                                                    // New leads: use lead_number or manual_id
                                                    identifier = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id?.toString() || '';
                                                }
                                                navigate(`/clients/${encodeURIComponent(identifier)}/master`);
                                            }}
                                            className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold cursor-pointer hover:bg-blue-200 transition-colors"
                                            title={`View all ${subLeadsCount} sub-lead${subLeadsCount !== 1 ? 's' : ''}`}
                                        >
                                            Master Dashboard ({subLeadsCount})
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                                    {selectedClient.language && (
                                        <span className="flex items-center gap-1">
                                            <GlobeAltIcon className="w-4 h-4" />
                                            {selectedClient.language}
                                        </span>
                                    )}
                                    {/* Category Display/Edit */}
                                    <div className="flex items-center gap-1 relative">
                                        <TagIcon className="w-4 h-4" />
                                        <span className="cursor-pointer hover:text-indigo-600 flex items-center gap-1" onClick={() => {
                                            setShowCategoryModal(true);
                                            setCategoryInputValue(displayCategory);
                                        }}>
                                            {displayCategory}
                                            {selectedClient.topic && ` • ${selectedClient.topic}`}
                                            <PencilIcon className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Stage Badge and Actions Dropdown - Top Right */}
                        <div className="flex items-center gap-3">
                            {/* Stage Badge */}
                            <div className="flex items-center gap-2">
                                {renderStageBadge('desktop')}
                            </div>

                            {/* Duplicate Contact Button - Yellow */}
                            {duplicateContacts && duplicateContacts.length > 0 && (
                                <button
                                    onClick={() => setIsDuplicateModalOpen(true)}
                                    className="btn btn-circle btn-warning btn-sm"
                                    title={duplicateContacts.length === 1
                                        ? `Duplicate Contact: ${duplicateContacts[0].contactName} in Lead ${duplicateContacts[0].leadNumber}`
                                        : `${duplicateContacts.length} Duplicate Contacts`}
                                >
                                    <DocumentDuplicateIcon className="w-5 h-5" />
                                </button>
                            )}

                            {/* Actions Dropdown */}
                            <div className="dropdown dropdown-end">
                                <label tabIndex={0} className="btn btn-outline gap-2 bg-white text-gray-700 hover:bg-gray-50 border-gray-200 shadow-sm">
                                    Actions
                                    <ChevronDownIcon className="w-4 h-4" />
                                </label>
                                <ul tabIndex={0} className="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-box w-72 mb-2 border border-base-200 mt-2">
                                    {/* Stage Specific Actions */}
                                    {dropdownItems && (
                                        <>
                                            {dropdownItems}
                                            <div className="divider my-1"></div>
                                        </>
                                    )}

                                    {/* Activation/Spam Toggle */}
                                    {(() => {
                                        const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                                        const isUnactivated = isLegacy ? (selectedClient?.status === 10) : (selectedClient?.status === 'inactive');
                                        return isUnactivated ? (
                                            <li><a className="text-green-600 font-medium" onClick={handleActivation}><CheckCircleIcon className="w-4 h-4" /> Activate Case</a></li>
                                        ) : (
                                            <li><a className="text-red-600 font-medium" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-4 h-4" /> Deactivate / Spam</a></li>
                                        );
                                    })()}

                                    {/* Highlights Toggle */}
                                    <li>
                                        <a onClick={async () => {
                                            if (!selectedClient?.id) return;
                                            const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                                            const leadId = isLegacyLead ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id) : selectedClient.id;
                                            const leadNumber = selectedClient.lead_number || selectedClient.id?.toString();

                                            if (isInHighlightsState) {
                                                await removeFromHighlights(leadId, isLegacyLead);
                                            } else {
                                                await addToHighlights(leadId, leadNumber, isLegacyLead);
                                            }
                                            (document.activeElement as HTMLElement | null)?.blur();
                                        }}>
                                            {isInHighlightsState ? (
                                                <><StarIcon className="w-4 h-4 fill-current text-purple-600" /> Remove from Highlights</>
                                            ) : (
                                                <><StarIcon className="w-4 h-4" /> Add to Highlights</>
                                            )}
                                        </a>
                                    </li>

                                    <div className="divider my-1"></div>

                                    {/* Edit / Sub-Lead */}
                                    <li><a onClick={() => { openEditLeadDrawer(); (document.activeElement as HTMLElement)?.blur(); }}><PencilSquareIcon className="w-4 h-4" /> Edit Details</a></li>
                                    <li><a onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-4 h-4" /> Create Sub-Lead</a></li>

                                    {/* Delete (Superuser only) */}
                                    {isSuperuser && (
                                        <>
                                            <div className="divider my-1"></div>
                                            <li><a className="text-red-600 hover:bg-red-50" onClick={() => { setShowDeleteModal(true); (document.activeElement as HTMLElement)?.blur(); }}><TrashIcon className="w-4 h-4" /> Delete Lead</a></li>
                                        </>
                                    )}
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Second row: Email, Phone, Source (horizontally) and Total Value (centered) */}
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        {/* Email, Phone, Source - Horizontally aligned */}
                        <div className="flex items-center gap-6 flex-wrap">
                            <div className="flex items-center gap-2 group">
                                <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-black">
                                    <EnvelopeIcon className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Email</p>
                                    <p className="text-base font-medium text-gray-900 dark:text-gray-100 truncate" title={displayEmail || ''}>
                                        {displayEmail ? <a href={`mailto:${displayEmail}`} className="hover:text-indigo-600 transition-colors">{displayEmail}</a> : '---'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 group">
                                <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-black">
                                    <PhoneIcon className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Phone</p>
                                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                                        {displayPhone ? (
                                            <button
                                                onClick={() => {
                                                    // Show modal for US (+1), Australia (+61), UK (+44), and South Africa (+27) numbers
                                                    const normalizedPhone = displayPhone.replace(/[\s\-\(\)]/g, '');
                                                    const isSupportedCountry =
                                                        normalizedPhone.startsWith('+1') || (normalizedPhone.startsWith('1') && normalizedPhone.length >= 10) || // US/Canada
                                                        normalizedPhone.startsWith('+61') || (normalizedPhone.startsWith('61') && normalizedPhone.length >= 10) || // Australia
                                                        normalizedPhone.startsWith('+44') || (normalizedPhone.startsWith('44') && normalizedPhone.length >= 10) || // UK
                                                        normalizedPhone.startsWith('+27') || (normalizedPhone.startsWith('27') && normalizedPhone.length >= 10); // South Africa

                                                    if (isSupportedCountry) {
                                                        setCallPhoneNumber(displayPhone);
                                                        setCallContactName(selectedClient?.name || '');
                                                        setIsCallModalOpen(true);
                                                    } else {
                                                        // For other countries, call directly
                                                        window.open(`tel:${displayPhone}`, '_self');
                                                    }
                                                }}
                                                className="hover:text-indigo-600 transition-colors cursor-pointer text-left"
                                            >
                                                {displayPhone}
                                            </button>
                                        ) : '---'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 group">
                                <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-black">
                                    <GlobeAltIcon className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Source</p>
                                    <p className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">
                                        {selectedClient ? getSourceDisplayName(selectedClient.source_id, selectedClient.source) || '---' : '---'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Total Value - Centered */}
                        {(() => {
                            const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');

                            // 1. Currency Resolution
                            let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                            if ((!currency || currency === '₪') && selectedClient?.currency_id && !isLegacyLead) {
                                const currencyId = Number(selectedClient.currency_id);
                                switch (currencyId) {
                                    case 1: currency = '₪'; break;
                                    case 2: currency = '€'; break;
                                    case 3: currency = '$'; break;
                                    case 4: currency = '£'; break;
                                    default: currency = '₪';
                                }
                            }

                            // 2. Base Amount (Gross)
                            let baseAmount: number;
                            if (isLegacyLead) {
                                const currencyId = (selectedClient as any)?.currency_id;
                                let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                if (!numericCurrencyId || isNaN(numericCurrencyId)) numericCurrencyId = 1;

                                if (numericCurrencyId === 1) {
                                    baseAmount = Number((selectedClient as any)?.total_base ?? 0);
                                } else {
                                    baseAmount = Number((selectedClient as any)?.total ?? 0);
                                }
                            } else {
                                baseAmount = Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                            }

                            // 3. Subcontractor Fee & Net Amount
                            const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                            const mainAmount = baseAmount - subcontractorFee;

                            // 4. VAT
                            let vatAmount = 0;
                            let shouldShowVAT = false;
                            const vatValue = selectedClient?.vat;

                            if (isLegacyLead) {
                                shouldShowVAT = true;
                                if (vatValue !== null && vatValue !== undefined) {
                                    const vatStr = String(vatValue).toLowerCase().trim();
                                    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                                }
                                if (shouldShowVAT) {
                                    vatAmount = baseAmount * 0.18;
                                }
                            } else {
                                shouldShowVAT = true;
                                if (vatValue !== null && vatValue !== undefined) {
                                    const vatStr = String(vatValue).toLowerCase().trim();
                                    if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') shouldShowVAT = false;
                                }

                                if (shouldShowVAT) {
                                    if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                                        vatAmount = Number(selectedClient.vat_value);
                                    } else {
                                        vatAmount = baseAmount * 0.18;
                                    }
                                }
                            }

                            // 5. Applicants
                            const applicantsCount = (selectedClient as any)?.no_of_applicants || selectedClient?.number_of_applicants_meeting || null;

                            return (
                                <div className="cursor-pointer group relative text-center" onClick={() => setIsBalanceModalOpen(true)}>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 justify-center">
                                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Total Value</p>
                                            {applicantsCount && Number(applicantsCount) > 0 && (
                                                <span className="badge badge-sm badge-ghost font-medium text-xs px-2 py-0.5 border-gray-200 text-gray-600">
                                                    <UserIcon className="w-3 h-3 mr-1" />
                                                    {applicantsCount} Applicants
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-end gap-2 justify-center">
                                            <p className="text-3xl font-bold text-gray-900 dark:text-white leading-none tracking-tight">
                                                {currency}{Number(mainAmount.toFixed(2)).toLocaleString()}
                                            </p>
                                            {shouldShowVAT && vatAmount > 0 && (
                                                <p className="text-sm text-gray-600 dark:text-gray-400 pb-1">
                                                    +{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} VAT
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Case unactivated Badge - Between client name and stage badge */}
                    {(() => {
                        const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        const isUnactivated = isLegacy ? (selectedClient?.status === 10) : (selectedClient?.status === 'inactive');
                        if (!isUnactivated) return null;

                        // Get unactivation reason
                        let unactivationReason = selectedClient?.unactivation_reason;
                        if (isLegacy && !unactivationReason) {
                            const reasonId = (selectedClient as any)?.reason_id;
                            if (reasonId) {
                                const reasonFromId = getUnactivationReasonFromId(reasonId);
                                if (reasonFromId) {
                                    unactivationReason = reasonFromId;
                                }
                            }
                        }

                        return (
                            <div className="flex flex-col items-center gap-2.5">
                                <div className="bg-red-100 text-red-800 rounded-lg px-4 py-3 border border-red-300">
                                    <div className="whitespace-nowrap text-base">
                                        Case unactivated
                                        {unactivationReason && (
                                            <span className="ml-2 text-sm font-normal">
                                                ({unactivationReason})
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {(selectedClient as any)?.deactivate_notes && (
                                    <div className="text-sm font-normal break-words max-w-full px-3 leading-relaxed text-gray-700">
                                        {(selectedClient as any).deactivate_notes}
                                    </div>
                                )}
                                {(selectedClient?.unactivated_by || selectedClient?.unactivated_at) && (
                                    <div className="backdrop-blur-md bg-white/30 bg-opacity-30 rounded-lg px-3 py-1.5 border border-white/20">
                                        <div className="text-xs font-normal text-center text-gray-700">
                                            by {selectedClient.unactivated_by || '---'}
                                            {selectedClient.unactivated_by && selectedClient.unactivated_at && ' / '}
                                            {selectedClient.unactivated_at && (
                                                <>at {new Date(selectedClient.unactivated_at).toLocaleDateString('en-US', {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}</>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {/* Info Grid - Flattened (No Boxes) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

                    {/* Section 1: Contact Info - Removed (moved to top) */}
                    <div>
                        {/* This section is now empty - email, phone, source moved to top */}
                    </div>

                    {/* Section 2: Financials - Removed (moved to top row) */}
                    <div>
                        {/* This section is now empty - finances moved to top row */}
                    </div>

                    {/* Section 3: Progress & Assignment */}
                    <div className="h-full md:col-span-1">
                        <div className="space-y-5">






                            {/* Dropdowns Content (Stages/Actions Inputs) from props */}
                            {
                                dropdownsContent && (
                                    <div className="pt-2">
                                        {dropdownsContent}
                                    </div>
                                )
                            }
                        </div>
                    </div>
                </div>

                {/* Workflow Actions Bar - Buttons with Logic & General Actions */}
                <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
                    {/* Left side: Roles (Closer, Handler, Expert, Scheduler) */}
                    <div className="flex items-center gap-4 flex-wrap">
                        {(() => {
                            const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');

                            // Helper to get employee ID for each role - always returns ID, never display name
                            const getCloserId = () => {
                                if (isLegacyLead) {
                                    return (selectedClient as any).closer_id || null;
                                }
                                // For new leads, closer is saved as display_name (text)
                                const closer = selectedClient.closer;
                                if (!closer || closer === '---' || closer === '--') {
                                    return null;
                                }
                                // If it's numeric, treat as ID
                                if (/^\d+$/.test(String(closer).trim())) {
                                    return Number(closer);
                                }
                                // Otherwise, find by display name
                                const employee = allEmployees.find((emp: any) =>
                                    emp.display_name && emp.display_name.trim() === String(closer).trim()
                                );
                                return employee?.id || null;
                            };

                            const getExpertId = () => {
                                if (isLegacyLead) {
                                    return (selectedClient as any).expert_id || null;
                                }
                                // For new leads, expert might be saved as ID (numeric) or display_name
                                const expert = (selectedClient as any).expert;
                                if (!expert || expert === '---' || expert === '--') {
                                    return null;
                                }
                                // If it's numeric, treat as ID
                                if (/^\d+$/.test(String(expert).trim())) {
                                    return Number(expert);
                                }
                                // Otherwise, find by display name
                                const employee = allEmployees.find((emp: any) =>
                                    emp.display_name && emp.display_name.trim() === String(expert).trim()
                                );
                                return employee?.id || null;
                            };

                            const getHandlerId = () => {
                                // For new leads, handler is saved as display_name (text)
                                // But also check case_handler_id which might be numeric
                                if (selectedClient.case_handler_id) {
                                    return selectedClient.case_handler_id;
                                }
                                const handler = selectedClient.handler;
                                if (!handler || handler === '---' || handler === '--') {
                                    return null;
                                }
                                // If it's numeric, treat as ID
                                if (/^\d+$/.test(String(handler).trim())) {
                                    return Number(handler);
                                }
                                // Otherwise, find by display name
                                const employee = allEmployees.find((emp: any) =>
                                    emp.display_name && emp.display_name.trim() === String(handler).trim()
                                );
                                return employee?.id || null;
                            };

                            const getSchedulerId = () => {
                                if (isLegacyLead) {
                                    return (selectedClient as any).meeting_scheduler_id || null;
                                }
                                // For new leads, scheduler is saved as display_name (text)
                                const scheduler = selectedClient.scheduler;
                                if (!scheduler || scheduler === '---' || scheduler === '--') {
                                    return null;
                                }
                                // If it's numeric, treat as ID
                                if (/^\d+$/.test(String(scheduler).trim())) {
                                    return Number(scheduler);
                                }
                                // Otherwise, find by display name
                                const employee = allEmployees.find((emp: any) =>
                                    emp.display_name && emp.display_name.trim() === String(scheduler).trim()
                                );
                                return employee?.id || null;
                            };

                            // Get display names - always use ID lookup to ensure consistent mapping
                            const closerId = getCloserId();
                            const closerDisplay = formatRoleDisplay(
                                closerId ? getEmployeeDisplayName(closerId) : null
                            );

                            const expertId = getExpertId();
                            const expertDisplay = formatRoleDisplay(
                                expertId ? getEmployeeDisplayName(expertId) : null
                            );

                            const handlerId = getHandlerId();
                            const handlerDisplay = formatRoleDisplay(
                                handlerId ? getEmployeeDisplayName(handlerId) : null
                            );

                            const schedulerId = getSchedulerId();
                            const schedulerDisplay = formatRoleDisplay(
                                schedulerId ? getEmployeeDisplayName(schedulerId) : null
                            );

                            return (
                                <>
                                    <div className="flex flex-col items-start">
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Closer</p>
                                        <div className="flex items-center gap-2 h-12">
                                            {getCloserId() ? (
                                                <EmployeeAvatar employeeId={getCloserId()} size="md" />
                                            ) : (
                                                <div className="w-12 h-12 flex-shrink-0"></div>
                                            )}
                                            <p className="font-medium truncate text-sm leading-5">{closerDisplay}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-start">
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Handler</p>
                                        <div className="flex items-center gap-2 h-12">
                                            {getHandlerId() ? (
                                                <EmployeeAvatar employeeId={getHandlerId()} size="md" />
                                            ) : (
                                                <div className="w-12 h-12 flex-shrink-0"></div>
                                            )}
                                            <p className="font-medium truncate text-sm leading-5">{handlerDisplay}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-start">
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Expert</p>
                                        <div className="flex items-center gap-2 h-12">
                                            {getExpertId() ? (
                                                <EmployeeAvatar employeeId={getExpertId()} size="md" />
                                            ) : (
                                                <div className="w-12 h-12 flex-shrink-0"></div>
                                            )}
                                            <p className="font-medium truncate text-sm leading-5">{expertDisplay}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-start">
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold h-4 leading-4 mb-1">Scheduler</p>
                                        <div className="flex items-center gap-2 h-12">
                                            {getSchedulerId() ? (
                                                <EmployeeAvatar employeeId={getSchedulerId()} size="md" />
                                            ) : (
                                                <div className="w-12 h-12 flex-shrink-0"></div>
                                            )}
                                            <p className="font-medium truncate text-sm leading-5">{schedulerDisplay}</p>
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* Right side: Stage Logic Buttons (Quick Actions) */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Check if case is unactivated - show message instead of buttons */}
                        {(() => {
                            const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                            const isUnactivated = isLegacy
                                ? (selectedClient?.status === 10)
                                : (selectedClient?.status === 'inactive');

                            if (isUnactivated) {
                                return (
                                    <div className="px-4 py-2 text-sm text-gray-600">
                                        Please activate lead in actions first to see the stage buttons.
                                    </div>
                                );
                            }
                            return null;
                        })()}

                        {/* Stage buttons - only show if case is activated */}
                        {(() => {
                            const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                            const isUnactivated = isLegacy
                                ? (selectedClient?.status === 10)
                                : (selectedClient?.status === 'inactive');

                            if (isUnactivated) {
                                return null; // Don't show any stage buttons if unactivated
                            }

                            // Check if case is closed - show "No action available" message
                            if (selectedClient && areStagesEquivalent(currentStageName, 'Case Closed')) {
                                return (
                                    <div className="px-4 py-2 text-sm text-gray-600">
                                        No action available
                                    </div>
                                );
                            }

                            return (
                                <>
                                    {/* Handler Set Stage */}
                                    {areStagesEquivalent(currentStageName, 'Handler Set') && (
                                        <button
                                            onClick={handleStartCase}
                                            className="btn btn-primary rounded-full px-6 shadow-lg shadow-indigo-100 hover:shadow-indigo-200 text-white gap-2 text-base transition-all hover:scale-105"
                                        >
                                            <PlayIcon className="w-5 h-5" />
                                            Start Case
                                        </button>
                                    )}

                                    {/* Handler Started Stage */}
                                    {areStagesEquivalent(currentStageName, 'Handler Started') && (
                                        <>
                                            <button
                                                onClick={() => updateLeadStage('Application submitted')}
                                                className="btn btn-success text-white rounded-full px-5 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 transition-all hover:scale-105"
                                            >
                                                <DocumentCheckIcon className="w-5 h-5" />
                                                Application Submitted
                                            </button>
                                            <button
                                                onClick={() => updateLeadStage('Case Closed')}
                                                className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                            >
                                                <CheckCircleIcon className="w-5 h-5" />
                                                Close Case
                                            </button>
                                        </>
                                    )}

                                    {/* Application submitted Stage */}
                                    {areStagesEquivalent(currentStageName, 'Application submitted') && (
                                        <button
                                            onClick={() => updateLeadStage('Case Closed')}
                                            className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                        >
                                            <CheckCircleIcon className="w-5 h-5" />
                                            Close Case
                                        </button>
                                    )}

                                    {/* Payment request sent Stage */}
                                    {areStagesEquivalent(currentStageName, 'payment_request_sent') && handlePaymentReceivedNewClient && (
                                        <button
                                            onClick={handlePaymentReceivedNewClient}
                                            className="btn btn-success text-white rounded-full px-5 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 transition-all hover:scale-105"
                                        >
                                            <CheckCircleIcon className="w-5 h-5" />
                                            Payment Received - new Client !!!
                                        </button>
                                    )}

                                    {/* Another meeting Stage - Check this first to avoid duplicates */}
                                    {areStagesEquivalent(currentStageName, 'another_meeting') && (
                                        <>
                                            {setShowRescheduleDrawer && (
                                                <button
                                                    onClick={() => setShowRescheduleDrawer(true)}
                                                    className="btn btn-outline rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                >
                                                    <ArrowPathIcon className="w-5 h-5" />
                                                    Meeting ReScheduling
                                                </button>
                                            )}
                                            {handleStageUpdate && (
                                                <button
                                                    onClick={() => handleStageUpdate('Meeting Ended')}
                                                    className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                >
                                                    <CheckCircleIcon className="w-5 h-5" />
                                                    Meeting Ended
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {/* Meeting scheduled / Meeting rescheduling Stages - Exclude another_meeting to avoid duplicates */}
                                    {!areStagesEquivalent(currentStageName, 'another_meeting') &&
                                        (areStagesEquivalent(currentStageName, 'meeting_scheduled') ||
                                            areStagesEquivalent(currentStageName, 'Meeting rescheduling') ||
                                            (isStageNumeric && (stageNumeric === 55 || stageNumeric === 21))) && (
                                            <>
                                                {/* Schedule Meeting button - only for stage 55, not for "Meeting scheduled" or "Meeting rescheduled" */}
                                                {!areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                                                    !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                                                    handleScheduleMenuClick &&
                                                    scheduleMenuLabel && (
                                                        <button
                                                            onClick={handleScheduleMenuClick}
                                                            className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                        >
                                                            <CalendarDaysIcon className="w-5 h-5" />
                                                            {scheduleMenuLabel}
                                                        </button>
                                                    )}
                                                {setShowRescheduleDrawer && (
                                                    <button
                                                        onClick={() => setShowRescheduleDrawer(true)}
                                                        className="btn btn-outline rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                    >
                                                        <ArrowPathIcon className="w-5 h-5" />
                                                        Meeting ReScheduling
                                                    </button>
                                                )}
                                                {/* Meeting Ended - only show for stage 21 if there are upcoming meetings, and exclude another_meeting */}
                                                {handleStageUpdate &&
                                                    !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                                    (!(areStagesEquivalent(currentStageName, 'Meeting rescheduling') || (isStageNumeric && stageNumeric === 21)) || hasScheduledMeetings) && (
                                                        <button
                                                            onClick={() => handleStageUpdate('Meeting Ended')}
                                                            className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                        >
                                                            <CheckCircleIcon className="w-5 h-5" />
                                                            Meeting Ended
                                                        </button>
                                                    )}
                                            </>
                                        )}

                                    {/* Waiting for meeting summary Stage */}
                                    {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && openSendOfferModal && (
                                        <button
                                            onClick={openSendOfferModal}
                                            className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                        >
                                            <DocumentCheckIcon className="w-5 h-5" />
                                            Send Price Offer
                                        </button>
                                    )}

                                    {/* Communication Started Stage */}
                                    {areStagesEquivalent(currentStageName, 'Communication started') && (
                                        <>
                                            {handleScheduleMenuClick && scheduleMenuLabel && (
                                                <button
                                                    onClick={handleScheduleMenuClick}
                                                    className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                >
                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                    {scheduleMenuLabel}
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {/* Meeting summary + Agreement sent Stage */}
                                    {areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') && (
                                        <>
                                            {handleScheduleMenuClick && scheduleMenuLabel && (
                                                <button
                                                    onClick={handleScheduleMenuClick}
                                                    className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                >
                                                    <CalendarDaysIcon className="w-5 h-5" />
                                                    {scheduleMenuLabel}
                                                </button>
                                            )}
                                            {handleOpenSignedDrawer && (
                                                <button
                                                    onClick={handleOpenSignedDrawer}
                                                    className="btn btn-success text-white rounded-full px-5 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 transition-all hover:scale-105"
                                                >
                                                    <HandThumbUpIcon className="w-5 h-5" />
                                                    Client signed
                                                </button>
                                            )}
                                            {handleOpenDeclinedDrawer && (
                                                <button
                                                    onClick={handleOpenDeclinedDrawer}
                                                    className="btn btn-error text-white rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                >
                                                    <HandThumbDownIcon className="w-5 h-5" />
                                                    Client declined
                                                </button>
                                            )}
                                            <button
                                                onClick={() => updateLeadStage('payment_request_sent')}
                                                className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                            >
                                                <CurrencyDollarIcon className="w-5 h-5" />
                                                Payment request sent
                                            </button>
                                            {openSendOfferModal && (
                                                <button
                                                    onClick={openSendOfferModal}
                                                    className="btn btn-outline rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                >
                                                    <PencilSquareIcon className="w-5 h-5" />
                                                    Revised price offer
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {/* Client signed agreement Stage */}
                                    {(areStagesEquivalent(currentStageName, 'Client signed agreement') ||
                                        areStagesEquivalent(currentStageName, 'client signed agreement') ||
                                        areStagesEquivalent(currentStageName, 'client_signed')) && (
                                            <button
                                                onClick={() => updateLeadStage('payment_request_sent')}
                                                className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                            >
                                                <CurrencyDollarIcon className="w-5 h-5" />
                                                Payment request sent
                                            </button>
                                        )}

                                    {/* General stages - Schedule Meeting and Communication Started */}
                                    {/* Only show for stages that haven't been handled by specific sections above */}
                                    {selectedClient &&
                                        !areStagesEquivalent(currentStageName, 'Handler Set') &&
                                        !areStagesEquivalent(currentStageName, 'Handler Started') &&
                                        !areStagesEquivalent(currentStageName, 'Application submitted') &&
                                        !areStagesEquivalent(currentStageName, 'payment_request_sent') &&
                                        !areStagesEquivalent(currentStageName, 'another_meeting') &&
                                        !areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                                        !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                                        !areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') &&
                                        !areStagesEquivalent(currentStageName, 'Communication started') &&
                                        !areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') &&
                                        !areStagesEquivalent(currentStageName, 'Success') &&
                                        !areStagesEquivalent(currentStageName, 'handler_assigned') &&
                                        !areStagesEquivalent(currentStageName, 'client_signed') &&
                                        !areStagesEquivalent(currentStageName, 'client signed agreement') &&
                                        !areStagesEquivalent(currentStageName, 'Client signed agreement') &&
                                        !(isStageNumeric && (stageNumeric === 21 || stageNumeric === 55)) && (
                                            <>
                                                {handleScheduleMenuClick && scheduleMenuLabel && (
                                                    <button
                                                        onClick={handleScheduleMenuClick}
                                                        className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                    >
                                                        <CalendarDaysIcon className="w-5 h-5" />
                                                        {scheduleMenuLabel}
                                                    </button>
                                                )}
                                                {handleStageUpdate && (
                                                    <button
                                                        onClick={() => handleStageUpdate('Communication Started')}
                                                        className="btn btn-outline rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                                                    >
                                                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                                                        Communication Started
                                                    </button>
                                                )}
                                            </>
                                        )}
                                </>
                            );
                        })()}
                    </div>
                </div>


            </div >

            {/* Category Edit Modal */}
            {
                showCategoryModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={() => setShowCategoryModal(false)}>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Category</h3>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Category</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="input input-bordered w-full"
                                    placeholder="Search categories..."
                                    value={categoryInputValue}
                                    onChange={e => {
                                        setCategoryInputValue(e.target.value);
                                        setShowCategoryDropdown(true);
                                    }}
                                    onFocus={() => setShowCategoryDropdown(true)}
                                />
                                {showCategoryDropdown && filteredCategories.length > 0 && (
                                    <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow-lg">
                                        {filteredCategories.slice(0, 20).map((cat: any) => {
                                            const displayName = cat.misc_maincategory?.name
                                                ? `${cat.name} (${cat.misc_maincategory.name})`
                                                : cat.name;
                                            return (
                                                <div
                                                    key={cat.id}
                                                    className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm"
                                                    onClick={() => {
                                                        // Set the full display name (subcategory + main category) in the input
                                                        setCategoryInputValue(displayName);
                                                        setShowCategoryDropdown(false);
                                                    }}
                                                >
                                                    {displayName}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 justify-end">
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                        setShowCategoryModal(false);
                                        setShowCategoryDropdown(false);
                                        setCategoryInputValue(displayCategory);
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        await handleSaveCategory();
                                        setShowCategoryModal(false);
                                        setShowCategoryDropdown(false);
                                    }}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Call Options Modal */}
            <CallOptionsModal
                isOpen={isCallModalOpen}
                onClose={() => setIsCallModalOpen(false)}
                phoneNumber={callPhoneNumber}
                leadName={callContactName}
            />
        </div >
    );
};

export default ClientHeader;
