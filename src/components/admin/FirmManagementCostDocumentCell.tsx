import React from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import {
  fileNameFromStoragePath,
  openFirmManagementCostDocument,
  type FirmManagementCostDocColumn,
  type FirmManagementCostDocument,
} from '../../lib/firmManagementCostDocuments';

const FirmManagementCostDocumentCell: React.FC<{
  storagePath?: string | null;
  column: FirmManagementCostDocColumn;
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
        void openFirmManagementCostDocument(column, path);
      }}
    >
      <DocumentTextIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
};

export const FirmManagementCostDocumentsCell: React.FC<{
  documents: FirmManagementCostDocument[];
  column: FirmManagementCostDocColumn;
  linkLabel?: string;
}> = ({ documents, column, linkLabel }) => {
  const withFiles = documents.filter(
    doc => doc.storage_path?.trim() && (doc.file_name?.trim() || doc.storage_path?.trim()),
  );

  if (withFiles.length === 0) {
    return <span className="text-sm text-base-content/40">—</span>;
  }

  if (withFiles.length === 1) {
    const doc = withFiles[0];
    const label = doc.file_name?.trim() || fileNameFromStoragePath(doc.storage_path) || linkLabel || 'Document';
    return (
      <button
        type="button"
        className="link link-primary text-sm inline-flex items-center gap-1 max-w-[14rem] truncate"
        title={label}
        onClick={e => {
          e.stopPropagation();
          void openFirmManagementCostDocument(column, doc.storage_path);
        }}
      >
        <DocumentTextIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      {withFiles.map(doc => {
        const label =
          doc.file_name?.trim() || fileNameFromStoragePath(doc.storage_path) || linkLabel || 'Document';
        return (
          <button
            key={doc.id}
            type="button"
            className="link link-primary text-sm inline-flex items-center gap-1 max-w-[14rem] truncate"
            title={label}
            onClick={e => {
              e.stopPropagation();
              void openFirmManagementCostDocument(column, doc.storage_path);
            }}
          >
            <DocumentTextIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default FirmManagementCostDocumentCell;
