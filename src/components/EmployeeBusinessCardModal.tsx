import React, { useEffect, useState } from 'react';
import {
  EnvelopeIcon,
  PhoneIcon,
  DevicePhoneMobileIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { EmployeeProfile } from '../lib/fetchEmployeeProfile';

const DEFAULT_BACKGROUND =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';

type Props = {
  employee: EmployeeProfile;
  open: boolean;
  onClose: () => void;
};

const EmployeeBusinessCardModal: React.FC<Props> = ({ employee, open, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    }
    setIsVisible(false);
    return undefined;
  }, [open]);

  if (!open) return null;

  const photoSrc = employee.photo_url || 'https://ui-avatars.com/api/?background=random';

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
            onClose();
          }}
          className="absolute right-4 top-4 z-[110] btn btn-circle btn-sm border-none bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <div
          className="relative min-h-[400px] w-full overflow-hidden rounded-2xl md:min-h-[630px]"
          style={{
            perspective: '1000px',
            animation: isVisible ? 'employeeCardTilt 3s ease-in-out' : 'none',
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'scale(1)' : 'scale(0.95)',
            transition: 'opacity 0.7s ease-out, transform 0.7s ease-out',
          }}
        >
          <style>{`
            @keyframes employeeCardTilt {
              0%, 100% { transform: perspective(1000px) rotateX(0deg) rotateY(0deg); }
              25% { transform: perspective(1000px) rotateX(0deg) rotateY(-2deg); }
              50% { transform: perspective(1000px) rotateX(0deg) rotateY(2deg); }
              75% { transform: perspective(1000px) rotateX(0deg) rotateY(-1deg); }
            }
          `}</style>

          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${employee.chat_background_image_url || DEFAULT_BACKGROUND})`,
            }}
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

          <div className="absolute bottom-6 left-0 right-0 z-10 hidden md:block">
            <div className="flex flex-row items-center justify-center gap-6 text-sm text-white/90 drop-shadow-md">
              <span>Yad Harutzim 10, Jerusalem, Israel</span>
              <span className="text-white/60">•</span>
              <span>Menachem Begin Rd. 150, Tel Aviv, Israel</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeBusinessCardModal;
