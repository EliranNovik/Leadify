import React, { useState } from 'react';
import { PhoneIcon } from '@heroicons/react/24/solid';
import { FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import type { EmployeeProfile } from '../../lib/fetchEmployeeProfile';
import EmployeeBusinessCardModal from '../EmployeeBusinessCardModal';
import ProformaNotesBox from './ProformaNotesBox';
import ProformaPublicCaseReferenceBox, {
  ProformaPublicMobileMoreMenu,
} from './ProformaPublicCaseReferenceBox';

/** Firm contact links — same as BusinessCardPage */
const FIRM_WHATSAPP_URL = 'https://wa.me/972552780162';
const FIRM_EMAIL = 'office@lawoffice.org.il';
const FIRM_PHONE_TEL = 'tel:+972503489649';

type Props = {
  issuerEmployee?: EmployeeProfile | null;
  leadNumber?: string | null;
  notes?: string | null;
};

function IssuerAvatarButton({
  employee,
  onClick,
  size = 'sm',
}: {
  employee: EmployeeProfile;
  onClick: () => void;
  size?: 'sm' | 'md' | 'mobileBar';
}) {
  const photoSrc = employee.photo_url || 'https://ui-avatars.com/api/?background=random';
  const sizeClass =
    size === 'mobileBar'
      ? 'h-12 w-12 min-h-12 min-w-12'
      : size === 'md'
        ? 'btn-md md:btn-lg'
        : 'btn-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn btn-circle ${sizeClass} overflow-hidden border-none bg-transparent p-0 shadow-lg transition-transform hover:scale-105 md:hover:scale-110`}
      title={`View ${employee.official_name}'s business card`}
    >
      <img src={photoSrc} alt={employee.official_name} className="h-full w-full object-cover" />
    </button>
  );
}

const mobileBarBtnClass =
  'btn btn-circle h-12 w-12 min-h-12 min-w-12 border-none shadow-lg transition-transform hover:scale-105';

const desktopContactBtnClass =
  'btn btn-circle btn-md border-none shadow-lg transition-transform hover:scale-110 md:btn-lg';

const ProformaPublicContactButtons: React.FC<Props> = ({ issuerEmployee, leadNumber, notes }) => {
  const [showIssuerModal, setShowIssuerModal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const displayNotes = notes?.trim() ?? '';
  const caseLeadNumber = leadNumber?.trim() ?? '';
  const hasMoreContent = Boolean(caseLeadNumber || displayNotes);

  return (
    <>
      {/* Mobile — fixed bottom bar */}
      <nav
        className="print-hide fixed inset-x-0 bottom-0 z-50 flex items-center justify-evenly gap-2 border-t border-white/40 bg-white/50 px-4 py-3 shadow-[0_-8px_32px_rgba(15,23,42,0.1)] backdrop-blur-2xl backdrop-saturate-150 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
        aria-label="Contact and info"
      >
        {hasMoreContent && (
          <ProformaPublicMobileMoreMenu
            open={showMore}
            onToggle={() => setShowMore((v) => !v)}
            leadNumber={caseLeadNumber || null}
            notes={displayNotes || null}
          />
        )}
        {issuerEmployee && (
          <IssuerAvatarButton
            employee={issuerEmployee}
            onClick={() => setShowIssuerModal(true)}
            size="mobileBar"
          />
        )}
        <a
          href={FIRM_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${mobileBarBtnClass} bg-green-500 text-white hover:bg-green-600`}
          title="Chat on WhatsApp"
        >
          <FaWhatsapp className="h-6 w-6" />
        </a>
        <a
          href={`mailto:${FIRM_EMAIL}`}
          className={`${mobileBarBtnClass} bg-blue-600 text-white hover:bg-blue-700`}
          title="Send Email"
        >
          <FaEnvelope className="h-6 w-6" />
        </a>
        <a
          href={FIRM_PHONE_TEL}
          className={`${mobileBarBtnClass} bg-purple-600 text-white hover:bg-purple-700`}
          title="Call Office"
        >
          <PhoneIcon className="h-6 w-6" />
        </a>
      </nav>

      {/* Desktop — right side */}
      <div className="print-hide fixed right-4 top-1/2 z-50 hidden -translate-y-1/2 flex-col items-end gap-3 md:right-6 md:flex md:gap-4">
        {caseLeadNumber && <ProformaPublicCaseReferenceBox leadNumber={caseLeadNumber} />}
        {displayNotes && <ProformaNotesBox notes={displayNotes} />}
        {issuerEmployee && (
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap text-sm font-medium text-gray-700 md:text-base">
              {issuerEmployee.official_name}
            </span>
            <IssuerAvatarButton
              employee={issuerEmployee}
              onClick={() => setShowIssuerModal(true)}
              size="md"
            />
          </div>
        )}
        <a
          href={FIRM_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${desktopContactBtnClass} bg-green-500 text-white hover:bg-green-600`}
          title="Chat on WhatsApp"
        >
          <FaWhatsapp className="h-5 w-5 md:h-8 md:w-8" />
        </a>
        <a
          href={`mailto:${FIRM_EMAIL}`}
          className={`${desktopContactBtnClass} bg-blue-600 text-white hover:bg-blue-700`}
          title="Send Email"
        >
          <FaEnvelope className="h-5 w-5 md:h-8 md:w-8" />
        </a>
        <a
          href={FIRM_PHONE_TEL}
          className={`${desktopContactBtnClass} bg-purple-600 text-white hover:bg-purple-700`}
          title="Call Office"
        >
          <PhoneIcon className="h-5 w-5 md:h-8 md:w-8" />
        </a>
      </div>

      {issuerEmployee && (
        <EmployeeBusinessCardModal
          employee={issuerEmployee}
          open={showIssuerModal}
          onClose={() => setShowIssuerModal(false)}
        />
      )}
    </>
  );
};

export default ProformaPublicContactButtons;
