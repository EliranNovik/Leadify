import {
  FIRM_CONTRACTS_BUCKET,
  fileNameFromStoragePath,
  openFirmColumnDocument,
  removeFirmColumnDocument,
  uploadFirmColumnDocument,
  type FirmDocumentColumn,
} from './firmColumnDocuments';

export { FIRM_CONTRACTS_BUCKET, fileNameFromStoragePath };

export type FirmContractFieldKey = Extract<FirmDocumentColumn, 'contract' | 'contract_2'>;

export async function uploadFirmContract(
  firmId: string,
  fieldKey: FirmContractFieldKey,
  file: File,
): Promise<string> {
  return uploadFirmColumnDocument(firmId, fieldKey, file);
}

export async function removeFirmContract(
  firmId: string,
  fieldKey: FirmContractFieldKey,
): Promise<void> {
  return removeFirmColumnDocument(firmId, fieldKey);
}

export async function openFirmContract(
  storagePath: string | null | undefined,
  fieldKey: FirmContractFieldKey = storagePath?.includes('/contract_2/')
    ? 'contract_2'
    : 'contract',
): Promise<void> {
  return openFirmColumnDocument(fieldKey, storagePath);
}
