import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AGREEMENT_NOT_SIGNED_EVENT,
  describeInvoiceAgreementBlock,
  type InvoiceAgreementBlock,
} from '../../lib/invoiceAgreementGuard';

type AgreementNotSignedModalProps = {
  open: boolean;
  stageName?: string | null;
  onClose: () => void;
};

export default function AgreementNotSignedModal({
  open,
  stageName,
  onClose,
}: AgreementNotSignedModalProps) {
  if (!open || typeof document === 'undefined') return null;

  const stageLabel = stageName?.trim() || 'an earlier stage';

  return createPortal(
    <div className="modal modal-open z-[400]">
      <div className="modal-box max-w-lg">
        <h3 className="text-xl font-bold text-gray-900">The client has not signed the agreement yet</h3>
        <p className="mt-1 text-sm text-gray-600">
          This lead is still at <span className="font-medium text-gray-800">{stageLabel}</span>, so no invoice can be sent.
        </p>
        <p className="mt-3 text-sm text-gray-600">Before sending the invoice, either:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-gray-600">
          <li>
            upload the physically signed agreement and update the system so the lead moves to{' '}
            <span className="font-medium text-gray-800">Client signed agreement</span>, or
          </li>
          <li>have the client sign the agreement first.</li>
        </ul>
        <div className="modal-action">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" aria-label="Close" onClick={onClose} />
    </div>,
    document.body,
  );
}

export type InvoiceLeadRef = {
  leadId: string | number | null | undefined;
  isLegacy: boolean;
};

/** Shared prompt for every screen that can send a client invoice. */
export function useAgreementNotSignedPrompt() {
  const [state, setState] = useState<{ open: boolean; stageName: string }>({
    open: false,
    stageName: '',
  });

  const showBlocked = useCallback((stageName?: string) => {
    setState({ open: true, stageName: stageName?.trim() || '' });
  }, []);

  const blockIfUnsigned = useCallback(async (leads: InvoiceLeadRef[]): Promise<boolean> => {
    const seen = new Set<string>();
    let firstBlock: InvoiceAgreementBlock | null = null;

    for (const lead of leads) {
      if (lead.leadId == null || String(lead.leadId).trim() === '') {
        firstBlock = { blocked: true, stageName: '' };
        break;
      }
      const key = `${lead.isLegacy ? 'legacy' : 'new'}:${String(lead.leadId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = await describeInvoiceAgreementBlock(lead.leadId, lead.isLegacy);
      if (result.blocked) {
        firstBlock = result;
        break;
      }
    }

    if (!firstBlock) return false;
    setState({ open: true, stageName: firstBlock.stageName });
    return true;
  }, []);

  const modal = (
    <AgreementNotSignedModal
      open={state.open}
      stageName={state.stageName}
      onClose={() => setState({ open: false, stageName: '' })}
    />
  );

  return { blockIfUnsigned, showBlocked, modal };
}

/** One dialog for the whole app, opened when a payment link is refused. */
export function AgreementNotSignedHost() {
  const { showBlocked, modal } = useAgreementNotSignedPrompt();

  useEffect(() => {
    const onBlocked = (event: Event) => {
      const stageName = (event as CustomEvent<{ stageName?: string }>).detail?.stageName;
      showBlocked(stageName);
    };
    window.addEventListener(AGREEMENT_NOT_SIGNED_EVENT, onBlocked);
    return () => window.removeEventListener(AGREEMENT_NOT_SIGNED_EVENT, onBlocked);
  }, [showBlocked]);

  return modal;
}
