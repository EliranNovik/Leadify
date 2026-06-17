import React, { useState, useEffect, useRef } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { convertToNIS } from '../lib/currencyConversion';
import { getVatRateForLegacyLead } from '../lib/financeUnpaidTotal';
import MobileBottomSheet from './MobileBottomSheet';

type FirmOption = { id: string; name: string };

interface BalanceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedClient: any;
  isLocked?: boolean;
  lockedBaseTotal?: number | null;
  lockedVatTotal?: number | null;
  onUpdate: (clientId?: string | number) => Promise<void>;
}

const BalanceEditModal: React.FC<BalanceEditModalProps> = ({
  isOpen,
  onClose,
  selectedClient,
  isLocked = false,
  lockedBaseTotal = null,
  lockedVatTotal = null,
  onUpdate
}) => {
  const [formData, setFormData] = useState({
    currencyId: '', // Store currency ID instead of symbol
    currency: '', // Will be computed from ID
    proposal_total: 0,
    proposal_vat: '',
    subcontractor_fee: 0,
    external_firm_id: '' as string,
    potential_value: 0,
    potential_applicants_meeting: 0,
    number_of_applicants_meeting: '' as number | '',
    vat_value: 0
  });
  const [loading, setLoading] = useState(false);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);
  const [firmOptions, setFirmOptions] = useState<FirmOption[]>([]);
  const [loadingFirms, setLoadingFirms] = useState(false);
  const initializedForClientRef = useRef<string | null>(null);
  const firmsLoadedRef = useRef(false);

  const mergeFirmOption = (prev: FirmOption[], firm: FirmOption): FirmOption[] => {
    if (prev.some((f) => f.id === firm.id)) return prev;
    return [...prev, firm].sort((a, b) => a.name.localeCompare(b.name));
  };

  /** Include linked firm in dropdown even when is_active is false */
  const ensureFirmInOptions = async (firmId: string) => {
    const id = firmId.trim();
    if (!id) return;
    const { data, error } = await supabase
      .from('firms')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return;
    setFirmOptions((prev) =>
      mergeFirmOption(prev, {
        id: String(data.id),
        name: String(data.name ?? '').trim() || 'Unnamed firm',
      }),
    );
  };

  // Helper function to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    // Map currency codes to symbols
    if (currency === 'ILS' || currency === '₪') return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === 'EUR' || currency === '€') return '€';
    if (currency === 'GBP' || currency === '£') return '£';
    if (currency === 'CAD' || currency === 'C$') return 'C$';
    if (currency === 'AUD' || currency === 'A$') return 'A$';
    if (currency === 'JPY' || currency === '¥') return '¥';
    if (currency === 'CHF') return 'CHF';
    if (currency === 'SEK') return 'SEK';
    if (currency === 'NOK') return 'NOK';
    if (currency === 'DKK') return 'DKK';
    if (currency === 'PLN') return 'PLN';
    if (currency === 'CZK') return 'CZK';
    if (currency === 'HUF') return 'HUF';
    if (currency === 'RON') return 'RON';
    if (currency === 'BGN') return 'BGN';
    if (currency === 'HRK') return 'HRK';
    if (currency === 'RUB') return 'RUB';
    if (currency === 'UAH') return 'UAH';
    if (currency === 'TRY') return 'TRY';
    // If it's already a symbol, return it
    if (currency.length <= 2 && !currency.match(/^[A-Z]{3}$/)) return currency;
    // Default fallback
    return currency;
  };

  // VAT options
  const vatOptions = [
    { value: 'excluded', label: 'No VAT (0%)' },
    { value: 'included', label: 'VAT excluded' }
  ];

  // Helper function to get symbol from ISO code (used in multiple places)
  const getSymbolFromISO = (isoCode: string) => {
    switch (isoCode?.toUpperCase()) {
      case 'ILS': return '₪';
      case 'USD': return '$';
      case 'EUR': return '€';
      case 'GBP': return '£';
      case 'CAD': return 'C$';
      case 'AUD': return 'A$';
      case 'JPY': return '¥';
      default: return isoCode || '₪';
    }
  };

  // Fetch currencies from accounting_currencies table
  const fetchCurrencies = async () => {
    setLoadingCurrencies(true);
    try {
      const { data, error } = await supabase
        .from('accounting_currencies')
        .select('*')
        .order('order', { ascending: true });

      if (error) throw error;
      setCurrencies(data || []);
    } catch (error) {
      console.error('Error fetching currencies:', error);
      toast.error('Failed to load currencies');
    } finally {
      setLoadingCurrencies(false);
    }
  };

  // Reset initialization ref when modal closes
  useEffect(() => {
    if (!isOpen) {
      initializedForClientRef.current = null;
      return;
    }
    if (firmsLoadedRef.current) return;
    let cancelled = false;
    const loadFirms = async () => {
      setLoadingFirms(true);
      try {
        const { data: firmsData, error: firmsError } = await supabase
          .from('firms')
          .select('id, name')
          .eq('is_active', true)
          .order('name', { ascending: true });
        if (firmsError) {
          console.error('Error fetching firms:', firmsError);
          return;
        }
        if (!cancelled) {
          setFirmOptions(
            (firmsData ?? []).map((f) => ({
              id: String(f.id),
              name: String(f.name ?? '').trim() || 'Unnamed firm',
            })),
          );
          firmsLoadedRef.current = true;
        }
      } finally {
        if (!cancelled) setLoadingFirms(false);
      }
    };
    void loadFirms();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedClient) return;
    
    const clientId = selectedClient.id?.toString();
    if (!clientId) return;

    // Fetch currencies when modal opens
    if (currencies.length === 0 && !loadingCurrencies) {
      fetchCurrencies();
      return;
    }

    // Wait for currencies to be loaded
    if (currencies.length === 0 || loadingCurrencies) {
      return;
    }

    const initKey = `${clientId}:${String((selectedClient as any)?.external_firm_id ?? '')}`;
    if (initializedForClientRef.current === initKey) {
      return;
    }

    // Initialize form data - wrap in async function to fetch subcontractor_fee
    const initializeFormData = async () => {
      const isLegacyLead = selectedClient.id?.toString().startsWith('legacy_');
      
      // For new leads, check the 'vat' column (text type)
      // NULL, FALSE, 'false', 'FALSE' → excluded
      // TRUE, 'true', 'TRUE' → included
      // Default to 'included' (true) since database has default TRUE
      let vatStatus = 'included'; // Default to included
    
    if (!isLegacyLead) {
      // For new leads, check the vat column
      if (selectedClient.vat !== null && selectedClient.vat !== undefined) {
        const vatValue = String(selectedClient.vat).toLowerCase().trim();
        if (vatValue === 'false' || vatValue === '0' || vatValue === 'no') {
          vatStatus = 'excluded';
        } else {
          // Default to included for 'true', '1', 'yes', or any other value
          vatStatus = 'included';
        }
      }
      // If vat is null/undefined, keep default 'included'
    } else {
      // For legacy leads, check the 'vat' column (text type, same as new leads)
      if ((selectedClient as any).vat !== null && (selectedClient as any).vat !== undefined) {
        const vatValue = String((selectedClient as any).vat).toLowerCase().trim();
        if (vatValue === 'false' || vatValue === '0' || vatValue === 'no') {
          vatStatus = 'excluded';
        } else {
          // Default to included for 'true', '1', 'yes', or any other value
          vatStatus = 'included';
        }
      }
      // If vat is null/undefined, keep default 'included'
    }
    
        // Get currency_id (works for both legacy and new leads)
        let currencyId = '';
        
        if (isLegacyLead) {
          // Legacy leads: currency_id is already in the client data
          // Try multiple ways to get currency_id
          currencyId = (selectedClient.currency_id?.toString() || 
                       (selectedClient as any).currency_id?.toString() || 
                       '').trim();
          
          // If currency_id is not available, try to find it from accounting_currencies join
          if (!currencyId && (selectedClient as any).accounting_currencies) {
            const currencyRecord = Array.isArray((selectedClient as any).accounting_currencies)
              ? (selectedClient as any).accounting_currencies[0]
              : (selectedClient as any).accounting_currencies;
            if (currencyRecord?.id) {
              currencyId = currencyRecord.id.toString();
            }
          }
          
          // Last fallback: try to find currency by symbol
          if (!currencyId) {
            const currentCurrencySymbol = selectedClient.balance_currency || 
                                         (selectedClient as any).meeting_total_currency || 
                                         '₪';
            const normalizedSymbol = getCurrencySymbol(currentCurrencySymbol);
            const matchingCurrency = currencies.find(c => {
              const symbol = getSymbolFromISO(c.iso_code);
              return symbol === normalizedSymbol;
            });
            currencyId = matchingCurrency?.id?.toString() || '';
          }
        } else {
          // New leads: use currency_id if available
          if (selectedClient.currency_id) {
            currencyId = selectedClient.currency_id.toString();
          } else {
            // Fallback: try to find currency by symbol (for backward compatibility)
            const currentCurrencySymbol = selectedClient.balance_currency || selectedClient.proposal_currency || selectedClient.currency || '₪';
            const normalizedSymbol = getCurrencySymbol(currentCurrencySymbol);
            const matchingCurrency = currencies.find(c => {
              const symbol = getSymbolFromISO(c.iso_code);
              return symbol === normalizedSymbol;
            });
            currencyId = matchingCurrency?.id?.toString() || '';
          }
        }
        
        // Default to currency ID 1 (NIS/ILS) if still empty
        if (!currencyId && currencies.length > 0) {
          const nisCurrency = currencies.find(c => c.iso_code === 'ILS' || c.iso_code === 'NIS');
          currencyId = nisCurrency?.id?.toString() || '1';
        }
        
      // For legacy leads: determine which value to use based on currency_id
      let proposalTotalValue = 0;
      let subcontractorFeeValue = 0;
      let externalFirmId = (selectedClient as any).external_firm_id
        ? String((selectedClient as any).external_firm_id)
        : '';
      let applicantsValue: number | null = null;
      let potentialApplicantsValue: number | null = null;
      
      // For legacy leads, explicitly fetch subcontractor_fee from database
      if (isLegacyLead) {
        const legacyId = parseInt(clientId.replace('legacy_', ''));
        try {
          const { data: leadData, error: leadError } = await supabase
            .from('leads_lead')
            .select('subcontractor_fee, external_firm_id, no_of_applicants, potential_applicants')
            .eq('id', legacyId)
            .single();
          
          if (!leadError && leadData) {
            if (leadData.subcontractor_fee !== null && leadData.subcontractor_fee !== undefined) {
              subcontractorFeeValue = Number(leadData.subcontractor_fee);
            } else {
              subcontractorFeeValue = Number((selectedClient as any).subcontractor_fee ?? selectedClient.subcontractor_fee ?? 0);
            }
            if (leadData.external_firm_id) {
              externalFirmId = String(leadData.external_firm_id);
            }

            if (leadData.no_of_applicants !== null && leadData.no_of_applicants !== undefined) {
              const n = Number(leadData.no_of_applicants);
              applicantsValue = Number.isFinite(n) ? n : null;
            }
            if ((leadData as any).potential_applicants !== null && (leadData as any).potential_applicants !== undefined) {
              const n = Number((leadData as any).potential_applicants);
              potentialApplicantsValue = Number.isFinite(n) ? n : null;
            }
            console.log('✅ Fetched subcontractor_fee from database:', subcontractorFeeValue);
          } else {
            // Fallback to selectedClient value
            subcontractorFeeValue = Number((selectedClient as any).subcontractor_fee ?? selectedClient.subcontractor_fee ?? 0);
            console.log('⚠️ subcontractor_fee not found in database, using selectedClient value:', subcontractorFeeValue);
          }
        } catch (error) {
          console.error('Error fetching subcontractor_fee:', error);
          // Fallback to selectedClient value
          subcontractorFeeValue = Number((selectedClient as any).subcontractor_fee ?? selectedClient.subcontractor_fee ?? 0);
        }
        
        // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
        const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        if (numericCurrencyId === 1) {
          proposalTotalValue = Number((selectedClient as any).total_base || selectedClient.balance || selectedClient.total || 0);
        } else {
          proposalTotalValue = Number(selectedClient.total || selectedClient.balance || 0);
        }
        // Potential applicants for legacy leads are stored as potential_applicants (text/number)
        if (potentialApplicantsValue === null) {
          const fallback = Number((selectedClient as any)?.potential_applicants ?? 0);
          potentialApplicantsValue = Number.isFinite(fallback) ? fallback : null;
        }
      } else {
        proposalTotalValue = Number(selectedClient.balance || selectedClient.proposal_total || 0);
        subcontractorFeeValue = Number(selectedClient.subcontractor_fee ?? 0);
        // New leads: potential_applicants_meeting is the field used across the app
        const fallbackPotentialApplicants = Number((selectedClient as any)?.potential_applicants_meeting ?? 0);
        potentialApplicantsValue = Number.isFinite(fallbackPotentialApplicants) ? fallbackPotentialApplicants : null;
        try {
          const { data: leadData, error: leadError } = await supabase
            .from('leads')
            .select('number_of_applicants_meeting, potential_applicants_meeting, external_firm_id')
            .eq('id', selectedClient.id)
            .single();
          if (!leadError && leadData?.external_firm_id) {
            externalFirmId = String(leadData.external_firm_id);
          }
          if (!leadError && leadData && leadData.number_of_applicants_meeting !== null && leadData.number_of_applicants_meeting !== undefined) {
            const n = Number(leadData.number_of_applicants_meeting);
            applicantsValue = Number.isFinite(n) ? n : null;
          }
          if (!leadError && leadData && (leadData as any).potential_applicants_meeting !== null && (leadData as any).potential_applicants_meeting !== undefined) {
            const n = Number((leadData as any).potential_applicants_meeting);
            potentialApplicantsValue = Number.isFinite(n) ? n : null;
          }
        } catch (error) {
          console.error('Error fetching number_of_applicants_meeting:', error);
        }
      }
        
      console.log('🔍 Initializing form data:', {
        clientId,
        currencyId,
        isLegacyLead,
        currenciesCount: currencies.length,
        selectedClientCurrencyId: selectedClient.currency_id,
        selectedClientAccountingCurrencies: (selectedClient as any).accounting_currencies,
        selectedClientBalanceCurrency: selectedClient.balance_currency,
        selectedClientProposalCurrency: selectedClient.proposal_currency,
        proposalTotalValue,
        subcontractorFeeValue,
        subcontractorFeeRaw: (selectedClient as any).subcontractor_fee ?? selectedClient.subcontractor_fee,
        total_base: (selectedClient as any).total_base,
        total: selectedClient.total,
        externalFirmId,
        selectedClientKeys: Object.keys(selectedClient)
      });

      await ensureFirmInOptions(externalFirmId);
      
      setFormData({
        currencyId: currencyId,
        currency: '', // Will be computed from currencyId when needed
        proposal_total: (isLocked && lockedBaseTotal !== null) ? lockedBaseTotal : proposalTotalValue,
        proposal_vat: vatStatus,
        subcontractor_fee: subcontractorFeeValue,
        external_firm_id: externalFirmId,
        potential_value: selectedClient.potential_value || selectedClient.potential_total || 0,
        potential_applicants_meeting: potentialApplicantsValue ?? 0,
        number_of_applicants_meeting: (() => {
          const raw =
            applicantsValue !== null
              ? applicantsValue
              : isLegacyLead
                ? (selectedClient as any).no_of_applicants ?? (selectedClient as any).number_of_applicants_meeting
                : selectedClient.number_of_applicants_meeting;
          if (raw === null || raw === undefined || raw === '') return '';
          const n = Number(raw);
          return Number.isFinite(n) ? n : '';
        })(),
        vat_value: (isLocked && lockedVatTotal !== null) ? lockedVatTotal : (selectedClient.vat_value || 0)
      });

      initializedForClientRef.current = initKey;
    };
    
    initializeFormData();
  }, [isOpen, selectedClient?.id, selectedClient?.external_firm_id, currencies.length, loadingCurrencies]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const applicantsForDb = (raw: number | ''): number | null => {
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  // Handle input focus to select all text for any number value
  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Select all text if the field contains any number value
    if (e.target.value && !isNaN(Number(e.target.value))) {
      e.target.select();
    }
  };

  /** VAT amount in lead currency. DB stores NET in balance/proposal_total/total; VAT is separate (vat_value). */
  const calculateVAT = () => {
    if (formData.proposal_vat !== 'included') return 0;
    const net = Number(formData.proposal_total) || 0;
    const vatRate = getVatRateForLegacyLead(
      (selectedClient as any)?.date_signed || (selectedClient as any)?.created_at || null
    );
    return Math.round(net * vatRate * 100) / 100;
  };

  /** Net (ex-VAT) and VAT to persist — matches SignedSalesReport / total column (without VAT). */
  const getPersistedNetAndVat = () => {
    const net = Number(formData.proposal_total) || 0;
    if (formData.proposal_vat !== 'included') return { net, vat: 0 };
    return { net, vat: calculateVAT() };
  };

  const handleSave = async () => {
    if (!selectedClient) return;
    
    // Validate currency is selected
    if (!formData.currencyId || formData.currencyId === '') {
      toast.error('Please select a currency');
      return;
    }
    
    // Get the currency ID (we'll save this directly, like legacy leads)
    const currencyId = parseInt(formData.currencyId, 10);
    if (!currencyId || isNaN(currencyId)) {
      toast.error('Invalid currency selected');
      return;
    }

    setLoading(true);
    try {
      const isLegacyLead = selectedClient.id?.toString().startsWith('legacy_');
      const { net: netAmount, vat: persistedVat } = getPersistedNetAndVat();

      if (isLegacyLead) {
        // For legacy leads, use the currency ID directly from formData.currencyId
        const currencyId = parseInt(formData.currencyId, 10) || 1; // Default to ID 1 if not found
        
        // Update legacy lead in leads_lead table
        // Map proposal_vat to 'vat' column (text): 'included' → 'true', 'excluded' → 'false' (same as new leads)
        const vatColumnValue = formData.proposal_vat === 'included' ? 'true' : 'false';
        
        // For legacy leads: if currency_id is 1 (NIS/ILS), save to total_base; otherwise save to total and convert to NIS for total_base
        const updateData: any = {
          currency_id: currencyId,
          potential_total: formData.potential_value.toString(),
          vat: vatColumnValue, // Save VAT status in 'vat' column for legacy leads
          subcontractor_fee: Number(formData.subcontractor_fee) || 0, // Always save subcontractor_fee as a number
          external_firm_id: formData.external_firm_id?.trim() || null,
          vat_value: persistedVat
        };
        if (formData.potential_applicants_meeting !== null && formData.potential_applicants_meeting !== undefined) {
          updateData.potential_applicants = Number(formData.potential_applicants_meeting) || 0;
        }
        updateData.no_of_applicants = applicantsForDb(formData.number_of_applicants_meeting);

        // Save logic for legacy leads (NET ex-VAT in total/total_base; VAT in vat_value):
        // If currency_id is 1 (NIS): Save only to total_base
        // If currency_id is other than 1: Save to total, and calculate NIS equivalent and save to total_base
        if (!isLocked) {
          if (currencyId === 1) {
            updateData.total_base = netAmount;
          } else {
            updateData.total = netAmount;
            updateData.total_base = convertToNIS(netAmount, currencyId);
          }
        }
        
        console.log('💾 Saving legacy lead balance update:', {
          legacyId: selectedClient.id.toString().replace('legacy_', ''),
          currencyId,
          updateData,
          formDataProposalTotal: formData.proposal_total,
          formDataSubcontractorFee: formData.subcontractor_fee,
          subcontractorFeeInUpdate: updateData.subcontractor_fee
        });
        
        console.log('📤 Sending update to database:', {
          table: 'leads_lead',
          id: selectedClient.id.toString().replace('legacy_', ''),
          updateData
        });
        
        const { data: updateResult, error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', selectedClient.id.toString().replace('legacy_', ''))
          .select('id, total, total_base, subcontractor_fee, external_firm_id, currency_id, master_id');

        if (error) {
          console.error('❌ Error updating legacy lead:', error);
          console.error('❌ Update data that failed:', updateData);
          throw error;
        }
        
        console.log('✅ Legacy lead updated successfully:', updateResult);
        if (updateResult && updateResult[0]) {
          console.log('✅ Verified saved values:', {
            total: updateResult[0].total,
            total_base: updateResult[0].total_base,
            subcontractor_fee: updateResult[0].subcontractor_fee,
            currency_id: updateResult[0].currency_id,
            master_id: updateResult[0].master_id
          });
          
          // Verify subcontractor_fee was saved
          if (updateResult[0].subcontractor_fee !== updateData.subcontractor_fee) {
            console.error('❌ Subcontractor fee mismatch! Expected:', updateData.subcontractor_fee, 'Got:', updateResult[0].subcontractor_fee);
          } else {
            console.log('✅ Subcontractor fee saved correctly:', updateResult[0].subcontractor_fee);
          }
        }
      } else {
        // Update new lead in leads table
        // Map proposal_vat to 'vat' column (text): 'included' → 'true', 'excluded' → 'false'
        const vatColumnValue = formData.proposal_vat === 'included' ? 'true' : 'false';
        
        // Get currency ID from formData.currencyId (same as legacy leads)
        const currencyId = parseInt(formData.currencyId, 10) || 1; // Default to ID 1 if not found
        
        console.log('💾 Saving balance update for new lead:', {
          leadId: selectedClient.id,
          currencyId: currencyId,
          previousCurrencyId: selectedClient.currency_id,
          balance: formData.proposal_total,
          vat: vatColumnValue
        });
        
        const updateData: any = {
          currency_id: currencyId, // Save currency ID (like legacy leads)
          subcontractor_fee: formData.subcontractor_fee,
          external_firm_id: formData.external_firm_id?.trim() || null,
          potential_total: formData.potential_value,
          number_of_applicants_meeting: applicantsForDb(formData.number_of_applicants_meeting),
          vat_value: persistedVat,
          vat: vatColumnValue
        };
        if (formData.potential_applicants_meeting !== null && formData.potential_applicants_meeting !== undefined) {
          updateData.potential_applicants_meeting = Number(formData.potential_applicants_meeting) || 0;
        }

        if (!isLocked) {
          updateData.balance = netAmount;
          updateData.proposal_total = netAmount;
        }
        
        console.log('📤 Update payload being sent to database:', updateData);
        
        const { data, error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedClient.id)
          .select('id, currency_id, balance, external_firm_id'); // Select back to verify

        if (error) {
          console.error('❌ Error updating balance:', error);
          console.error('❌ Error details:', JSON.stringify(error, null, 2));
          toast.error(`Failed to update balance: ${error.message}`);
          throw error;
        }
        
        console.log('✅ Balance updated successfully. Updated data from DB:', data);
        
        // Verify the currency_id was saved correctly
        if (data && data[0]) {
          const updatedCurrencyId = data[0].currency_id;
          if (updatedCurrencyId !== currencyId) {
            console.error('❌ Currency ID mismatch! Expected:', currencyId, 'Got:', updatedCurrencyId);
            toast.error(`Currency save verification failed. Expected ID: ${currencyId}, Got: ${updatedCurrencyId}`);
          } else {
            console.log('✅ Currency ID saved correctly:', updatedCurrencyId);
          }
        } else {
          console.error('❌ No data returned from update query!');
        }
      }

      toast.success('Balance updated successfully!');
      // Refresh client data to show updated currency - ensure we wait for it to complete
      try {
        console.log('🔄 Refreshing client data after balance update...');
        await onUpdate(selectedClient.id);
        console.log('✅ Client data refreshed after balance update');
        // Force a longer delay to ensure state updates propagate and UI re-renders
        await new Promise(resolve => setTimeout(resolve, 300));
        // Force a re-render by closing and letting the parent handle the update
      } catch (refreshError) {
        console.error('⚠️ Error refreshing client data:', refreshError);
        // Don't block the close, but log the error
      }
      onClose();
    } catch (error) {
      console.error('Error updating balance:', error);
      toast.error('Failed to update balance');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // VAT preview: locked plan uses plan VAT; otherwise NET × rate (same as saved vat_value).
  const vatAmount =
    isLocked && lockedVatTotal !== null
      ? Number(lockedVatTotal) || 0
      : calculateVAT();
  const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
  const shouldShowVAT = isLegacyLead
    ? formData.proposal_vat === 'included'
    : formData.proposal_vat === 'included';

  return (
    <MobileBottomSheet
      open={isOpen}
      onClose={onClose}
      title="Update Lead"
      desktopLayout="drawer-right"
      mobileFullHeight
      zIndex={340}
      sheetClassName="md:max-w-md"
      contentClassName="!p-0 flex flex-col min-h-0"
      footer={
        <div className="flex w-full gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost flex-1 max-md:min-h-12" disabled={loading}>
            Cancel
          </button>
          <button type="button" onClick={() => handleSave()} className="btn btn-primary flex-1 max-md:min-h-12" disabled={loading}>
            {loading ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      }
    >
            <div className="p-6 h-full overflow-y-auto flex-1 min-h-0">
          <div className="space-y-4">
            {/* Currency */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Currency:</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={formData.currencyId}
                onChange={(e) => {
                  const selectedCurrencyId = e.target.value;
                  const selectedCurrency = currencies.find(c => c.id.toString() === selectedCurrencyId);
                  const symbol = selectedCurrency ? getSymbolFromISO(selectedCurrency.iso_code) : '';
                  handleInputChange('currencyId', selectedCurrencyId);
                  handleInputChange('currency', symbol);
                }}
                required
                disabled={loadingCurrencies || isLocked}
              >
                <option value="">Select currency...</option>
                {currencies.map(currency => {
                  const symbol = getSymbolFromISO(currency.iso_code);
                  return (
                    <option key={currency.id} value={currency.id.toString()}>
                      {symbol} ({currency.name} - {currency.iso_code})
                    </option>
                  );
                })}
              </select>
              {loadingCurrencies && (
                <div className="label">
                  <span className="label-text-alt text-gray-500">Loading currencies...</span>
                </div>
              )}
            </div>

            {/* Proposal Total */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium inline-flex items-center gap-2">
                  Proposal total (ex VAT):
                  {isLocked && <LockClosedIcon className="w-4 h-4 text-base-content/70" title="Locked by payment plan" />}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  className="input input-bordered flex-1"
                  value={formData.proposal_total}
                  onChange={(e) => handleInputChange('proposal_total', parseFloat(e.target.value) || 0)}
                  onFocus={handleInputFocus}
                  required
                  disabled={isLocked}
                />
                {shouldShowVAT && vatAmount > 0 && (
                  <span className="text-sm text-gray-600 whitespace-nowrap">
                    +{vatAmount.toFixed(2)} VAT
                  </span>
                )}
              </div>
              {isLocked && (
                <div className="mt-1 text-xs text-base-content/70">
                  Locked because this lead has a payment plan.
                </div>
              )}
            </div>

            {/* Proposal VAT */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Proposal VAT:</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={formData.proposal_vat}
                onChange={(e) => handleInputChange('proposal_vat', e.target.value)}
                required
                disabled={isLocked}
              >
                {vatOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Subcontractor Fee */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Subcontractor fee:</span>
              </label>
              <input
                type="number"
                step="0.01"
                className="input input-bordered w-full"
                value={formData.subcontractor_fee}
                onChange={(e) => handleInputChange('subcontractor_fee', parseFloat(e.target.value) || 0)}
                onFocus={handleInputFocus}
              />
            </div>

            {/* Subcontractor firm */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Subcontractor firm:</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={formData.external_firm_id}
                onChange={(e) => handleInputChange('external_firm_id', e.target.value)}
                disabled={loadingFirms}
              >
                <option value="">— None —</option>
                {firmOptions.map((firm) => (
                  <option key={firm.id} value={firm.id}>
                    {firm.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Potential Value */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Potential Value:</span>
              </label>
              <input
                type="number"
                step="0.01"
                className="input input-bordered w-full"
                value={formData.potential_value}
                onChange={(e) => handleInputChange('potential_value', parseFloat(e.target.value) || 0)}
                onFocus={handleInputFocus}
              />
            </div>

            {/* Potential Applicants */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Potential applicants:</span>
              </label>
              <input
                type="number"
                min="0"
                className="input input-bordered w-full"
                value={formData.potential_applicants_meeting}
                onChange={(e) => handleInputChange('potential_applicants_meeting', parseInt(e.target.value, 10) || 0)}
                onFocus={handleInputFocus}
              />
            </div>

            {/* Number of Applicants */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Number of applicants:</span>
              </label>
              <input
                type="number"
                min="0"
                className="input input-bordered w-full"
                value={formData.number_of_applicants_meeting}
                onChange={(e) => {
                  const v = e.target.value;
                  handleInputChange(
                    'number_of_applicants_meeting',
                    v === '' ? '' : parseInt(v, 10),
                  );
                }}
                onFocus={handleInputFocus}
                placeholder="Optional"
              />
            </div>
          </div>
            </div>
    </MobileBottomSheet>
  );
};

export default BalanceEditModal;
