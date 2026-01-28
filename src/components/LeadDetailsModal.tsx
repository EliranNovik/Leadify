import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { supabase, type Lead } from '../lib/supabase';
import InfoTabViewOnly from './client-tabs/InfoTabViewOnly';

interface LeadDetailsModalProps {
    lead: Lead | null;
    isOpen: boolean;
    onClose: () => void;
}

const LeadDetailsModal: React.FC<LeadDetailsModalProps> = ({ lead, isOpen, onClose }) => {
    const [client, setClient] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch client data when modal opens and lead is provided
    useEffect(() => {
        if (!isOpen || !lead) {
            setClient(null);
            setError(null);
            return;
        }

        const fetchClientData = async () => {
            setLoading(true);
            setError(null);

            try {
                const anyLead = lead as any;
                const leadNumber = anyLead.display_lead_number || anyLead.lead_number || lead.id?.toString() || '';
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

        fetchClientData();
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black bg-opacity-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-white w-full h-full overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between px-6 py-4">
                        <h2 className="text-2xl font-bold text-gray-900">
                            {client ? (client.name || 'Client Details') : 'Loading...'}
                        </h2>
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
