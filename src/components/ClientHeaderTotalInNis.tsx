import React, { useEffect, useState } from 'react';
import type { CurrencyInput } from '../lib/boiCurrencyConversion';
import { formatIlsAmount } from '../lib/proformaExchangeRate';
import { fetchLeadGrossTotalInNis } from '../lib/leadTotalInNis';

type Props = {
  clientId: string | number | undefined;
  leadType?: string | null;
  /** Unused — NIS is derived from saved proformas only */
  currencyInput?: CurrencyInput;
  subtotal?: number;
  vat?: number;
  className?: string;
};

const ClientHeaderTotalInNis: React.FC<Props> = ({ clientId, leadType, className = '' }) => {
  const [display, setDisplay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (clientId == null || clientId === '') {
      setDisplay(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const result = await fetchLeadGrossTotalInNis(clientId, leadType);
        if (cancelled) return;
        if (!result || result.isLocalCurrency) {
          setDisplay(null);
          return;
        }
        setDisplay(formatIlsAmount(result.totalNis));
      } catch (err) {
        console.error('[ClientHeaderTotalInNis]', err);
        if (!cancelled) setDisplay(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, leadType]);

  if (loading || !display) return null;

  return (
    <p
      className={
        className.trim() ||
        'text-3xl font-bold leading-none tracking-tight text-gray-500 tabular-nums dark:text-gray-400'
      }
    >
      {display}
    </p>
  );
};

export default ClientHeaderTotalInNis;
