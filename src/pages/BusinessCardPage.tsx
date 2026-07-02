import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowsRightLeftIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  PhoneIcon,
} from '@heroicons/react/24/solid';
import { FaEnvelope, FaLinkedin, FaWhatsapp } from 'react-icons/fa';
import {
  fetchPublicBusinessCardById,
  getEmployeeCallPhone,
  type EmployeeProfile,
} from '../lib/fetchEmployeeProfile';

const DEFAULT_BANNER =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';
const DEFAULT_AVATAR = 'https://ui-avatars.com/api/?background=random';

const FIRM_WHATSAPP_URL = 'https://wa.me/972552780162';
const FIRM_EMAIL = 'office@lawoffice.org.il';
const FIRM_PHONE_TEL = 'tel:+972503489649';
const TEL_AVIV_OFFICE_ADDRESS = 'Menachem Begin Rd. 11, Ramat Gan, Israel';

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

const BusinessCardPage: React.FC = () => {
  const { employeeId: employeeIdParam } = useParams<{ employeeId: string }>();
  const employeeId = parseEmployeeId(employeeIdParam);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [enableTilt, setEnableTilt] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), 50);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const update = () => setEnableTilt(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
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

    const title = `${profile.official_name} — Decker, Pex, Levi Law Offices`;
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
      <div className="flex min-h-dvh items-center justify-center bg-gray-100 px-4">
        <span className="loading loading-spinner loading-lg text-primary" />
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
  const employeeWhatsAppUrl = profile.mobile ? buildWhatsAppUrl(profile.mobile) : '';
  const employeeCallHref = toTelHref(getEmployeeCallPhone(profile));
  const employeeEmail = profile.email?.trim() || '';

  const contactFabClass =
    'inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border-none text-white shadow-lg transition-transform active:scale-95 md:h-12 md:w-12';

  return (
    <div className="min-h-dvh overflow-x-hidden overflow-y-auto bg-gray-100 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-3 py-4 md:min-h-dvh md:justify-center md:px-6 md:py-8">
        <button
          type="button"
          onClick={() => setIsFlipped((prev) => !prev)}
          className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-50 inline-flex touch-manipulation items-center gap-2 rounded-full border-none bg-black/65 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/80"
        >
          Turn card
          <ArrowsRightLeftIcon className="h-4 w-4" />
        </button>

        <div
          className={`relative mt-12 w-full transition-all duration-700 ease-out md:mt-0 md:w-[1200px] ${
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
            {/* Front */}
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

              <div className="absolute left-3 top-3 z-10 md:left-6 md:top-6">
                <img src="/DPLOGO1.png" alt="DPL Logo" className="h-8 drop-shadow-2xl md:h-14" />
              </div>

              <div className="relative z-10 flex min-h-[inherit] items-center justify-center overflow-y-auto px-4 py-16 md:px-16 md:py-12">
                <div className="w-full max-w-3xl text-center text-white">
                  <div className="mb-4 flex justify-center md:mb-6">
                    <div className="h-24 w-24 overflow-hidden rounded-full shadow-2xl md:h-40 md:w-40">
                      <img
                        src={photoSrc}
                        alt={profile.official_name}
                        className="h-full w-full object-cover"
                        loading="eager"
                      />
                    </div>
                  </div>

                  <h1 className="mb-2 px-2 text-2xl font-bold leading-tight tracking-tight drop-shadow-2xl sm:text-3xl md:mb-3 md:text-6xl">
                    {profile.official_name}
                  </h1>
                  <p className="mb-3 px-2 text-sm font-medium text-white/95 drop-shadow-lg sm:text-base md:mb-4 md:text-2xl">
                    {profile.department_name} Department
                  </p>
                  <p className="mb-4 px-2 text-xs font-semibold text-white/90 drop-shadow-md sm:text-sm md:mb-8 md:text-xl">
                    Decker, Pex, Levi Law Offices
                  </p>

                  <div className="mt-4 flex flex-col items-stretch justify-center gap-2.5 px-1 sm:items-center md:mt-8 md:flex-row md:flex-wrap md:gap-4">
                    {employeeEmail ? (
                      <a
                        href={`mailto:${employeeEmail}`}
                        className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-left shadow-lg backdrop-blur-md transition-all active:bg-white/20 sm:max-w-md md:w-auto md:px-5"
                      >
                        <EnvelopeIcon className="h-4 w-4 flex-shrink-0 text-white md:h-5 md:w-5" />
                        <span className="break-all text-sm font-medium md:text-base">{employeeEmail}</span>
                      </a>
                    ) : null}
                    {profile.mobile ? (
                      <a
                        href={toTelHref(profile.mobile)}
                        className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 shadow-lg backdrop-blur-md transition-all active:bg-white/20 sm:max-w-md md:w-auto md:px-5"
                      >
                        <DevicePhoneMobileIcon className="h-4 w-4 flex-shrink-0 text-white md:h-5 md:w-5" />
                        <span className="text-sm font-medium md:text-base">{profile.mobile}</span>
                      </a>
                    ) : null}
                    {profile.phone ? (
                      <a
                        href={toTelHref(profile.phone)}
                        className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 shadow-lg backdrop-blur-md transition-all active:bg-white/20 sm:max-w-md md:w-auto md:px-5"
                      >
                        <PhoneIcon className="h-4 w-4 flex-shrink-0 text-white md:h-5 md:w-5" />
                        <span className="text-sm font-medium md:text-base">
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

              <div className="absolute bottom-3 left-0 right-0 z-10 px-3 md:bottom-6">
                <div className="flex flex-col items-center justify-center text-[11px] text-white/90 drop-shadow-md sm:text-xs md:text-sm">
                  <span className="text-center font-medium">Tel Aviv Office</span>
                  <span className="text-center">{TEL_AVIV_OFFICE_ADDRESS}</span>
                </div>
              </div>
            </div>

            {/* Back */}
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

              <div className="absolute left-0 right-0 top-6 z-10 px-4 md:top-8">
                <h2 className="text-center text-lg font-bold text-white drop-shadow-2xl sm:text-xl md:text-2xl">
                  Decker Pex Levi Law Offices
                </h2>
              </div>

              <div className="relative z-10 flex min-h-[inherit] items-center justify-center overflow-y-auto px-4 py-16 md:px-16 md:py-12">
                <div className="w-full max-w-3xl text-center text-white">
                  <h2 className="mb-3 text-xl font-bold drop-shadow-2xl sm:text-2xl md:mb-6 md:text-3xl">
                    Tel Aviv Office
                  </h2>
                  <p className="text-sm text-white/95 drop-shadow-lg sm:text-base md:text-lg">
                    {TEL_AVIV_OFFICE_ADDRESS}
                  </p>
                </div>
              </div>

              <div className="absolute bottom-3 left-0 right-0 z-10 px-4 md:bottom-6">
                <div className="flex flex-col items-center justify-center gap-3 text-xs text-white/95 drop-shadow-md sm:text-sm md:flex-row md:gap-6 md:text-base">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="font-semibold">Email:</span>
                    <a
                      href={`mailto:${FIRM_EMAIL}`}
                      className="touch-manipulation break-all transition-colors hover:text-white hover:underline"
                    >
                      {FIRM_EMAIL}
                    </a>
                  </div>
                  <span className="hidden text-white/60 md:inline">•</span>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="font-semibold">Website:</span>
                    <a
                      href="https://www.lawoffice.org.il"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="touch-manipulation transition-colors hover:text-white hover:underline"
                    >
                      www.lawoffice.org.il
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick contact — employee first, firm fallback; bottom-right on mobile, mid-right on desktop */}
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-50 flex flex-col gap-2.5 md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:gap-3">
          <a
            href={employeeWhatsAppUrl || FIRM_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${contactFabClass} bg-green-500 hover:bg-green-600`}
            title={employeeWhatsAppUrl ? 'WhatsApp' : 'Firm WhatsApp'}
            aria-label="WhatsApp"
          >
            <FaWhatsapp className="h-5 w-5 md:h-6 md:w-6" />
          </a>
          <a
            href={employeeEmail ? `mailto:${employeeEmail}` : `mailto:${FIRM_EMAIL}`}
            className={`${contactFabClass} bg-blue-600 hover:bg-blue-700`}
            title={employeeEmail ? 'Email employee' : 'Email firm'}
            aria-label="Email"
          >
            <FaEnvelope className="h-5 w-5 md:h-6 md:w-6" />
          </a>
          <a
            href={employeeCallHref || FIRM_PHONE_TEL}
            className={`${contactFabClass} bg-purple-600 hover:bg-purple-700`}
            title={employeeCallHref ? 'Call employee' : 'Call firm'}
            aria-label="Call"
          >
            <PhoneIcon className="h-5 w-5 md:h-6 md:w-6" />
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
              <FaLinkedin className="h-5 w-5 md:h-6 md:w-6" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default BusinessCardPage;
