import React from 'react';
import { PoaField, PoaInlineField, PoaSignatureBox, type PoaDocController } from '../PoaFormPrimitives';

/** Austrian Citizenship POA — standard, single applicant (English). */
const AustrianStandardPoaDoc: React.FC<{ ctrl: PoaDocController }> = ({ ctrl }) => {
  return (
    <div className="poa-doc text-gray-900">
      <div className="mb-8 text-center">
        <span className="poa-title-box inline-block bg-[#44546a] px-8 py-3 text-2xl font-bold tracking-wide text-white">
          POWER OF ATTORNEY
        </span>
      </div>

      <p className="mb-5 text-[15px] leading-loose">
        I,{' '}
        <PoaInlineField ctrl={ctrl} id="full_name" placeholder="full name" widthClass="min-w-[16rem]" />, dob{' '}
        <PoaInlineField ctrl={ctrl} id="date_of_birth" type="date" widthClass="min-w-[10rem]" />, the undersigned
        hereby appoint Attorney Rositsa Hristova as my attorney-in-fact who shall have full power and
        authority to undertake and perform the following acts on my behalf in the procedure of
        obtaining Austrian citizenship:
      </p>

      <ul className="mb-6 list-disc space-y-2 pl-6 text-[15px] leading-relaxed">
        <li>Represent me in front of the Austrian authorities regarding my request for Austrian Citizenship.</li>
        <li>Act on my behalf concerning the process of receiving Austrian Citizenship.</li>
        <li>This Power of Attorney is effective immediately and will continue until I revoke it.</li>
        <li>This Power of Attorney will continue to be effective even though I become incapacitated.</li>
        <li>
          This Power of Attorney does not include the Power of Attorney for picking up final decisions,
          both positive or negative (Übernahme von Parteiengehören und Bescheiden). These are to be sent
          directly to me by way of the Austrian Embassy in Tel Aviv.
        </li>
      </ul>

      <div className="mb-6 space-y-4">
        <PoaField ctrl={ctrl} id="address" label="Current living address" multiline />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PoaField ctrl={ctrl} id="phone" label="Telephone number" type="tel" />
          <PoaField ctrl={ctrl} id="email" label="E-mail address" type="email" />
        </div>
      </div>

      <div className="mb-8 max-w-xs">
        <PoaField ctrl={ctrl} id="sign_date" label="Date" type="date" />
      </div>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <PoaField ctrl={ctrl} id="passport_number" label="Passport number" />
        <PoaSignatureBox ctrl={ctrl} id="signature" label="Signature" />
      </section>
    </div>
  );
};

export default AustrianStandardPoaDoc;
