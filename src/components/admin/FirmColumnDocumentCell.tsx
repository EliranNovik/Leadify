import React from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import {
  fileNameFromStoragePath,
  openFirmColumnDocument,
  type FirmDocumentColumn,
} from '../../lib/firmColumnDocuments';

const FirmColumnDocumentCell: React.FC<{
  storagePath?: string | null;
  column: FirmDocumentColumn;
  linkLabel?: string;
}> = ({ storagePath, column, linkLabel }) => {
  const path = storagePath?.trim();
  if (!path) {
    return <span className="text-sm text-base-content/40">—</span>;
  }

  const label = fileNameFromStoragePath(path) || linkLabel || 'Document';
  return (
    <button
      type="button"
      className="link link-primary text-sm inline-flex items-center gap-1 max-w-[14rem] truncate"
      title={label}
      onClick={e => {
        e.stopPropagation();
        void openFirmColumnDocument(column, path);
      }}
    >
      <DocumentTextIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
};

export default FirmColumnDocumentCell;
