import { useMemo } from 'react';
import { DocumentShareMenu } from '../share/DocumentShareMenu';
import type { DocumentShareLocator } from '../../lib/documentShares';
import type { DocumentShareTarget } from '../../lib/documentShareTargets';
import { EMAIL_ATTACHMENTS_STORAGE_BUCKET } from '../../lib/leadEmailAttachments';
import { fullScanPreviewUrl } from '../../lib/smartScan/scanCenterInbox';
import { buildScanShareMessage, scanDocumentLabel, scanShareFilename } from '../../lib/smartScan/smartScanShareMessage';
import type { SmartScanItem } from '../../lib/smartScan/smartScanTypes';

type Props = {
  item: SmartScanItem;
  disabled?: boolean;
};

/**
 * Where this scan's bytes live, in the form the share row stores and the resolver understands.
 *
 * Without a stored file of its own — a split part, or an attachment not yet copied to storage — the
 * parent scan is the only thing that can serve bytes, which is why its id wins over the item's.
 */
function locatorFor(item: SmartScanItem): DocumentShareLocator {
  return {
    storageBucket: item.storagePath ? EMAIL_ATTACHMENTS_STORAGE_BUCKET : null,
    storagePath: item.storagePath ?? null,
    scanDocumentId: item.parentDocumentId ?? item.scanDocumentId ?? null,
  };
}

/** A scan, described the way the shared share menu wants a document described. */
export function smartScanShareTarget(item: SmartScanItem): DocumentShareTarget {
  return {
    locator: locatorFor(item),
    fallbackUrl: fullScanPreviewUrl(item),
    fileName: scanShareFilename(item),
    documentType: scanDocumentLabel(item),
    contentType: item.contentType ?? null,
    leadNumber: item.lead?.leadNumber ?? null,
    leadName: item.lead?.name ?? null,
    message: (senderName) => buildScanShareMessage(item, senderName),
  };
}

export function SmartScanShareMenu({ item, disabled }: Props) {
  const target = useMemo(() => smartScanShareTarget(item), [item]);
  return <DocumentShareMenu target={target} disabled={disabled} />;
}
