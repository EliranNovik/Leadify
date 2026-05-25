import React from 'react';

type Props = {
  paid?: boolean | null;
  paidAt?: string | null;
  className?: string;
};

function formatPaidDate(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

const ProformaPaidBadge: React.FC<Props> = ({ paid, paidAt, className = '' }) => {
  if (!paid) return null;

  const dateLabel = formatPaidDate(paidAt);
  const label = dateLabel ? `Paid at ${dateLabel}` : 'Paid';

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ${className}`}
    >
      {label}
    </span>
  );
};

export default ProformaPaidBadge;
