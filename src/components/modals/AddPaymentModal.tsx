import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon, PencilIcon } from '@heroicons/react/24/outline';

interface AddPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (paymentData: any, includeVat: boolean) => Promise<void>;
  isSaving?: boolean;
  contactName: string;
  availableCurrencies?: Array<{ id: number; name: string; iso_code: string }>;
  defaultCurrency?: string;
  defaultAmount?: number;
  onValueChange?: (value: number) => void; // Callback to calculate due percent
  getTotalAmount?: () => number; // Function to get total amount for percentage calculation
}

// Helper function to detect Hebrew text and return RTL direction
const getTextDirection = (text: string): 'rtl' | 'ltr' => {
  if (!text) return 'ltr';
  // Check if text contains Hebrew characters (Unicode range 0590-05FF)
  const hebrewRegex = /[\u0590-\u05FF]/;
  return hebrewRegex.test(text) ? 'rtl' : 'ltr';
};

const AddPaymentModal: React.FC<AddPaymentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  isSaving = false,
  contactName,
  availableCurrencies = [],
  defaultCurrency = '₪',
  defaultAmount = 0,
  onValueChange,
  getTotalAmount
}) => {
  const [newPaymentData, setNewPaymentData] = useState<any>({
    dueDate: '',
    value: defaultAmount ? String(defaultAmount) : '',
    duePercent: defaultAmount > 0 ? '100' : '',
    paymentOrder: 'Intermediate Payment',
    client: contactName,
    notes: '',
    currency: defaultCurrency,
    includeVat: true,
    valueVat: 0,
    currencyId: defaultCurrency === '₪' ? 1 : defaultCurrency === '€' ? 2 : defaultCurrency === '$' ? 3 : defaultCurrency === '£' ? 4 : 1,
  });
  const [editingValueVatId, setEditingValueVatId] = useState<string | number | null>(null);
  const [notesDirection, setNotesDirection] = useState<'rtl' | 'ltr'>('ltr');

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setNewPaymentData({
        dueDate: '',
        value: defaultAmount ? String(defaultAmount) : '',
        duePercent: defaultAmount > 0 ? '100' : '',
        paymentOrder: 'Intermediate Payment',
        client: contactName,
        notes: '',
        currency: defaultCurrency,
        includeVat: true,
        valueVat: 0,
        currencyId: defaultCurrency === '₪' ? 1 : defaultCurrency === '€' ? 2 : defaultCurrency === '$' ? 3 : defaultCurrency === '£' ? 4 : 1,
      });
      setEditingValueVatId(null);
      setNotesDirection('ltr');
    }
  }, [isOpen, contactName, defaultCurrency, defaultAmount]);

  // Update notes direction when notes change
  useEffect(() => {
    setNotesDirection(getTextDirection(newPaymentData.notes || ''));
  }, [newPaymentData.notes]);

  if (!isOpen) return null;

  const handleValueChange = (newValue: number) => {
    const currency = newPaymentData.currency || defaultCurrency;
    const includeVat = newPaymentData.includeVat !== false;
    let vat = 0;
    if (includeVat) {
      vat = Math.round(newValue * 0.18 * 100) / 100;
    }

    // Calculate due percentage based on value vs total column
    let duePercent = newPaymentData.duePercent;
    if (getTotalAmount && getTotalAmount() > 0) {
      duePercent = Math.round((newValue / getTotalAmount()) * 100).toString();
    }

    setNewPaymentData((d: any) => ({
      ...d,
      value: String(newValue),
      valueVat: vat,
      duePercent
    }));

    // Call callback if provided
    if (onValueChange) {
      onValueChange(newValue);
    }
  };

  const handleCurrencyChange = (selectedCurrency: string) => {
    const selectedCurrencyData = availableCurrencies.find(c => c.name === selectedCurrency);
    let vat = 0;
    const includeVat = newPaymentData.includeVat !== false;
    if (includeVat) {
      vat = Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100;
    }
    setNewPaymentData((d: any) => ({
      ...d,
      currency: selectedCurrency,
      currencyId: selectedCurrencyData?.id || 1,
      includeVat: d.includeVat !== false,
      valueVat: vat
    }));
  };

  const handleVatCheckboxChange = (includeVat: boolean) => {
    let vat = 0;
    if (includeVat) {
      vat = Math.round(Number(newPaymentData.value || 0) * 0.18 * 100) / 100;
    }
    setNewPaymentData((d: any) => ({ ...d, includeVat, valueVat: vat }));
  };

  const handleSave = async () => {
    if (!newPaymentData.value) {
      return;
    }
    // Set default duePercent to 100 if not provided
    const paymentDataWithDuePercent = {
      ...newPaymentData,
      duePercent: newPaymentData.duePercent || '100'
    };
    await onSave(paymentDataWithDuePercent, newPaymentData.includeVat !== false);
  };

  const getCurrencySymbol = (currency?: string): string => {
    if (!currency) return '₪';
    const symbols: { [key: string]: string } = {
      'ILS': '₪',
      'NIS': '₪',
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'CAD': 'C$',
      'AUD': 'A$'
    };
    return symbols[currency.toUpperCase()] || currency;
  };

  const totalAmount = (Number(newPaymentData.value || 0) + Number(newPaymentData.valueVat || 0));

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? '' : 'hidden'}`}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Add New Payment</h2>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost text-gray-600 hover:bg-gray-100"
            disabled={isSaving}
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Value and VAT */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Value</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-gray-500">{getCurrencySymbol(newPaymentData.currency || defaultCurrency)}</span>
              <input
                type="number"
                className="input input-bordered flex-1 text-right font-bold no-arrows"
                value={newPaymentData.value || ''}
                onChange={(e) => handleValueChange(Number(e.target.value) || 0)}
                placeholder="0.00"
                step="0.01"
              />
              <span className="text-gray-500 font-bold">+</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className={`input input-bordered w-24 text-right font-bold no-arrows ${editingValueVatId === 'new' ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                  value={newPaymentData.valueVat || 0}
                  readOnly={editingValueVatId !== 'new'}
                  onChange={editingValueVatId === 'new' ? (e) => setNewPaymentData((d: any) => ({ ...d, valueVat: Number(e.target.value) || 0 })) : undefined}
                  title={editingValueVatId !== 'new' ? 'Click pencil icon to manually edit VAT' : ''}
                  step="0.01"
                />
                {editingValueVatId === 'new' ? (
                  <button 
                    className="btn btn-xs btn-ghost" 
                    onClick={() => setEditingValueVatId(null)} 
                    title="Done editing VAT manually"
                  >
                    <CheckIcon className="w-4 h-4 text-green-600" />
                  </button>
                ) : (
                  <button 
                    className="btn btn-xs btn-ghost" 
                    onClick={() => setEditingValueVatId('new')} 
                    title="Manually edit VAT (overrides auto-calculation)"
                  >
                    <PencilIcon className="w-4 h-4 text-blue-600" />
                  </button>
                )}
              </div>
              <label className="label cursor-pointer gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={newPaymentData.includeVat !== false}
                  onChange={(e) => handleVatCheckboxChange(e.target.checked)}
                />
                <span className="label-text">Include VAT (18%)</span>
              </label>
            </div>
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-semibold">Total: </span>
              <span className="font-bold text-lg">
                {getCurrencySymbol(newPaymentData.currency || defaultCurrency)}{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Due Date */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Due Date</span>
            </label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={newPaymentData.dueDate || ''}
              onChange={e => setNewPaymentData((d: any) => ({ ...d, dueDate: e.target.value }))}
            />
          </div>

          {/* Currency */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Currency</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={newPaymentData.currency || defaultCurrency}
              onChange={e => handleCurrencyChange(e.target.value)}
            >
              {availableCurrencies.length === 0 ? (
                <>
                  <option value="₪">₪ (ILS)</option>
                  <option value="€">€ (EUR)</option>
                  <option value="$">$ (USD)</option>
                  <option value="£">£ (GBP)</option>
                </>
              ) : (
                availableCurrencies.map((curr) => (
                  <option key={curr.id} value={curr.name}>
                    {curr.name} ({curr.iso_code})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Order */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Order</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={newPaymentData.paymentOrder || 'Intermediate Payment'}
              onChange={e => setNewPaymentData((d: any) => ({ ...d, paymentOrder: e.target.value }))}
            >
              <option value="First Payment">First Payment</option>
              <option value="Intermediate Payment">Intermediate Payment</option>
              <option value="Final Payment">Final Payment</option>
              <option value="Single Payment">Single Payment</option>
              <option value="Expense (no VAT)">Expense (no VAT)</option>
            </select>
          </div>

          {/* Notes */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Notes</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full h-24"
              value={newPaymentData.notes || ''}
              onChange={e => setNewPaymentData((d: any) => ({ ...d, notes: e.target.value }))}
              placeholder="Enter notes (optional)"
              dir={notesDirection}
              style={{ textAlign: notesDirection === 'rtl' ? 'right' : 'left' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-2xl flex justify-end gap-3 border-t">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
            disabled={isSaving || !newPaymentData.value}
          >
            {isSaving ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Saving...
              </>
            ) : (
              <>
                <CheckIcon className="w-5 h-5" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddPaymentModal;
