import React, { useEffect, useState } from 'react';
import {
  ArrowsRightLeftIcon,
  EnvelopeIcon,
  PhoneIcon,
  DevicePhoneMobileIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { EmployeeProfile } from '../lib/fetchEmployeeProfile';

const DEFAULT_BACKGROUND =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';

const CARD_TILT_KEYFRAMES = `
  @keyframes employeeCardTilt {
    0%, 100% { transform: perspective(1000px) rotateX(0deg) rotateY(0deg); }
    25% { transform: perspective(1000px) rotateX(0deg) rotateY(-2deg); }
    50% { transform: perspective(1000px) rotateX(0deg) rotateY(2deg); }
    75% { transform: perspective(1000px) rotateX(0deg) rotateY(-1deg); }
  }
`;

const CARD_FACE_SHADOW =
  '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 10px 30px -5px rgba(0, 0, 0, 0.3), 0 0 60px -15px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';

const TEL_AVIV_OFFICE_ADDRESS = 'Menachem Begin Rd. 11, Ramat Gan, Israel';

type Props = {
  employee: EmployeeProfile;
  open: boolean;
  onClose: () => void;
};

const EmployeeBusinessCardModal: React.FC<Props> = ({ employee, open, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    }
    setIsVisible(false);
    setIsFlipped(false);
    return undefined;
  }, [open]);

  if (!open) return null;

  const photoSrc = employee.photo_url || 'https://ui-avatars.com/api/?background=random';
  const backgroundUrl = employee.chat_background_image_url || DEFAULT_BACKGROUND;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm print-hide"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative max-h-[90vh] w-full max-w-[95vw] overflow-hidden rounded-2xl bg-transparent shadow-2xl md:max-w-6xl">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped((prev) => !prev);
          }}
          className="absolute right-[4.25rem] top-4 z-[110] flex items-center gap-2 border-none bg-black/60 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-md hover:bg-black/80 md:right-[5.5rem] md:top-4"
        >
          Turn card
          <ArrowsRightLeftIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-4 top-4 z-[110] btn btn-circle btn-sm border-none bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <div
          className={`relative min-h-[400px] w-full transition-all duration-700 ease-out md:min-h-[630px] ${
            isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}
          style={{
            perspective: '1000px',
            animation: isVisible && !isFlipped ? 'employeeCardTilt 3s ease-in-out' : 'none',
          }}
        >
          <style>{CARD_TILT_KEYFRAMES}</style>

          <div
            className="relative h-full min-h-[400px] w-full md:min-h-[630px]"
            style={{
              transformStyle: 'preserve-3d',
              transition: 'transform 0.8s ease-in-out',
              transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 w-full overflow-hidden rounded-2xl bg-white"
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(0deg)',
                boxShadow: isVisible ? CARD_FACE_SHADOW : '0 0 0 rgba(0, 0, 0, 0)',
              }}
            >
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${backgroundUrl})` }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60" />
              </div>

              <div className="absolute left-4 top-4 z-10 md:left-6 md:top-6">
                <img src="/DPLOGO1.png" alt="DPL Logo" className="h-8 drop-shadow-2xl md:h-14" />
              </div>

              <div className="relative z-10 flex min-h-[400px] items-center justify-center px-4 py-8 md:min-h-[630px] md:px-16 md:py-12">
                <div className="-mt-8 w-full max-w-3xl text-center text-white md:-mt-12">
                  <div className="mb-4 flex justify-center md:mb-6">
                    <div className="h-24 w-24 overflow-hidden rounded-full shadow-2xl md:h-40 md:w-40">
                      <img src={photoSrc} alt={employee.official_name} className="h-full w-full object-cover" />
                    </div>
                  </div>

                  <h1 className="mb-2 px-2 text-3xl font-bold tracking-tight drop-shadow-2xl md:mb-3 md:text-6xl">
                    {employee.official_name}
                  </h1>
                  <p className="mb-3 px-2 text-base font-medium text-white/95 drop-shadow-lg md:mb-4 md:text-2xl">
                    {employee.department_name} Department
                  </p>
                  <p className="mb-4 px-2 text-sm font-semibold text-white/90 drop-shadow-md md:mb-8 md:text-xl">
                    Decker, Pex, Levi Law Offices
                  </p>

                  <div className="mt-4 flex flex-col items-center justify-center gap-3 px-2 md:mt-8 md:flex-row md:gap-6">
                    {employee.email && (
                      <a
                        href={`mailto:${employee.email}`}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 md:w-auto md:gap-3 md:px-5 md:py-2.5"
                      >
                        <EnvelopeIcon className="h-4 w-4 flex-shrink-0 text-white md:h-5 md:w-5" />
                        <span className="break-all text-xs font-medium md:text-base">{employee.email}</span>
                      </a>
                    )}
                    {employee.mobile && (
                      <a
                        href={`tel:${employee.mobile}`}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 md:w-auto md:gap-3 md:px-5 md:py-2.5"
                      >
                        <DevicePhoneMobileIcon className="h-4 w-4 flex-shrink-0 text-white md:h-5 md:w-5" />
                        <span className="text-xs font-medium md:text-base">{employee.mobile}</span>
                      </a>
                    )}
                    {employee.phone && (
                      <a
                        href={`tel:${employee.phone}`}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 shadow-lg backdrop-blur-md transition-all hover:bg-white/20 md:w-auto md:gap-3 md:px-5 md:py-2.5"
                      >
                        <PhoneIcon className="h-4 w-4 flex-shrink-0 text-white md:h-5 md:w-5" />
                        <span className="text-xs font-medium md:text-base">
                          {employee.phone}
                          {employee.phone_ext && (
                            <span className="ml-2 text-white/80">Ext: {employee.phone_ext}</span>
                          )}
                        </span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="absolute bottom-3 left-0 right-0 z-10 px-3 md:bottom-6 md:px-0">
                <div className="flex flex-col items-center justify-center text-xs text-white/90 drop-shadow-md md:text-sm">
                  <span className="text-center font-medium">Tel Aviv Office</span>
                  <span className="text-center">{TEL_AVIV_OFFICE_ADDRESS}</span>
                </div>
              </div>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 w-full overflow-hidden rounded-2xl bg-white"
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
                boxShadow: isVisible ? CARD_FACE_SHADOW : '0 0 0 rgba(0, 0, 0, 0)',
              }}
            >
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${backgroundUrl})` }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60" />
              </div>

              <div className="absolute left-0 right-0 top-6 z-10 md:top-8">
                <h2 className="text-center text-xl font-bold text-white drop-shadow-2xl md:text-2xl">
                  Decker Pex Levi Law Offices
                </h2>
              </div>

              <div className="relative z-10 flex min-h-[400px] items-center justify-center px-4 py-8 md:min-h-[630px] md:px-16 md:py-12">
                <div className="w-full max-w-3xl text-center text-white">
                  <h2 className="mb-4 text-2xl font-bold drop-shadow-2xl md:mb-6 md:text-3xl">
                    Tel Aviv Office
                  </h2>
                  <p className="text-base text-white/95 drop-shadow-lg md:text-lg">
                    {TEL_AVIV_OFFICE_ADDRESS}
                  </p>
                </div>
              </div>

              <div className="absolute bottom-4 left-0 right-0 z-10 md:bottom-6">
                <div className="flex flex-col items-center justify-center gap-4 px-4 text-sm text-white/95 drop-shadow-md md:flex-row md:gap-6 md:text-base">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Email:</span>
                    <a
                      href="mailto:office@lawoffice.org.il"
                      className="transition-colors hover:text-white hover:underline"
                    >
                      office@lawoffice.org.il
                    </a>
                  </div>
                  <span className="hidden text-white/60 md:inline">•</span>
                  <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
};

export default EmployeeBusinessCardModal;
