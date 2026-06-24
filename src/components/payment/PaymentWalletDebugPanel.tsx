import React, { useEffect, useState } from 'react';
import {
  runPelecardWalletDiagnostics,
  type PelecardWalletDiagnostics,
} from '../../lib/pelecardWalletDiagnostics';
import { getPelecardPaymentsApiBase } from '../../lib/pelecardPaymentApi';

type ServerWalletProbe = {
  sandboxMode?: boolean;
  terminal?: string | null;
  walletProbe?: {
    pelecardWalletsLikelyEnabled?: boolean;
    applePayMentioned?: boolean;
    googlePayMentioned?: boolean;
    interpretation?: string;
    pelecardPaymentScripts?: string[];
  } | null;
};

interface PaymentWalletDebugPanelProps {
  paymentUrl: string | null;
}

function statusBadge(ok: boolean | null | undefined) {
  if (ok === true) return <span className="badge badge-success badge-sm">OK</span>;
  if (ok === false) return <span className="badge badge-error badge-sm">No</span>;
  return <span className="badge badge-ghost badge-sm">—</span>;
}

const PaymentWalletDebugPanel: React.FC<PaymentWalletDebugPanelProps> = ({ paymentUrl }) => {
  const [client, setClient] = useState<PelecardWalletDiagnostics | null>(null);
  const [server, setServer] = useState<ServerWalletProbe | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runPelecardWalletDiagnostics().then(setClient);
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const base = getPelecardPaymentsApiBase();
    void fetch(`${base}/checkout-css-info`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setServer(data);
        setServerError(null);
      })
      .catch((err) => {
        setServerError(err instanceof Error ? err.message : 'Failed to load server probe');
      });
  }, []);

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-3 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-lg rounded-xl border border-amber-300 bg-amber-50 shadow-lg text-xs text-gray-800 max-h-[45vh] overflow-y-auto">
        <div className="sticky top-0 bg-amber-100 border-b border-amber-200 px-3 py-2 font-semibold">
          Wallet debug (`?walletDebug=1`)
        </div>
        <div className="px-3 py-2 space-y-3">
          <section>
            <p className="font-medium mb-1">This device (parent page)</p>
            <ul className="space-y-1">
              <li className="flex justify-between gap-2">
                <span>Apple domain file</span>
                {statusBadge(client?.domainAssociationFile.ok)}
              </li>
              <li className="flex justify-between gap-2">
                <span>ClientSecureV2 loaded</span>
                {statusBadge(client?.clientSecureScriptPresent)}
              </li>
              <li className="flex justify-between gap-2">
                <span>ApplePaySession API</span>
                {statusBadge(client?.applePayApiAvailable)}
              </li>
              <li className="flex justify-between gap-2">
                <span>Can make Apple Pay payments</span>
                {statusBadge(client?.applePayCanMakePayments)}
              </li>
            </ul>
          </section>

          <section>
            <p className="font-medium mb-1">Pelecard terminal (server probe)</p>
            {serverError && <p className="text-error">{serverError}</p>}
            {!serverError && (
              <ul className="space-y-1">
                <li className="flex justify-between gap-2">
                  <span>Sandbox mode</span>
                  {statusBadge(server?.sandboxMode === false ? true : server?.sandboxMode ? false : null)}
                </li>
                <li className="flex justify-between gap-2">
                  <span>Wallet markup in checkout HTML</span>
                  {statusBadge(server?.walletProbe?.pelecardWalletsLikelyEnabled)}
                </li>
              </ul>
            )}
            {server?.walletProbe?.interpretation && (
              <p className="mt-2 text-gray-700 leading-relaxed">{server.walletProbe.interpretation}</p>
            )}
          </section>

          {paymentUrl && (
            <p className="text-gray-600 break-all">
              Open Pelecard directly (Safari):{' '}
              <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="link link-primary">
                PaymentGW tab
              </a>
            </p>
          )}

          {client?.notes.map((note) => (
            <p key={note} className="text-gray-600 leading-relaxed">
              • {note}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PaymentWalletDebugPanel;
