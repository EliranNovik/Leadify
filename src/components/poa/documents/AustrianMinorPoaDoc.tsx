import React from 'react';
import { PoaField, PoaInlineField, PoaSignatureBox, type PoaDocController } from '../PoaFormPrimitives';

/** Austrian Citizenship POA — applicant + minor children (English). */
const AustrianMinorPoaDoc: React.FC<{ ctrl: PoaDocController }> = ({ ctrl }) => {
  return (
    <div className="poa-doc text-gray-900">
      <div className="mb-8 text-center">
        <span className="poa-title-box inline-block bg-[#44546a] px-8 py-3 text-2xl font-bold tracking-wide text-white">
          POWER OF ATTORNEY
        </span>
      </div>

      <p className="mb-5 text-[15px] leading-loose">
        I,{' '}
        <PoaInlineField ctrl={ctrl} id="full_name" placeholder="full name" widthClass="min-w-[18rem]" />, the
        undersigned hereby appoint Attorney Rositsa Hristova as my attorney-in-fact who shall have full
        power and authority to undertake and perform the following acts on my behalf and my minor
        children in the procedure of obtaining Austrian citizenship:
      </p>

      <ul className="mb-6 list-disc space-y-2 pl-6 text-[15px] leading-relaxed">
        <li>
          Represent me and my minor children in front of the Austrian authorities regarding my request
          for Austrian Citizenship.
        </li>
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
        <PoaField ctrl={ctrl} id="address" label="Address" multiline />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PoaField ctrl={ctrl} id="contact_number" label="Contact number" type="tel" />
          <PoaField ctrl={ctrl} id="email" label="E-mail address" type="email" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PoaField ctrl={ctrl} id="phone" label="Phone number" type="tel" />
          <PoaField ctrl={ctrl} id="sign_date" label="Date" type="date" />
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-600">
          Applicant &amp; minor children — Passport number + full name
        </h2>
        <div className="space-y-4">
          <PoaField ctrl={ctrl} id="applicant_1" label="1." placeholder="Passport number + full name" />
          <PoaField ctrl={ctrl} id="applicant_2" label="2." placeholder="Passport number + full name" />
          <PoaField ctrl={ctrl} id="applicant_3" label="3." placeholder="Passport number + full name" />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <PoaSignatureBox
          ctrl={ctrl}
          id="signature_first_parent"
          label="Signature (Applicant / 1st parent)"
        />
        <PoaSignatureBox
          ctrl={ctrl}
          id="signature_second_parent"
          label="Signature (2nd parent, if applicable)"
        />
      </section>
    </div>
  );
};

export default AustrianMinorPoaDoc;
