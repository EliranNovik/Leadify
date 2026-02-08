import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon, PencilIcon } from '@heroicons/react/24/outline';

interface PaymentPlan {
  id: string | number;
  duePercent: string | number;
  dueDate: string;
  value: number;
  valueVat: number;
  client: string;
  order: string;
  notes: string;
  currency?: string;
  isLegacy?: boolean;
}

interface EditPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (paymentData: any, includeVat: boolean) => Promise<void>;
  payment: PaymentPlan | null;
  isSaving?: boolean;
  availableContacts?: Array<{ name: string; isMain: boolean; id?: number }>;
  availableCurrencies?: Array<{ id: number; name: string; iso_code: string }>;
}

// Helper function to detect Hebrew text and return RTL direction
const getTextDirection = (text: string): 'rtl' | 'ltr' => {
  if (!text) return 'ltr';
  // Check if text contains Hebrew characters (Unicode range 0590-05FF)
  const hebrewRegex = /[\u0590-\u05FF]/;
  return hebrewRegex.test(text) ? 'rtl' : 'ltr';
};

const EditPaymentModal: React.FC<EditPaymentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  payment,
  isSaving = false,
  availableContacts = [],
  availableCurrencies = []
}) => {
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [editPaymentIncludeVat, setEditPaymentIncludeVat] = useState<boolean>(true);
  const [editingValueVatId, setEditingValueVatId] = useState<string | number | null>(null);
  const [notesDirection, setNotesDirection] = useState<'rtl' | 'ltr'>('ltr');

  // Initialize form data when payment changes
  useEffect(() => {
    if (payment) {
      setEditPaymentData({ ...payment });
      setEditPaymentIncludeVat((payment.valueVat || 0) > 0);
      setEditingValueVatId(null);
      setNotesDirection(getTextDirection(payment.notes || ''));
    }
  }, [payment]);

  // Update notes direction when notes change
  useEffect(() => {
    setNotesDirection(getTextDirection(editPaymentData.notes || ''));
  }, [editPaymentData.notes]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEditPaymentData({});
      setEditPaymentIncludeVat(true);
      setEditingValueVatId(null);
    }
  }, [isOpen]);

  if (!isOpen || !payment) return null;

  const handleValueChange = (newValue: number) => {
    const currency = editPaymentData.currency || payment.currency || '₪';
    // Recalculate VAT based on checkbox state: 18% if includeVat is checked, 0 otherwise
    const newValueVat = editPaymentIncludeVat ? Math.round(newValue * 0.18 * 100) / 100 : 0;
    setEditPaymentData((d: any) => ({
      ...d,
      value: newValue,
      valueVat: newValueVat,
      currency: currency
    }));
  };

  const handleVatCheckboxChange = (includeVat: boolean) => {
    setEditPaymentIncludeVat(includeVat);
    // Apply VAT if checkbox is checked, regardless of currency
    const newValueVat = includeVat ? Math.round(Number(editPaymentData.value || 0) * 0.18 * 100) / 100 : 0;
    setEditPaymentData((d: any) => ({ ...d, valueVat: newValueVat }));
  };

  const handleSave = async () => {
    await onSave(editPaymentData, editPaymentIncludeVat);
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

  const totalAmount = (editPaymentData.value || 0) + (editPaymentData.valueVat || 0);

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
          <h2 className="text-2xl font-bold text-gray-900">Edit Payment</h2>
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
              <span className="text-lg font-bold text-gray-500">{getCurrencySymbol(editPaymentData.currency || payment.currency)}</span>
              <input
                type="number"
                className="input input-bordered flex-1 text-right font-bold no-arrows"
                value={editPaymentData.value || ''}
                onChange={(e) => handleValueChange(Number(e.target.value) || 0)}
                placeholder="0.00"
                step="0.01"
              />
              <span className="text-gray-500 font-bold">+</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className={`input input-bordered w-24 text-right font-bold no-arrows ${editingValueVatId === payment.id ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
                  value={editPaymentData.valueVat || 0}
                  readOnly={editingValueVatId !== payment.id}
                  onChange={editingValueVatId === payment.id ? (e) => setEditPaymentData((d: any) => ({ ...d, valueVat: Number(e.target.value) || 0 })) : undefined}
                  title={editingValueVatId !== payment.id ? 'Click pencil icon to manually edit VAT' : ''}
                  step="0.01"
                />
                {editingValueVatId === payment.id ? (
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
                    onClick={() => setEditingValueVatId(payment.id)} 
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
                  checked={editPaymentIncludeVat}
                  onChange={(e) => handleVatCheckboxChange(e.target.checked)}
                />
                <span className="label-text">Include VAT (18%)</span>
              </label>
            </div>
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-semibold">Total: </span>
              <span className="font-bold text-lg">
                {getCurrencySymbol(editPaymentData.currency || payment.currency)}{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Currency */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Currency</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={editPaymentData.currency || payment.currency || '₪'}
              onChange={e => {
                const selectedCurrency = e.target.value;
                const currency = selectedCurrency;
                // Recalculate VAT based on checkbox state when currency changes
                const newValueVat = editPaymentIncludeVat ? Math.round(Number(editPaymentData.value || 0) * 0.18 * 100) / 100 : 0;
                setEditPaymentData((d: any) => ({
                  ...d,
                  currency: currency,
                  valueVat: newValueVat
                }));
              }}
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
              value={editPaymentData.order || 'Intermediate Payment'}
              onChange={e => setEditPaymentData((d: any) => ({ ...d, order: e.target.value }))}
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
              value={editPaymentData.notes || ''}
              onChange={e => setEditPaymentData((d: any) => ({ ...d, notes: e.target.value }))}
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
            disabled={isSaving}
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

export default EditPaymentModal;
