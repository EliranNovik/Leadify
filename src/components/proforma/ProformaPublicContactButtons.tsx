import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCardIcon,
  LifebuoyIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { PhoneIcon as PhoneIconSolid } from '@heroicons/react/24/solid';
import { FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import { getEmployeeCallPhone, type EmployeeProfile } from '../../lib/fetchEmployeeProfile';
import { resolveProformaPaymentPagePath } from '../../lib/proformaPaymentLink';
import EmployeeBusinessCardModal from '../EmployeeBusinessCardModal';
import ProformaNotesBox from './ProformaNotesBox';
import ProformaPublicCaseReferenceBox, {
  ProformaPublicMobileMoreMenu,
} from './ProformaPublicCaseReferenceBox';

/** Firm contact links — same as BusinessCardPage */
const FIRM_WHATSAPP_URL = 'https://wa.me/972552780162';
const FIRM_EMAIL = 'office@lawoffice.org.il';
const FIRM_PHONE_TEL = 'tel:+972503489649';

function toTelHref(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return FIRM_PHONE_TEL;
  if (trimmed.startsWith('tel:')) return trimmed;
  return `tel:${trimmed.replace(/[\s()-]/g, '')}`;
}

function getIssuerCallLink(employee: EmployeeProfile | null | undefined): {
  href: string;
  title: string;
} {
  const raw = getEmployeeCallPhone(employee);
  if (raw) {
    return {
      href: toTelHref(raw),
      title: employee?.official_name ? `Call ${employee.official_name}` : 'Call',
    };
  }
  return { href: FIRM_PHONE_TEL, title: 'Call Office' };
}

type Props = {
  issuerEmployee?: EmployeeProfile | null;
  leadNumber?: string | null;
  notes?: string | null;
  paid?: boolean;
  paymentPlanId?: string | number | null;
  leadClientId?: string | number | null;
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
      ? 'h-11 w-11 min-h-11 min-w-11'
      : size === 'md'
        ? 'h-12 w-12 min-h-12 min-w-12'
        : 'btn-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn btn-circle shrink-0 overflow-hidden border-none bg-transparent p-0 shadow-lg transition-transform hover:scale-105 active:scale-95 ${sizeClass}`}
      title={`View ${employee.official_name}'s business card`}
    >
      <img src={photoSrc} alt={employee.official_name} className="h-full w-full object-cover" />
    </button>
  );
}

const contactIconBtnClass =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition hover:scale-105 active:scale-95';

