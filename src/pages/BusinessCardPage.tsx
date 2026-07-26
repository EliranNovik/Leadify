import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowUpOnSquareIcon,
  ArrowsRightLeftIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  MapPinIcon,
  PhoneIcon,
  QrCodeIcon,
  UserPlusIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';
import { FaEnvelope, FaLinkedin, FaWhatsapp } from 'react-icons/fa';
import MobileBottomSheet from '../components/MobileBottomSheet';
import {
  addBusinessCardToContacts,
  detectWalletPlatform,
  fetchWalletBackendStatus,
  FIRM_NAME,
  OFFICE_ADDRESS,
  OFFICE_LABEL,
  saveBusinessCardForWallet,
  shareBusinessCard,
  walletSaveHint,
  type WalletBackendStatus,
} from '../lib/businessCardActions';
import {
  fetchPublicBusinessCardById,
  getEmployeeCallPhone,
  type EmployeeProfile,
} from '../lib/fetchEmployeeProfile';

const DEFAULT_BANNER =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';
const DEFAULT_AVATAR = 'https://ui-avatars.com/api/?background=0D1F1A&color=E8D5A3&name=DP';

const FIRM_WHATSAPP_URL = 'https://wa.me/972552780162';
const FIRM_EMAIL = 'office@lawoffice.org.il';
const FIRM_PHONE_TEL = 'tel:+972503489649';

const CARD_FACE_SHADOW =
  '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 10px 30px -5px rgba(0, 0, 0, 0.3), 0 0 60px -15px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';

const CARD_TILT_KEYFRAMES = `
  @keyframes businessCardTilt {
    0%, 100% { transform: perspective(1000px) rotateX(0deg) rotateY(0deg); }
    25% { transform: perspective(1000px) rotateX(0deg) rotateY(-2deg); }
    50% { transform: perspective(1000px) rotateX(0deg) rotateY(2deg); }
    75% { transform: perspective(1000px) rotateX(0deg) rotateY(-1deg); }
  }
`;

const QR_REVEAL_KEYFRAMES = `
  @keyframes businessCardQrReveal {
    0% {
      opacity: 0;
      transform: translateY(12px) scale(0.92);
      filter: blur(6px);
    }
    60% {
      opacity: 1;
      filter: blur(0);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }
  @keyframes businessCardQrExit {
    0% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
    100% {
      opacity: 0;
      transform: translateY(10px) scale(0.94);
      filter: blur(4px);
    }
  }
`;

const SERIF = { fontFamily: "'Playfair Display', 'Libre Baskerville', Georgia, serif" } as const;
const GOLD = '#C9A96E';
const PANEL = '#0F241F';

function parseEmployeeId(raw: string | undefined): number | null {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw.trim());
  const parsed = Number.parseInt(decoded, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toTelHref(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('tel:')) return trimmed;
  const normalized = trimmed.replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : '';
}

function buildWhatsAppUrl(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function getRoleDisplay(role: string): string {
  const roleMap: Record<string, string> = {
    c: 'Closer',
    s: 'Scheduler',
    h: 'Handler',
    n: 'No role',
    e: 'Expert',
    z: 'Manager',
    Z: 'Manager',
    ma: 'Marketing',
    p: 'Partner',
    'helper-closer': 'Helper Closer',
    pm: 'Project Manager',
    se: 'Secretary',
    dv: 'Developer',
    dm: 'Department Manager',
    b: 'Book Keeper',
    f: 'Finance',
  };
  return roleMap[role] || role;
}

function ContactRow({
  icon,
  href,
  primary,
  secondary,
  external,
}: {
  icon: React.ReactNode;
  href?: string;
  primary: string;
  secondary?: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'rgba(255,255,255,0.08)', color: GOLD }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-medium tracking-wide text-white/95">
          {primary}
        </span>
        {secondary ? (
          <span className="mt-0.5 block text-xs text-white/55">{secondary}</span>
        ) : null}
      </span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        {...(external
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : {})}
        className="flex touch-manipulation items-center gap-3.5 rounded-2xl px-1 py-2.5 transition-colors active:bg-white/5"
      >
        {inner}
      </a>
    );
  }

  return <div className="flex items-center gap-3.5 px-1 py-2.5">{inner}</div>;
}

