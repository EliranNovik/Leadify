import React from 'react';

export function formatProformaIssuedDate(
  date: string | Date | number | null | undefined,
): string | null {
  if (date == null || date === '') return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

type Props = {
  name?: string | null;
  date?: string | Date | number | null;
  label?: string;
  className?: string;
};

/** Issuer name with issue date on the line below (proforma view/create/public pages). */
const ProformaIssuedByFooter: React.FC<Props> = ({
  name,
  date,
  label = 'Issued by',
  className = 'mt-8 text-xs text-gray-500',
}) => {
  const displayName = name?.trim() ?? '';
  const formattedDate = formatProformaIssuedDate(date);

  if (!displayName && !formattedDate) return null;

  return (
    <div className={className}>
      {displayName && (
        <div>
          <span className="font-semibold">{label}:</span> <span>{displayName}</span>
        </div>
      )}
      {formattedDate && <div className={displayName ? 'mt-0.5' : undefined}>{formattedDate}</div>}
    </div>
  );
};

export default ProformaIssuedByFooter;
