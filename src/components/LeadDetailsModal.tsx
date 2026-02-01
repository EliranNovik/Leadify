import React, { useState, useEffect, useMemo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { supabase, type Lead } from '../lib/supabase';
import InfoTabViewOnly from './client-tabs/InfoTabViewOnly';
import ClientInformationBox from './ClientInformationBox';
import { useExternalUser } from '../hooks/useExternalUser';
import { getStageName, getStageColour, fetchStageNames } from '../lib/stageUtils';

interface LeadDetailsModalProps {
    lead: Lead | null;
    isOpen: boolean;
    onClose: () => void;
}

const LeadDetailsModal: React.FC<LeadDetailsModalProps> = ({ lead, isOpen, onClose }) => {
    const { isExternalUser } = useExternalUser();
    const [client, setClient] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [allEmployees, setAllEmployees] = useState<any[]>([]);

    // Initialize stage names cache on mount
    useEffect(() => {
        fetchStageNames().catch(error => {
            console.error('Error initializing stage names:', error);
        });
    }, []);

    // Fetch employees for getEmployeeDisplayName
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data, error } = await supabase
                    .from('tenants_employee')
                    .select('id, display_name')
                    .eq('active', true);

                if (error) throw error;
                setAllEmployees(data || []);
            } catch (error) {
                console.error('Error fetching employees:', error);
            }
        };

        if (isOpen) {
            fetchEmployees();
        }
    }, [isOpen]);

    // Create getEmployeeDisplayName function
    const getEmployeeDisplayName = useMemo(() => {
        return (employeeId: string | number | null | undefined): string => {
            if (!employeeId || employeeId === '---' || employeeId === null || employeeId === undefined) {
                return 'Not assigned';
            }

            // Convert employeeId to string for comparison
            const idAsString = String(employeeId);
            const employee = allEmployees.find((emp: any) => String(emp.id) === idAsString);

            return employee ? employee.display_name : 'Not assigned';
        };
    }, [allEmployees]);

    // Extract fetch client data logic into a reusable function
    const fetchClientData = async (leadToFetch: Lead) => {
        setLoading(true);
        setError(null);

            try {
                const anyLead = leadToFetch as any;
                const leadNumber = anyLead.display_lead_number || anyLead.lead_number || leadToFetch.id?.toString() || '';
                const manualId = anyLead.manual_id || null;
                const leadType = anyLead.lead_type;

                if (!leadNumber) {
                    setError('Invalid lead number');
                    setLoading(false);
                    return;
                }

                // Check if it's a sublead (contains '/')
                const isSubLead = leadNumber.includes('/');
                let clientData = null;

                // Build queries similar to Clients.tsx
                const queries = [];

                // Try by manual_id for new leads
                if (manualId && /^\d+$/.test(manualId)) {
                    queries.push(
                        supabase
                            .from('leads')
                            .select('*')
                            .eq('manual_id', manualId)
                            .then(({ data, error }) => ({ type: 'manual', data, error }))
                    );
                }

                // Try by lead_number for new leads
                queries.push(
                    supabase
                        .from('leads')
                        .select('*')
                        .eq('lead_number', leadNumber)
                        .then(({ data, error }) => ({ type: 'new', data, error }))
                );

                // Try legacy leads by ID if it's numeric
                if (/^\d+$/.test(leadNumber)) {
                    queries.push(
                        supabase
                            .from('leads_lead')
                            .select(`
                *,
                accounting_currencies!leads_lead_currency_id_fkey (
                  name,
                  iso_code
                ),
                misc_language!leads_lead_language_id_fkey (
                  name
                )
              `)
                            .eq('id', parseInt(leadNumber))
                            .single()
                            .then(({ data, error }) => ({ type: 'legacy', data, error }))
                    );
                }

                // Execute all queries in parallel
                const results = await Promise.all(queries);

                // Find the first successful result
                for (const result of results) {
                    if (result.error) continue;

                    if (result.type === 'legacy' && result.data) {
                        // Transform legacy client to match new client structure
                        const legacyClient = result.data;
                        const currencyData = Array.isArray(legacyClient.accounting_currencies)
                            ? legacyClient.accounting_currencies[0]
                            : legacyClient.accounting_currencies;
                        const currency = currencyData?.iso_code || 'NIS';

                        clientData = {
                            ...legacyClient,
                            id: `legacy_${legacyClient.id}`,
                            lead_number: String(legacyClient.id),
                            stage: String(legacyClient.stage || ''),
                            source: String(legacyClient.source_id || ''),
                            created_at: legacyClient.cdate,
                            updated_at: legacyClient.udate,
                            notes: legacyClient.notes || '',
                            special_notes: legacyClient.special_notes || '',
                            next_followup: legacyClient.next_followup || '',
                            probability: String(legacyClient.probability || ''),
                            category: String(legacyClient.category_id || legacyClient.category || ''),
                            language: String(legacyClient.language_id || ''),
                            balance: String(legacyClient.total || ''),
                            lead_type: 'legacy',
                            client_country: null,
                            closer: null,
                            handler: null,
                            unactivation_reason: null,
                            balance_currency: currency,
                        };
                        break;
                    } else if ((result.type === 'new' || result.type === 'manual') && result.data) {
                        // Handle new leads - could be array or single object
                        const newClientData = Array.isArray(result.data) ? result.data[0] : result.data;
                        if (newClientData) {
                            clientData = {
                                ...newClientData,
                                lead_type: 'new',
                            };
                            break;
                        }
                    }
                }

                if (!clientData) {
                    setError('Client not found');
                } else {
                    setClient(clientData);
                }
            } catch (err) {
                console.error('Error fetching client data:', err);
                setError('Failed to load client data');
            } finally {
                setLoading(false);
            }
        };

    // Fetch client data when modal opens and lead is provided
    useEffect(() => {
        if (!isOpen || !lead) {
            setClient(null);
            setError(null);
            return;
        }

        fetchClientData(lead);
    }, [isOpen, lead]);


    // Close modal on Escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            // Prevent body scroll when modal is open
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

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

    // Get stage badge component
    const getStageBadge = (stage: string | number | null | undefined) => {
        if (!stage && stage !== 0) return <span className="badge badge-outline">No Stage</span>;
        
        // Convert stage to string for getStageName/getStageColour (handles both numeric IDs and stage names)
        const stageStr = String(stage);
        
        // Get stage name and color from stageUtils
        const stageName = getStageName(stageStr);
        const stageColour = getStageColour(stageStr);
        const badgeTextColour = getContrastingTextColor(stageColour);
        
        // Use dynamic color if available, otherwise fallback to default purple
        const backgroundColor = stageColour || '#3f28cd';
        const textColor = stageColour ? badgeTextColour : '#ffffff';
        
        return <span 
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
        </span>;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black bg-opacity-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-white w-full h-full overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between px-6 py-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-gray-900">
                                {client ? (client.name || 'Client Details') : 'Loading...'}
                            </h2>
                            {isExternalUser && client && getStageBadge(client.stage)}
                        </div>
                        <button
                            onClick={onClose}
                            className="btn btn-circle btn-ghost hover:bg-gray-100"
                            aria-label="Close modal"
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    {loading ? (
                        <div className="flex items-center justify-center min-h-[400px]">
                            <div className="text-center">
                                <div className="loading loading-spinner loading-lg text-primary"></div>
                                <p className="mt-4 text-gray-600">Loading client data...</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center min-h-[400px]">
                            <div className="text-center">
                                <p className="text-xl font-semibold text-red-600 mb-2">Error</p>
                                <p className="text-gray-600">{error}</p>
                                <button onClick={onClose} className="btn btn-primary mt-4">
                                    Close
                                </button>
                            </div>
                        </div>
                    ) : client ? (
                        <div className="max-w-7xl mx-auto">
                            {/* Client Information Box at the top */}
                            <div className="mb-6">
                                <ClientInformationBox
                                    selectedClient={client}
                                    getEmployeeDisplayName={getEmployeeDisplayName}
                                    onClientUpdate={async () => {
                                        // Refetch client data when updated
                                        if (lead) {
                                            await fetchClientData(lead);
                                        }
                                    }}
                                />
                            </div>
                            {/* Info Tab Content - View Only */}
                            <InfoTabViewOnly client={client} onClientUpdate={async () => { }} />
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default LeadDetailsModal;
