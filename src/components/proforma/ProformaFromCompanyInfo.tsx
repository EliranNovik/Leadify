import React from 'react';

export const PROFORMA_FROM_PHONES = [
  '+972552551750',
  '+972587787283',
  '+97229903180',
] as const;

export const PROFORMA_FROM_EMAILS = [
  'PaymentReport3@lawoffice.org.il',
  'office@lawoffice.org.il',
] as const;

const LINE = 'text-sm text-gray-500';

type Props = {
  /** "From:" + bold company name (create / internal view) */
  showFromLabel?: boolean;
  /** Prefix phones with "Phone: " on one line (create / internal view) */
  showPhoneLabel?: boolean;
};

const ProformaFromCompanyInfo: React.FC<Props> = ({
  showFromLabel = false,
  showPhoneLabel = false,
}) => (
  <>
    {showFromLabel ? (
      <>
        <div className="font-semibold text-gray-700 mb-1">From:</div>
        <div className="font-bold text-gray-900">Decker Pex Levi Law office</div>
      </>
    ) : (
      <div className="mb-1 font-semibold text-gray-700">Decker Pex Levi Law office</div>
    )}
    <div className={LINE}>Menachem Begin Rd. 11, Ramat Gan, Israel</div>
    {showPhoneLabel ? (
      <div className={LINE}>Phone: {PROFORMA_FROM_PHONES.join(', ')}</div>
    ) : (
      PROFORMA_FROM_PHONES.map((phone) => (
        <div key={phone} className={LINE}>
          {phone}
        </div>
      ))
    )}
    {PROFORMA_FROM_EMAILS.map((email) => (
      <div key={email} className={LINE}>
        {email}
      </div>
    ))}
  </>
);

export default ProformaFromCompanyInfo;
