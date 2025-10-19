import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

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
    currency: '',
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
    { value: 'excluded', label: 'VAT excluded' },
    { value: 'included', label: 'VAT included' }
  ];

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

  useEffect(() => {
    if (isOpen) {
      fetchCurrencies();
      
      if (selectedClient) {
        setFormData({
          currency: selectedClient.balance_currency || selectedClient.proposal_currency || selectedClient.currency || '₪',
          proposal_total: selectedClient.balance || selectedClient.proposal_total || selectedClient.total || 0,
          proposal_vat: selectedClient.proposal_vat || 'excluded',
          subcontractor_fee: selectedClient.subcontractor_fee ?? 0, // Use nullish coalescing to handle null/undefined
          potential_value: selectedClient.potential_value || selectedClient.potential_total || 0,
          number_of_applicants_meeting: selectedClient.number_of_applicants_meeting || 1,
          vat_value: selectedClient.vat_value || 0
        });
      }
    }
  }, [isOpen, selectedClient]);

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

    setLoading(true);
    try {
      const isLegacyLead = selectedClient.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // Find the currency ID from the currency symbol
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
        
        const selectedCurrency = currencies.find(c => getSymbolFromISO(c.iso_code) === formData.currency);
        const currencyId = selectedCurrency?.id || 1; // Default to ID 1 if not found
        
        // Update legacy lead in leads_lead table
        const { error } = await supabase
          .from('leads_lead')
          .update({
            total: formData.proposal_total,
            currency_id: currencyId,
            no_of_applicants: formData.number_of_applicants_meeting,
            subcontractor_fee: formData.subcontractor_fee,
            potential_total: formData.potential_value.toString()
          })
          .eq('id', selectedClient.id.toString().replace('legacy_', ''));

        if (error) throw error;
      } else {
        // Update new lead in leads table
        const { error } = await supabase
          .from('leads')
          .update({
            balance: formData.proposal_total,
            balance_currency: formData.currency,
            proposal_currency: formData.currency,
            proposal_total: formData.proposal_total,
            subcontractor_fee: formData.subcontractor_fee,
            potential_total: formData.potential_value,
            number_of_applicants_meeting: formData.number_of_applicants_meeting,
            vat_value: calculateVAT()
          })
          .eq('id', selectedClient.id);

        if (error) throw error;
      }

      toast.success('Balance updated successfully!');
      await onUpdate(selectedClient.id);
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
  const totalWithVAT = formData.proposal_vat === 'included' 
    ? formData.proposal_total 
    : formData.proposal_total + vatAmount;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
          <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl transform transition-transform duration-300 ease-in-out">
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
                value={formData.currency}
                onChange={(e) => handleInputChange('currency', e.target.value)}
                required
                disabled={loadingCurrencies}
              >
                <option value="">Select currency...</option>
                {currencies.map(currency => {
                  // Map ISO codes to symbols
                  const getSymbol = (isoCode: string) => {
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
                  const symbol = getSymbol(currency.iso_code);
                  return (
                    <option key={currency.id} value={symbol}>
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
                {vatAmount > 0 && (
                  <span className="text-sm text-gray-600 whitespace-nowrap">
                    +{vatAmount.toFixed(2)} VAT
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
