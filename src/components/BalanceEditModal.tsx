import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { convertToNIS } from '../lib/currencyConversion';

interface BalanceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedClient: any;
  onUpdate: (clientId?: string | number) => Promise<void>;
}

const BalanceEditModal: React.FC<BalanceEditModalProps> = ({
  isOpen,
  onClose,
  selectedClient,
  onUpdate
}) => {
  const [formData, setFormData] = useState({
    currencyId: '', // Store currency ID instead of symbol
    currency: '', // Will be computed from ID
    proposal_total: 0,
    proposal_vat: '',
    subcontractor_fee: 0,
    potential_value: 0,
    number_of_applicants_meeting: 1,
    vat_value: 0
  });
  const [loading, setLoading] = useState(false);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);
  const initializedForClientRef = useRef<string | null>(null);

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
    }
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

    // Check if we've already initialized for this client
    if (initializedForClientRef.current === clientId) {
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
      
      // For legacy leads, explicitly fetch subcontractor_fee from database
      if (isLegacyLead) {
        const legacyId = parseInt(clientId.replace('legacy_', ''));
        try {
          const { data: feeData, error: feeError } = await supabase
            .from('leads_lead')
            .select('subcontractor_fee')
            .eq('id', legacyId)
            .single();
          
          if (!feeError && feeData && feeData.subcontractor_fee !== null && feeData.subcontractor_fee !== undefined) {
            subcontractorFeeValue = Number(feeData.subcontractor_fee);
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
      } else {
        proposalTotalValue = Number(selectedClient.balance || selectedClient.proposal_total || 0);
        subcontractorFeeValue = Number(selectedClient.subcontractor_fee ?? 0);
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
        selectedClientKeys: Object.keys(selectedClient)
      });
      
      setFormData({
        currencyId: currencyId,
        currency: '', // Will be computed from currencyId when needed
        proposal_total: proposalTotalValue,
        proposal_vat: vatStatus,
        subcontractor_fee: subcontractorFeeValue,
        potential_value: selectedClient.potential_value || selectedClient.potential_total || 0,
        number_of_applicants_meeting: selectedClient.number_of_applicants_meeting || 1,
        vat_value: selectedClient.vat_value || 0
      });

      // Mark as initialized for this client
      initializedForClientRef.current = clientId;
    };
    
    initializeFormData();
  }, [isOpen, selectedClient?.id, currencies.length, loadingCurrencies]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Handle input focus to select all text for any number value
  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Select all text if the field contains any number value
    if (e.target.value && !isNaN(Number(e.target.value))) {
      e.target.select();
    }
  };

  const calculateVAT = () => {
    // Only calculate VAT if it's included or if VAT should be displayed
    // For new leads, we check the 'vat' column value
    const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
    const shouldShowVAT = isLegacyLead 
      ? formData.proposal_vat === 'included'
      : formData.proposal_vat === 'included';
    
    if (!shouldShowVAT) {
      return 0;
    }
    
    if (formData.proposal_vat === 'included') {
      // If VAT is included, calculate the VAT amount
      const totalWithVAT = formData.proposal_total;
      const baseAmount = totalWithVAT / 1.18; // Assuming 18% VAT
      const vatAmount = totalWithVAT - baseAmount;
      return Math.round(vatAmount * 100) / 100;
    } else {
      // If VAT is excluded, calculate VAT on top
      const vatAmount = formData.proposal_total * 0.18; // Assuming 18% VAT
      return Math.round(vatAmount * 100) / 100;
    }
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
      
      if (isLegacyLead) {
        // For legacy leads, use the currency ID directly from formData.currencyId
        const currencyId = parseInt(formData.currencyId, 10) || 1; // Default to ID 1 if not found
        
        // Update legacy lead in leads_lead table
        // Map proposal_vat to 'vat' column (text): 'included' → 'true', 'excluded' → 'false' (same as new leads)
        const vatColumnValue = formData.proposal_vat === 'included' ? 'true' : 'false';
        
        // For legacy leads: if currency_id is 1 (NIS/ILS), save to total_base; otherwise save to total and convert to NIS for total_base
        const updateData: any = {
          currency_id: currencyId,
          no_of_applicants: formData.number_of_applicants_meeting,
          potential_total: formData.potential_value.toString(),
          vat: vatColumnValue, // Save VAT status in 'vat' column for legacy leads
          subcontractor_fee: Number(formData.subcontractor_fee) || 0 // Always save subcontractor_fee as a number
        };
        
        // Save logic for legacy leads:
        // If currency_id is 1 (NIS): Save only to total_base
        // If currency_id is other than 1: Save to total, and calculate NIS equivalent and save to total_base
        if (currencyId === 1) {
          // For NIS (currency_id = 1), save only to total_base
          updateData.total_base = Number(formData.proposal_total) || 0;
          // Note: We don't set total here - it will preserve the existing value if it exists from a previous currency
        } else {
          // For other currencies, save the amount to total
          updateData.total = Number(formData.proposal_total) || 0;
          // Calculate NIS equivalent and save to total_base
          const nisAmount = convertToNIS(formData.proposal_total, currencyId);
          updateData.total_base = nisAmount;
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
          .select('id, total, total_base, subcontractor_fee, currency_id, master_id');

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
          balance: formData.proposal_total,
          currency_id: currencyId, // Save currency ID (like legacy leads)
          proposal_total: formData.proposal_total,
          subcontractor_fee: formData.subcontractor_fee,
          potential_total: formData.potential_value,
          number_of_applicants_meeting: formData.number_of_applicants_meeting,
          vat_value: calculateVAT(),
          vat: vatColumnValue
        };
        
        console.log('📤 Update payload being sent to database:', updateData);
        
        const { data, error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedClient.id)
          .select('id, currency_id, balance'); // Select back to verify

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

  const vatAmount = calculateVAT();
  // Only show VAT if it's included (for new leads, this means vat column is 'true')
  const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
  const shouldShowVAT = isLegacyLead 
    ? formData.proposal_vat === 'included'
    : formData.proposal_vat === 'included';
  
  const totalWithVAT = formData.proposal_vat === 'included' 
    ? formData.proposal_total 
    : formData.proposal_total + (shouldShowVAT ? vatAmount : 0);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
          <div className="fixed right-0 top-0 h-full w-full md:w-96 bg-white shadow-xl transform transition-transform duration-300 ease-in-out">
            <div className="p-6 h-full overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold">Update Lead</h3>
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>


        <form onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}>
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
                disabled={loadingCurrencies}
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
                <span className="label-text font-medium">Proposal Total:</span>
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
                />
                {shouldShowVAT && vatAmount > 0 && (
                  <span className="text-sm text-gray-600 whitespace-nowrap">
                    {formData.proposal_vat === 'included' ? 'incl.' : '+'}{vatAmount.toFixed(2)} VAT
                  </span>
                )}
              </div>
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

            {/* Number of Applicants */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Number of applicants:</span>
              </label>
              <input
                type="number"
                min="1"
                className="input input-bordered w-full"
                value={formData.number_of_applicants_meeting}
                onChange={(e) => handleInputChange('number_of_applicants_meeting', parseInt(e.target.value) || 1)}
                onFocus={handleInputFocus}
                required
              />
            </div>
          </div>


          {/* Action Buttons */}
          <div className="modal-action">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
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
        </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BalanceEditModal;
