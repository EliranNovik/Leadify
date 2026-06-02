import React from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { openFirmInvoiceDocument, type FirmInvoiceDoc } from '../../lib/firmManagementCosts';

const FirmInvoiceDocumentsCell: React.FC<{ invoices: FirmInvoiceDoc[] }> = ({ invoices }) => {
  const withFiles = invoices.filter(inv => inv.storage_path?.trim() && inv.file_name?.trim());

  if (withFiles.length === 0) {
    const hasInvoiceRow = invoices.length > 0;
    return (
      <span className="text-sm text-base-content/40">
        {hasInvoiceRow ? 'No file' : '—'}
      </span>
    );
  }

  if (withFiles.length === 1) {
    const inv = withFiles[0];
    return (
      <button
        type="button"
        className="link link-primary text-sm inline-flex items-center gap-1 max-w-[14rem] truncate"
        title={inv.file_name || 'Open invoice'}
        onClick={e => {
          e.stopPropagation();
          void openFirmInvoiceDocument(inv);
        }}
      >
        <DocumentTextIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{inv.file_name}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      {withFiles.map(inv => (
        <button
          key={inv.id}
          type="button"
          className="link link-primary text-sm inline-flex items-center gap-1 max-w-[14rem] truncate"
          title={inv.file_name || 'Open invoice'}
          onClick={e => {
            e.stopPropagation();
            void openFirmInvoiceDocument(inv);
          }}
        >
          <DocumentTextIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{inv.file_name}</span>
        </button>
      ))}
    </div>
  );
};

export default FirmInvoiceDocumentsCell;