type MobileCardProps = {
  profile: EmployeeProfile;
  photoSrc: string;
  backgroundUrl: string;
  cardUrl: string;
  isVisible: boolean;
};

const MobileBusinessCard: React.FC<MobileCardProps> = ({
  profile,
  photoSrc,
  backgroundUrl,
  cardUrl,
  isVisible,
}) => {
  const [qrOpen, setQrOpen] = useState(false);
  const [qrCloseRequestKey, setQrCloseRequestKey] = useState(0);
  const [qrExiting, setQrExiting] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletCloseRequestKey, setWalletCloseRequestKey] = useState(0);
  const [walletExiting, setWalletExiting] = useState(false);
  const [walletStatus, setWalletStatus] = useState<WalletBackendStatus | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const openQrSheet = () => {
    setQrExiting(false);
    setQrOpen(true);
  };

  const requestQrClose = () => {
    if (qrExiting) return;
    setQrExiting(true);
    setQrCloseRequestKey((k) => k + 1);
  };

  const openWalletSheet = () => {
    setWalletExiting(false);
    setWalletOpen(true);
    void fetchWalletBackendStatus().then(setWalletStatus);
  };

  const requestWalletClose = () => {
    if (walletExiting) return;
    setWalletExiting(true);
    setWalletCloseRequestKey((k) => k + 1);
  };

  // Prefetch wallet backend status on phones so the bar tap feels instant.
  useEffect(() => {
    if (walletPlatform !== 'apple' && walletPlatform !== 'google') return;
    void fetchWalletBackendStatus().then(setWalletStatus);
  }, [walletPlatform]);

  const walletPlatform = useMemo(() => detectWalletPlatform(), []);
  const roleLine = `${getRoleDisplay(profile.bonuses_role)} – ${profile.department_name} Department`;
  const employeeEmail = profile.email?.trim() || '';

  const handleAddContact = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await addBusinessCardToContacts(profile, cardUrl);
      if (result === 'downloaded') {
        toast.success('Contact file ready — open it to save on your phone');
      } else {
        toast.success('Choose “Add to Contacts” from the share sheet');
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      console.error(err);
      toast.error('Could not open add-contact. Try again.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleShare = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await shareBusinessCard({
        name: profile.official_name || profile.display_name,
        department: profile.department_name,
        url: cardUrl,
      });
      if (result === 'copied') toast.success('Card link copied');
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      console.error(err);
      toast.error('Sharing is not available on this device');
    } finally {
      setActionBusy(false);
    }
  };

  const walletPassReady =
    (walletPlatform === 'apple' && walletStatus?.appleConfigured) ||
    (walletPlatform === 'google' && walletStatus?.googleConfigured);

  const handleWalletPrimary = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await saveBusinessCardForWallet(profile, cardUrl, walletPlatform);
      if (result === 'apple') {
        toast.success('Opening Apple Wallet…');
        return;
      }
      if (result === 'google') {
        toast.success('Opening Google Wallet…');
        return;
      }
      if (result === 'unavailable') {
        toast.error('Open this page on iPhone or Android to add to Wallet');
        return;
      }
      if (result === 'shared') {
        toast.success(
          walletPlatform === 'google'
            ? 'Choose Contacts in the share sheet'
            : 'Contact ready to save',
        );
      } else if (walletPlatform === 'apple') {
        toast.success('Tap Create New Contact, then Done');
      } else if (walletPlatform === 'google') {
        toast.success('Open the downloaded .vcf and save to Contacts');
      } else {
        toast.success('Contact file ready — open it on your phone');
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : 'Could not add to Wallet. Try again.',
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleWalletSaveContact = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await addBusinessCardToContacts(profile, cardUrl);
      if (result === 'shared') {
        toast.success(
          walletPlatform === 'google'
            ? 'Choose Contacts in the share sheet'
            : 'Contact ready to save',
        );
      } else if (walletPlatform === 'apple') {
        toast.success('Tap Create New Contact, then Done');
      } else {
        toast.success('Open the downloaded .vcf and save to Contacts');
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      console.error(err);
      toast.error('Could not save contact. Try again.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleWalletBarClick = () => {
    // iPhone / Android: go straight to native Wallet save — no sheet.
    if (walletPlatform === 'apple' || walletPlatform === 'google') {
      void handleWalletPrimary();
      return;
    }
    // Desktop / unknown: keep the helper sheet.
    openWalletSheet();
  };

  const actions = [
    {
      key: 'contact',
      label: 'Add Contact',
      icon: <UserPlusIcon className="h-10 w-10" strokeWidth={1.5} />,
      onClick: () => void handleAddContact(),
    },
    {
      key: 'wallet',
      label: 'Add to Wallet',
      icon: <WalletIcon className="h-10 w-10" strokeWidth={1.5} />,
      onClick: handleWalletBarClick,
    },
    {
      key: 'qr',
      label: 'Open QR Code',
      icon: <QrCodeIcon className="h-10 w-10" strokeWidth={1.5} />,
      onClick: openQrSheet,
    },
    {
      key: 'share',
      label: 'Share Card',
      icon: <ArrowUpOnSquareIcon className="h-10 w-10" strokeWidth={1.5} />,
      onClick: () => void handleShare(),
    },
  ] as const;

  return (
    <>
      <div
        className={`relative flex min-h-dvh w-full flex-col overflow-hidden transition-all duration-700 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
        style={{ backgroundColor: PANEL }}
      >
        {/* Solid card base — one green from arch through contacts (no colour seam) */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: PANEL }}
        />
        {/* Firm background — a bit more visible across the card */}
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-45"
          style={{ backgroundImage: `url(${backgroundUrl})` }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0F241F]/55 via-[#0F241F]/78 to-[#0F241F]/92" />

        {/*
          Photo starts at the very top, including behind the mobile safe-area/notch.
          It is clipped TO the arch shape — green page shows through the lower corners.
          No SVG/gradient overlays on top of the photo = no light fringe / colour seam.
        */}
        <div className="relative z-10 w-full shrink-0">
          <div className="absolute left-4 top-[max(0.75rem,env(safe-area-inset-top))] z-30 rounded-2xl bg-black/25 px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <img
              src="/DPLOGO1.png"
              alt="Decker Pex Levi"
              className="h-10 w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
            />
          </div>
          <svg width={0} height={0} aria-hidden>
            <defs>
              <clipPath id="bc-photo-arch" clipPathUnits="objectBoundingBox">
                <path d="M0,0 H1 V0.70 C0.78,0.92 0.30,0.88 0,0.54 Z" />
              </clipPath>
            </defs>
          </svg>
          <div
            className="relative h-[min(56dvh,470px)] w-full"
            style={{
              clipPath: 'url(#bc-photo-arch)',
              WebkitClipPath: 'url(#bc-photo-arch)',
            }}
          >
            <img
              src={photoSrc}
              alt={profile.official_name}
              className="h-full w-full object-cover object-[center_18%]"
              loading="eager"
            />
          </div>
        </div>

        {/* Details — translucent green so the firm background shows through slightly */}
        <div
          className="relative z-10 -mt-[18%] flex flex-1 flex-col px-6 pb-28 backdrop-blur-[1px]"
          style={{ backgroundColor: 'rgba(15, 36, 31, 0.88)' }}
        >
          <div className="px-1 text-left">
            <h1
              className="text-[2rem] font-semibold leading-tight tracking-tight text-white"
              style={SERIF}
            >
              {profile.official_name}
            </h1>
            <div
              className="mt-3 h-0.5 w-10 rounded-full"
              style={{ background: GOLD }}
            />
            <p className="mt-3 text-sm font-medium tracking-wide" style={{ color: GOLD }}>
              {roleLine}
            </p>
          </div>

          <div className="mt-5 space-y-0.5">
            {employeeEmail ? (
              <ContactRow
                icon={<EnvelopeIcon className="h-5 w-5" />}
                href={`mailto:${employeeEmail}`}
                primary={employeeEmail}
              />
            ) : null}
            {profile.mobile?.trim() ? (
              <ContactRow
                icon={<DevicePhoneMobileIcon className="h-5 w-5" />}
                href={toTelHref(profile.mobile)}
                primary={profile.mobile}
              />
            ) : null}
            {profile.phone?.trim() ? (
              <ContactRow
                icon={<PhoneIcon className="h-5 w-5" />}
                href={toTelHref(profile.phone)}
                primary={
                  profile.phone_ext?.trim()
                    ? `${profile.phone}  Ext: ${profile.phone_ext}`
                    : profile.phone
                }
              />
            ) : null}
            <ContactRow
              icon={<MapPinIcon className="h-5 w-5" />}
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(OFFICE_ADDRESS)}`}
              external
              primary={OFFICE_LABEL}
              secondary={OFFICE_ADDRESS}
            />
          </div>

          <div className="flex-1" />
        </div>

        {/* Floating white action bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))]">
          <div
            className="pointer-events-auto mx-auto flex max-w-sm items-stretch justify-between gap-1 rounded-[1.75rem] bg-white px-2 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.28)] ring-1 ring-black/5"
          >
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                disabled={actionBusy}
                onClick={action.onClick}
                className="flex min-w-0 flex-1 touch-manipulation flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-[#1A2E28] transition-colors active:bg-black/[0.04] disabled:opacity-60"
              >
                <span className="flex h-12 w-12 items-center justify-center text-[#1A2E28]">
                  {action.icon}
                </span>
                <span className="w-full truncate text-center text-[11px] font-semibold leading-tight tracking-wide text-[#1A2E28]/80">
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <MobileBottomSheet
        open={qrOpen}
        onClose={() => {
          setQrOpen(false);
          setQrExiting(false);
        }}
        closeRequestKey={qrCloseRequestKey}
        onOverlayClick={() => setQrExiting(true)}
        hideDefaultHeader
        sheetClassName="!bg-white !text-[#0F241F] !border-white"
        contentClassName="!bg-white"
        overlayClassName="!bg-black/60"
      >
        <style>{QR_REVEAL_KEYFRAMES}</style>
        <div
          className="flex flex-col items-center gap-5 px-2 pb-6 pt-1"
          data-sheet-no-drag
          style={{
            animation: qrExiting
              ? 'businessCardQrExit 280ms cubic-bezier(0.4, 0, 0.2, 1) both'
              : undefined,
            willChange: qrExiting ? 'transform, opacity, filter' : undefined,
          }}
        >
          <div className="w-full px-2 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-[#0F241F] md:text-xl">
              Scan this card
            </h2>
            <p className="mt-1 text-sm text-[#0F241F]/55">
              {profile.official_name}
            </p>
          </div>
          <div
            key={cardUrl}
            className="rounded-3xl bg-white p-5"
            style={{
              animation: qrExiting
                ? undefined
                : qrOpen
                  ? 'businessCardQrReveal 520ms cubic-bezier(0.22, 1, 0.36, 1) both'
                  : undefined,
              transformOrigin: 'center center',
              willChange: 'transform, opacity, filter',
            }}
          >
            <QRCodeSVG
              value={cardUrl}
              size={260}
              level="M"
              includeMargin={false}
              bgColor="#ffffff"
              fgColor="#0F241F"
              className="h-auto w-full max-w-[68vw]"
            />
          </div>
          <button
            type="button"
            onClick={requestQrClose}
            className="btn h-12 w-full max-w-[68vw] rounded-2xl border-0 bg-[#0F241F] font-semibold text-white hover:bg-[#0F241F]/90"
          >
            Close
          </button>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={walletOpen}
        onClose={() => {
          setWalletOpen(false);
          setWalletExiting(false);
        }}
        closeRequestKey={walletCloseRequestKey}
        onOverlayClick={() => setWalletExiting(true)}
        hideDefaultHeader
        sheetClassName="!bg-white !text-[#0F241F] !border-white"
        contentClassName="!bg-white"
        overlayClassName="!bg-black/60"
      >
        <style>{QR_REVEAL_KEYFRAMES}</style>
        <div
          className="flex flex-col items-center gap-5 px-2 pb-6 pt-1"
          data-sheet-no-drag
          style={{
            animation: walletExiting
              ? 'businessCardQrExit 280ms cubic-bezier(0.4, 0, 0.2, 1) both'
              : walletOpen
                ? 'businessCardQrReveal 520ms cubic-bezier(0.22, 1, 0.36, 1) both'
                : undefined,
            willChange: 'transform, opacity, filter',
          }}
        >
          <div className="w-full px-2 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-[#0F241F] md:text-xl">
              Add to Wallet
            </h2>
            <p className="mt-1 text-sm text-[#0F241F]/55">
              {walletPlatform === 'apple'
                ? 'Apple Wallet · iPhone'
                : walletPlatform === 'google'
                  ? 'Google Wallet · Android'
                  : 'Save on your phone'}
            </p>
          </div>

          <p className="max-w-[68vw] text-center text-sm leading-relaxed text-[#0F241F]/65">
            {walletSaveHint(walletPlatform, walletStatus)}
          </p>

          <button
            type="button"
            disabled={actionBusy}
            className="btn h-12 w-full max-w-[68vw] rounded-2xl border-0 bg-[#0F241F] font-semibold text-white hover:bg-[#0F241F]/90 disabled:opacity-60"
            onClick={() => void handleWalletPrimary()}
          >
            {actionBusy
              ? 'Preparing…'
              : walletPassReady
                ? walletPlatform === 'apple'
                  ? 'Add to Apple Wallet'
                  : 'Add to Google Wallet'
                : walletPlatform === 'apple'
                  ? 'Save to Contacts'
                  : walletPlatform === 'google'
                    ? 'Save to Contacts'
                    : 'Save contact file'}
          </button>

          {walletPassReady && (
            <button
              type="button"
              disabled={actionBusy}
              className="btn h-12 w-full max-w-[68vw] rounded-2xl border border-[#0F241F]/12 bg-transparent font-semibold text-[#0F241F] hover:bg-[#0F241F]/5 disabled:opacity-60"
              onClick={() => void handleWalletSaveContact()}
            >
              Also save to Contacts
            </button>
          )}

          <button
            type="button"
            onClick={requestWalletClose}
            className="btn h-12 w-full max-w-[68vw] rounded-2xl border border-[#0F241F]/12 bg-transparent font-semibold text-[#0F241F] hover:bg-[#0F241F]/5"
          >
            Close
          </button>
        </div>
      </MobileBottomSheet>
    </>
  );
};

type DesktopCardProps = {
  profile: EmployeeProfile;
  photoSrc: string;
  backgroundUrl: string;
  isVisible: boolean;
  enableTilt: boolean;
  isFlipped: boolean;
  setIsFlipped: React.Dispatch<React.SetStateAction<boolean>>;
};

const DesktopBusinessCard: React.FC<DesktopCardProps> = ({
  profile,
  photoSrc,
  backgroundUrl,
  isVisible,
  enableTilt,
  isFlipped,
  setIsFlipped,
}) => {
  const employeeWhatsAppUrl = profile.mobile ? buildWhatsAppUrl(profile.mobile) : '';
  const employeeCallHref = toTelHref(getEmployeeCallPhone(profile));
  const employeeEmail = profile.email?.trim() || '';

  const contactFabClass =
    'inline-flex h-12 w-12 touch-manipulation items-center justify-center rounded-full border-none text-white shadow-lg transition-transform active:scale-95';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 py-8 md:min-h-dvh md:justify-center">
      <button
        type="button"
        onClick={() => setIsFlipped((prev) => !prev)}
        className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-50 inline-flex touch-manipulation items-center gap-2 rounded-full border-none bg-black/65 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/80"
      >
        Turn card
        <ArrowsRightLeftIcon className="h-4 w-4" />
      </button>

      <div
        className={`relative w-[1200px] max-w-full transition-all duration-700 ease-out ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        style={{
          minHeight: 'min(680px, calc(100dvh - 7rem))',
          perspective: '1000px',
          WebkitPerspective: '1000px',
          animation: isVisible && !isFlipped && enableTilt ? 'businessCardTilt 3s ease-in-out' : 'none',
        }}
      >
        <style>{CARD_TILT_KEYFRAMES}</style>

        <div
          className="relative h-full w-full"
          style={{
            minHeight: 'inherit',
            transformStyle: 'preserve-3d',
            WebkitTransformStyle: 'preserve-3d',
            transition: 'transform 0.8s ease-in-out',
            WebkitTransition: '-webkit-transform 0.8s ease-in-out',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            WebkitTransform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          <div
            className="absolute inset-0 w-full overflow-hidden rounded-2xl bg-white"
            style={{
              minHeight: 'inherit',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(0deg) translateZ(1px)',
              WebkitTransform: 'rotateY(0deg) translateZ(1px)',
              boxShadow: isVisible ? CARD_FACE_SHADOW : '0 0 0 rgba(0, 0, 0, 0)',
            }}
          >
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${backgroundUrl})` }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60" />
            </div>

            <div className="absolute left-6 top-6 z-10">
              <img src="/DPLOGO1.png" alt="DPL Logo" className="h-14 drop-shadow-2xl" />
            </div>

            <div className="relative z-10 flex min-h-[inherit] items-center justify-center overflow-y-auto px-16 py-12">
              <div className="w-full max-w-3xl text-center text-white">
                <div className="mb-6 flex justify-center">
                  <div className="h-40 w-40 overflow-hidden rounded-full shadow-2xl">
                    <img
                      src={photoSrc}
                      alt={profile.official_name}
                      className="h-full w-full object-cover"
                      loading="eager"
                    />
                  </div>
                </div>

                <h1 className="mb-3 text-6xl font-bold leading-tight tracking-tight drop-shadow-2xl" style={SERIF}>
                  {profile.official_name}
                </h1>
                <p className="mb-4 text-2xl font-medium text-white/95 drop-shadow-lg">
                  {profile.department_name} Department
                </p>
                <p className="mb-8 text-xl font-semibold text-white/90 drop-shadow-md">{FIRM_NAME}</p>

                <div className="mt-8 flex flex-row flex-wrap items-center justify-center gap-4">
                  {employeeEmail ? (
                    <a
                      href={`mailto:${employeeEmail}`}
                      className="flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 shadow-lg backdrop-blur-md transition-all hover:bg-white/20"
                    >
                      <EnvelopeIcon className="h-5 w-5 flex-shrink-0 text-white" />
                      <span className="text-base font-medium">{employeeEmail}</span>
                    </a>
                  ) : null}
                  {profile.mobile ? (
                    <a
                      href={toTelHref(profile.mobile)}
                      className="flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 shadow-lg backdrop-blur-md transition-all hover:bg-white/20"
                    >
                      <DevicePhoneMobileIcon className="h-5 w-5 flex-shrink-0 text-white" />
                      <span className="text-base font-medium">{profile.mobile}</span>
                    </a>
                  ) : null}
                  {profile.phone ? (
                    <a
                      href={toTelHref(profile.phone)}
                      className="flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 shadow-lg backdrop-blur-md transition-all hover:bg-white/20"
                    >
                      <PhoneIcon className="h-5 w-5 flex-shrink-0 text-white" />
                      <span className="text-base font-medium">
                        {profile.phone}
                        {profile.phone_ext ? (
                          <span className="ml-2 text-white/80">Ext: {profile.phone_ext}</span>
                        ) : null}
                      </span>
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="absolute bottom-6 left-0 right-0 z-10 px-3">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(OFFICE_ADDRESS)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-auto flex max-w-lg flex-col items-center justify-center gap-1 rounded-2xl px-4 py-2 text-sm text-white/90 drop-shadow-md transition-colors hover:bg-white/10 hover:text-white"
              >
                <span className="inline-flex items-center gap-2 font-medium">
                  <MapPinIcon className="h-4 w-4" style={{ color: GOLD }} />
                  {OFFICE_LABEL}
                </span>
                <span className="text-center">{OFFICE_ADDRESS}</span>
              </a>
            </div>
          </div>

          <div
            className="absolute inset-0 w-full overflow-hidden rounded-2xl bg-white"
            style={{
              minHeight: 'inherit',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg) translateZ(1px)',
              WebkitTransform: 'rotateY(180deg) translateZ(1px)',
              boxShadow: isVisible ? CARD_FACE_SHADOW : '0 0 0 rgba(0, 0, 0, 0)',
            }}
          >
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${backgroundUrl})` }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60" />
            </div>

            <div className="absolute left-0 right-0 top-8 z-10 px-4">
              <h2 className="text-center text-2xl font-bold text-white drop-shadow-2xl">
                Decker Pex Levi Law Offices
              </h2>
            </div>

            <div className="relative z-10 flex min-h-[inherit] items-center justify-center overflow-y-auto px-16 py-12">
              <div className="w-full max-w-3xl text-center text-white">
                <h2 className="mb-6 text-3xl font-bold drop-shadow-2xl">{OFFICE_LABEL}</h2>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(OFFICE_ADDRESS)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 text-lg text-white/95 drop-shadow-lg transition-colors hover:text-white hover:underline"
                >
                  <MapPinIcon className="h-5 w-5 shrink-0" style={{ color: GOLD }} />
                  {OFFICE_ADDRESS}
                </a>
              </div>
            </div>

            <div className="absolute bottom-6 left-0 right-0 z-10 px-4">
              <div className="flex flex-row items-center justify-center gap-6 text-base text-white/95 drop-shadow-md">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="font-semibold">Email:</span>
                  <a
                    href={`mailto:${FIRM_EMAIL}`}
                    className="transition-colors hover:text-white hover:underline"
                  >
                    {FIRM_EMAIL}
                  </a>
                </div>
                <span className="text-white/60">•</span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="font-semibold">Website:</span>
                  <a
                    href="https://www.lawoffice.org.il"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-white hover:underline"
                  >
                    www.lawoffice.org.il
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 z-50 flex -translate-y-1/2 flex-col gap-3">
        <a
          href={employeeWhatsAppUrl || FIRM_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${contactFabClass} bg-green-500 hover:bg-green-600`}
          title={employeeWhatsAppUrl ? 'WhatsApp' : 'Firm WhatsApp'}
          aria-label="WhatsApp"
        >
          <FaWhatsapp className="h-6 w-6" />
        </a>
        <a
          href={employeeEmail ? `mailto:${employeeEmail}` : `mailto:${FIRM_EMAIL}`}
          className={`${contactFabClass} bg-blue-600 hover:bg-blue-700`}
          title={employeeEmail ? 'Email employee' : 'Email firm'}
          aria-label="Email"
        >
          <FaEnvelope className="h-6 w-6" />
        </a>
        <a
          href={employeeCallHref || FIRM_PHONE_TEL}
          className={`${contactFabClass} bg-purple-600 hover:bg-purple-700`}
          title={employeeCallHref ? 'Call employee' : 'Call firm'}
          aria-label="Call"
        >
          <PhoneIcon className="h-6 w-6" />
        </a>
        {profile.linkedin_url ? (
          <a
            href={profile.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${contactFabClass} bg-blue-700 hover:bg-blue-800`}
            title="LinkedIn"
            aria-label="LinkedIn"
          >
            <FaLinkedin className="h-6 w-6" />
          </a>
        ) : null}
      </div>
    </div>
  );
};

const BusinessCardPage: React.FC = () => {
  const { employeeId: employeeIdParam } = useParams<{ employeeId: string }>();
  const employeeId = parseEmployeeId(employeeIdParam);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [enableTilt, setEnableTilt] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), 50);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const fontId = 'business-card-playfair';
    if (!document.getElementById(fontId)) {
      const link = document.createElement('link');
      link.id = fontId;
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setIsMobile(mediaQuery.matches);
      setEnableTilt(!mediaQuery.matches);
    };
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  // Tint browser chrome (Safari/Chrome bottom bar + overscroll) with the card green.
  useEffect(() => {
    let themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const createdMeta = !themeMeta;
    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeMeta);
    }
    const prevThemeColor = themeMeta.getAttribute('content');
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    const prevColorScheme = document.documentElement.style.colorScheme;

    themeMeta.setAttribute('content', PANEL);
    document.documentElement.style.backgroundColor = PANEL;
    document.body.style.backgroundColor = PANEL;
    document.documentElement.style.colorScheme = 'dark';

    return () => {
      if (createdMeta) {
        themeMeta?.remove();
      } else if (prevThemeColor != null) {
        themeMeta?.setAttribute('content', prevThemeColor);
      }
      document.documentElement.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
      document.documentElement.style.colorScheme = prevColorScheme;
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!employeeId) {
      setProfile(null);
      setLoadError('Invalid business card link.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError(null);
      const data = await fetchPublicBusinessCardById(employeeId);
      if (!data) {
        setProfile(null);
        setLoadError('Profile not found.');
        return;
      }
      setProfile(data);
    } catch (error) {
      console.error('BusinessCardPage: Error fetching profile:', error);
      setProfile(null);
      setLoadError('Failed to load business card.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!profile || !employeeId) return;

    const title = `${profile.official_name} — ${FIRM_NAME}`;
    const description = `${getRoleDisplay(profile.bonuses_role)} · ${profile.department_name} Department`;
    const pageUrl = `${window.location.origin}/business-card/${employeeId}`;

    document.title = title;

    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let meta = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, key);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', pageUrl);
    setMeta('property', 'og:type', 'profile');
    if (profile.photo_url) {
      setMeta('property', 'og:image', profile.photo_url);
    }
  }, [profile, employeeId]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0F241F] px-4">
        <span className="loading loading-spinner loading-lg" style={{ color: GOLD }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-100 px-4">
        <div className="max-w-sm text-center">
          <h2 className="text-xl font-bold text-gray-800 md:text-2xl">Profile Not Found</h2>
          <p className="mt-2 text-sm text-gray-600">{loadError || 'This business card is unavailable.'}</p>
        </div>
      </div>
    );
  }

  const photoSrc = profile.photo_url || DEFAULT_AVATAR;
  const backgroundUrl = profile.chat_background_image_url || DEFAULT_BANNER;
  const cardUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/business-card/${employeeId}`
      : `/business-card/${employeeId}`;

  if (isMobile) {
    return (
      <MobileBusinessCard
        profile={profile}
        photoSrc={photoSrc}
        backgroundUrl={backgroundUrl}
        cardUrl={cardUrl}
        isVisible={isVisible}
      />
    );
  }

  return (
    <div className="min-h-dvh overflow-x-hidden overflow-y-auto bg-gray-100 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <DesktopBusinessCard
        profile={profile}
        photoSrc={photoSrc}
        backgroundUrl={backgroundUrl}
        isVisible={isVisible}
        enableTilt={enableTilt}
        isFlipped={isFlipped}
        setIsFlipped={setIsFlipped}
      />
    </div>
  );
};

export default BusinessCardPage;
