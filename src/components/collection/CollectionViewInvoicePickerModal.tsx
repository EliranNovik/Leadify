import React from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, DocumentTextIcon, UserIcon } from '@heroicons/react/24/outline';
import type { CollectionInvoicePickerOption } from '../../lib/collectionFinancesRowActions';

type Props = {
  isOpen: boolean;
  loading: boolean;
  options: CollectionInvoicePickerOption[];
  onClose: () => void;
  onSelect: (option: CollectionInvoicePickerOption) => void;
  formatAmount: (value: number, currency: string) => string;
};

const CollectionViewInvoicePickerModal: React.FC<Props> = ({
  isOpen,
  loading,
  options,
  onClose,
  onSelect,
  formatAmount,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <DocumentTextIcon className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">View invoice</h2>
              <p className="text-sm text-gray-500">Choose which proforma to open</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg" />
            </div>
          ) : options.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No invoices found</div>
          ) : (
            <div className="space-y-3">
              {options.map((option) => (
                <button
                  key={option.rowId}
                  type="button"
                  onClick={() => onSelect(option)}
                  className="w-full p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserIcon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{option.contactName}</p>
                      {option.contactEmail ? (
                        <p className="text-sm text-gray-500 truncate mt-0.5">{option.contactEmail}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                        <span className="font-medium text-gray-800">
                          {option.leadNumber ? `#${option.leadNumber.replace(/^#/, '')}` : option.leadName}
                        </span>
                        {option.orderLabel ? <span>{option.orderLabel}</span> : null}
                        <span className="font-semibold text-gray-900">
                          {formatAmount(option.amount, option.currency)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                        {option.proformaDate ? <span>Proforma: {option.proformaDate}</span> : null}
                        <span>{option.collected ? 'Collected' : 'Not collected'}</span>
                      </div>
                    </div>
                    <DocumentTextIcon className="w-5 h-5 text-primary shrink-0 mt-1" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CollectionViewInvoicePickerModal;