const ContactActionLinks: React.FC<{
  callLink: { href: string; title: string };
  layout?: 'row' | 'column';
}> = ({ callLink, layout = 'row' }) => (
  <div
    className={
      layout === 'column'
        ? 'flex flex-col items-stretch gap-2'
        : 'flex items-center justify-center gap-2'
    }
  >
    <a
      href={FIRM_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${contactIconBtnClass} bg-green-500 hover:bg-green-600`}
      title="Chat on WhatsApp"
      aria-label="WhatsApp"
    >
      <FaWhatsapp className="h-5 w-5" />
    </a>
    <a
      href={`mailto:${FIRM_EMAIL}`}
      className={`${contactIconBtnClass} bg-blue-600 hover:bg-blue-700`}
      title="Send Email"
      aria-label="Email"
    >
      <FaEnvelope className="h-5 w-5" />
    </a>
    <a
      href={callLink.href}
      className={`${contactIconBtnClass} bg-purple-600 hover:bg-purple-700`}
      title={callLink.title}
      aria-label="Phone"
    >
      <PhoneIconSolid className="h-5 w-5" />
    </a>
  </div>
);

type NeedAssistanceProps = {
  open: boolean;
  onToggle: () => void;
  callLink: { href: string; title: string };
  variant: 'mobile' | 'desktop';
};

const NeedAssistanceControl: React.FC<NeedAssistanceProps> = ({
  open,
  onToggle,
  callLink,
  variant,
}) => {
  const isMobile = variant === 'mobile';

  return (
    <div className={`relative shrink-0 ${isMobile ? '' : 'flex flex-col items-end'}`}>
      {open && (
        <div
          className={
            isMobile
              ? 'absolute bottom-full right-0 z-10 mb-2 rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100'
              : 'mb-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-lg shadow-slate-900/10 ring-1 ring-slate-100'
          }
          role="group"
          aria-label="Contact options"
        >
          <ContactActionLinks callLink={callLink} layout={isMobile ? 'row' : 'column'} />
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Close assistance options' : 'Need assistance'}
        className={
          isMobile
            ? 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-slate-900 transition active:scale-95 hover:bg-slate-900/5'
            : `inline-flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-md transition hover:shadow-lg active:scale-[0.98] ${
                open
                  ? 'border-slate-300 bg-slate-700 text-white'
                  : 'border-slate-200/80 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
              }`
        }
      >
        {isMobile ? (
          <QuestionMarkCircleIcon className="h-8 w-8 text-slate-900" />
        ) : (
          <>
            <LifebuoyIcon className={`h-5 w-5 shrink-0 ${open ? 'text-white' : 'text-slate-600'}`} />
            <span className="whitespace-nowrap">{open ? 'Close' : 'Need assistance?'}</span>
          </>
        )}
      </button>
    </div>
  );
};

const PayNowButton: React.FC<{
  paymentPagePath: string;
  variant: 'mobile' | 'desktop';
  onNavigate: () => void;
}> = ({ paymentPagePath, variant, onNavigate }) => {
  const isMobile = variant === 'mobile';

  return (
    <button
      type="button"
      onClick={onNavigate}
      className={
        isMobile
          ? 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-gray-900 px-4 text-sm font-bold text-white shadow-lg transition hover:bg-black active:scale-95'
          : 'inline-flex w-full min-w-[13rem] items-center justify-center gap-2.5 rounded-full bg-gray-900 px-7 py-4 text-lg font-bold text-white shadow-lg transition hover:bg-black active:scale-[0.98]'
      }
      title="Pay this invoice online"
      aria-label={`Pay now online — opens secure checkout at ${paymentPagePath}`}
    >
      <CreditCardIcon className={`shrink-0 ${isMobile ? 'h-4 w-4' : 'h-6 w-6'}`} aria-hidden />
      <span className="whitespace-nowrap">Pay now online</span>
    </button>
  );
};

type DesktopAssistanceCornerProps = {
  assistanceOpen: boolean;
  onToggleAssistance: () => void;
  callLink: { href: string; title: string };
  issuerEmployee?: EmployeeProfile | null;
  onIssuerClick?: () => void;
};

const DesktopAssistanceCorner: React.FC<DesktopAssistanceCornerProps> = ({
  assistanceOpen,
  onToggleAssistance,
  callLink,
  issuerEmployee,
  onIssuerClick,
}) => (
  <div className="flex items-center gap-2">
    {issuerEmployee && onIssuerClick && (
      <IssuerAvatarButton employee={issuerEmployee} onClick={onIssuerClick} size="md" />
    )}
    <NeedAssistanceControl
      open={assistanceOpen}
      onToggle={onToggleAssistance}
      callLink={callLink}
      variant="desktop"
    />
  </div>
);

const ProformaPublicContactButtons: React.FC<Props> = ({
  issuerEmployee,
  leadNumber,
  notes,
  paid = false,
  paymentPlanId,
  leadClientId,
}) => {
  const navigate = useNavigate();
  const [showIssuerModal, setShowIssuerModal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [assistanceOpen, setAssistanceOpen] = useState(false);
  const [paymentPagePath, setPaymentPagePath] = useState<string | null>(null);
  const mobileBarRef = useRef<HTMLDivElement>(null);
  const desktopAssistanceRef = useRef<HTMLDivElement>(null);

  const displayNotes = notes?.trim() ?? '';
  const caseLeadNumber = leadNumber?.trim() ?? '';
  const hasMoreContent = Boolean(caseLeadNumber || displayNotes);
  const callLink = getIssuerCallLink(issuerEmployee);
  const showPayNow = !paid && Boolean(paymentPlanId);

  useEffect(() => {
    if (paid || paymentPlanId == null || paymentPlanId === '') {
      setPaymentPagePath(null);
      return undefined;
    }

    let cancelled = false;
    void resolveProformaPaymentPagePath({ paymentPlanId, leadClientId }).then((path) => {
      if (!cancelled) setPaymentPagePath(path);
    });

    return () => {
      cancelled = true;
    };
  }, [paid, paymentPlanId, leadClientId]);

  useEffect(() => {
    if (!assistanceOpen) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside =
        mobileBarRef.current?.contains(target) ||
        desktopAssistanceRef.current?.contains(target);
      if (!inside) setAssistanceOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [assistanceOpen]);

  const toggleAssistance = () => setAssistanceOpen((v) => !v);

  const handlePayNow = () => {
    if (!paymentPagePath) return;
    setAssistanceOpen(false);
    navigate(paymentPagePath);
  };

  const openIssuerModal = () => {
    setShowIssuerModal(true);
    setAssistanceOpen(false);
  };

  return (
    <>
      {/* Mobile — fixed bottom bar */}
      <nav
        className="print-hide fixed inset-x-0 bottom-0 z-50 flex items-end justify-between gap-2 border-t border-white/30 bg-white/40 px-3 py-2 shadow-[0_-8px_32px_rgba(15,23,42,0.12)] backdrop-blur-2xl backdrop-saturate-150 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
        aria-label="Contact and info"
      >
        <div className="flex items-end gap-2">
          {hasMoreContent && (
            <ProformaPublicMobileMoreMenu
              open={showMore}
              onToggle={() => {
                setShowMore((v) => !v);
                setAssistanceOpen(false);
              }}
              leadNumber={caseLeadNumber || null}
              notes={displayNotes || null}
            />
          )}
          {issuerEmployee && (
            <IssuerAvatarButton employee={issuerEmployee} onClick={openIssuerModal} size="mobileBar" />
          )}
        </div>

        <div ref={mobileBarRef} className="ml-auto flex items-end gap-2">
          {showPayNow && paymentPagePath && (
            <PayNowButton
              paymentPagePath={paymentPagePath}
              variant="mobile"
              onNavigate={handlePayNow}
            />
          )}
          <NeedAssistanceControl
            open={assistanceOpen}
            onToggle={toggleAssistance}
            callLink={callLink}
            variant="mobile"
          />
        </div>
      </nav>

      {/* Desktop — payment reference + pay now, vertically centered on the right */}
      <div className="print-hide fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-3 md:right-6 md:flex">
        {caseLeadNumber && <ProformaPublicCaseReferenceBox leadNumber={caseLeadNumber} />}
        {showPayNow && paymentPagePath && (
          <PayNowButton
            paymentPagePath={paymentPagePath}
            variant="desktop"
            onNavigate={handlePayNow}
          />
        )}
        {displayNotes && <ProformaNotesBox notes={displayNotes} />}
      </div>

      {/* Desktop — profile + assistance, bottom-right corner */}
      <div
        ref={desktopAssistanceRef}
        className="print-hide fixed bottom-6 right-4 z-50 hidden md:right-6 md:block"
      >
        <DesktopAssistanceCorner
          assistanceOpen={assistanceOpen}
          onToggleAssistance={toggleAssistance}
          callLink={callLink}
          issuerEmployee={issuerEmployee}
          onIssuerClick={issuerEmployee ? openIssuerModal : undefined}
        />
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
