import React, { useEffect, useRef, useState } from 'react';
import {
  Bars3Icon,
  XMarkIcon,
  PhoneIcon,
  EnvelopeIcon,
  ChevronDownIcon,
  ChatBubbleLeftRightIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';
import { getGreetingFirstName, getTimeBasedGreeting } from '../lib/clockInGreeting';

const CONTACT_EMPLOYEE_IDS = [1, 3] as const;

const CONTACT_PHONE_OVERRIDES: Record<number, string> = {
  3: '0547652074',
};

type EmployeeContact = {
  id: number;
  display_name: string;
  photo_url: string | null;
  photo: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
};

type CurrentEmployeeProfile = {
  id: number;
  display_name: string;
  photo_url: string | null;
  photo: string | null;
};

function resolvePhotoUrl(emp: { photo_url?: string | null; photo?: string | null }): string {
  const url = (emp.photo_url?.trim() || emp.photo?.trim() || '');
  return url;
}

function resolvePhone(emp: EmployeeContact): string | null {
  const override = CONTACT_PHONE_OVERRIDES[emp.id];
  if (override) return override;
  const mobile = emp.mobile?.trim();
  const phone = emp.phone?.trim();
  return mobile || phone || null;
}

function resolveMobile(emp: EmployeeContact): string | null {
  const override = CONTACT_PHONE_OVERRIDES[emp.id];
  if (override) return override;
  const mobile = emp.mobile?.trim();
  return mobile || null;
}

function buildWhatsAppUrl(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

const EmployeeCircle: React.FC<{
  employee: { id: number; display_name: string; photo_url?: string | null; photo?: string | null };
  sizeClass?: string;
  showRing?: boolean;
}> = ({ employee, sizeClass = 'w-10 h-10 text-sm', showRing = true }) => {
  const [imgErr, setImgErr] = useState(false);
  const photo = resolvePhotoUrl(employee);
  const showPhoto = photo.length > 0 && !imgErr;
  const ringClass = showRing ? 'ring-2 ring-white/30' : '';

  if (showPhoto) {
    return (
      <img
        src={photo}
        alt=""
        className={`${sizeClass} rounded-full object-cover shrink-0 ${ringClass}`}
        onError={() => setImgErr(true)}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} shrink-0 flex items-center justify-center rounded-full font-bold text-white ${ringClass}`}
      style={salaryAvatarGradientStyle(employee.id, employee.display_name)}
      aria-hidden
    >
      {getSalaryEmployeeInitials(employee.display_name)}
    </span>
  );
};

type ClockInGateHeaderProps = {
  employeeId: number | null;
  onSignOut?: () => void;
  onOpenMessaging?: () => void;
  onOpenCalendar?: () => void;
};

const ClockInGateHeader: React.FC<ClockInGateHeaderProps> = ({
  employeeId,
  onSignOut,
  onOpenMessaging,
  onOpenCalendar,
}) => {
  const { profilePhotoUrl, userFullName } = useAuthContext();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState<CurrentEmployeeProfile | null>(null);
  const [contacts, setContacts] = useState<EmployeeContact[]>([]);
  const contactRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!employeeId) {
      setCurrentEmployee(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .eq('id', employeeId)
        .maybeSingle();
      if (data) {
        setCurrentEmployee(data as CurrentEmployeeProfile);
      }
    })().catch(() => setCurrentEmployee(null));
  }, [employeeId]);

  useEffect(() => {
    void (async () => {
      const { data: employees } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo, mobile, phone')
        .in('id', [...CONTACT_EMPLOYEE_IDS]);

      const { data: users } = await supabase
        .from('users')
        .select('employee_id, email')
        .in('employee_id', [...CONTACT_EMPLOYEE_IDS]);

      const emailByEmployee = new Map<number, string>();
      (users || []).forEach((row) => {
        if (row.employee_id != null && row.email) {
          emailByEmployee.set(Number(row.employee_id), String(row.email).trim());
        }
      });

      const ordered = CONTACT_EMPLOYEE_IDS.map((id) => {
        const emp = (employees || []).find((e) => Number(e.id) === id);
        if (!emp) {
          return {
            id,
            display_name: `Employee #${id}`,
            photo_url: null,
            photo: null,
            mobile: null,
            phone: null,
            email: emailByEmployee.get(id) ?? null,
          };
        }
        return {
          id: Number(emp.id),
          display_name: emp.display_name?.trim() || `Employee #${id}`,
          photo_url: emp.photo_url ?? null,
          photo: emp.photo ?? null,
          mobile: emp.mobile ?? null,
          phone: emp.phone ?? null,
          email: emailByEmployee.get(id) ?? null,
        };
      });

      setContacts(ordered);
    })();
  }, []);

  useEffect(() => {
    if (!contactOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (contactRef.current && !contactRef.current.contains(e.target as Node)) {
        setContactOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [contactOpen]);

  const headerProfile = currentEmployee
    ? {
        id: currentEmployee.id,
        display_name: currentEmployee.display_name || userFullName || 'You',
        photo_url: currentEmployee.photo_url,
        photo: currentEmployee.photo,
      }
    : employeeId
      ? {
          id: employeeId,
          display_name: userFullName || 'You',
          photo_url: profilePhotoUrl,
          photo: null,
        }
      : null;

  const welcomeFirstName = getGreetingFirstName(
    headerProfile?.display_name || userFullName || '',
  );
  const welcomeText = welcomeFirstName
    ? `${getTimeBasedGreeting()}, ${welcomeFirstName}`
    : getTimeBasedGreeting();

  return (
    <header
      className="absolute top-0 left-0 right-0 z-30 pt-safe"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
    >
      <div className="relative flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        {/* Hamburger + firm name */}
        <div className="flex items-center gap-3 min-w-0 z-10">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              className="text-white hover:text-gray-200 transition-colors"
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMenuOpen ? <XMarkIcon className="w-7 h-7" /> : <Bars3Icon className="w-7 h-7" />}
            </button>
            {isMenuOpen && (
              <div className="absolute top-full left-0 mt-2 min-w-[12rem] shadow-lg z-40 bg-black/75 border border-white/15 backdrop-blur-md rounded-xl overflow-hidden">
                <div className="md:hidden">
                  {onOpenMessaging && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenMessaging();
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10 inline-flex items-center gap-2"
                    >
                      <ChatBubbleLeftRightIcon className="w-4 h-4 shrink-0" />
                      RMQ Messaging
                    </button>
                  )}
                  {onOpenCalendar && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenCalendar();
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10 inline-flex items-center gap-2"
                    >
                      <CalendarIcon className="w-4 h-4 shrink-0" />
                      Calendar
                    </button>
                  )}
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={() => { setIsMenuOpen(false); onSignOut(); }}
                    className={`w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10 ${
                      onOpenMessaging || onOpenCalendar ? 'border-t border-white/10' : ''
                    }`}
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
          <img
            src="/DPLOGO1.png"
            alt="Decker Pex & Co."
            className="md:hidden h-9 w-auto max-w-[8rem] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] shrink-0"
          />
          {headerProfile && (
            <div className="hidden md:flex items-center gap-3 min-w-0">
              <EmployeeCircle
                employee={headerProfile}
                sizeClass="w-12 h-12 text-sm shrink-0"
                showRing={false}
              />
              <p
                className="text-white font-semibold text-3xl tracking-wide drop-shadow-[0_1px_4px_rgba(0,0,0,0.55)] text-left truncate"
                style={{ fontFamily: "'Playfair Display', 'Libre Baskerville', serif" }}
              >
                {welcomeText}
              </p>
            </div>
          )}
        </div>

        {/* RMQ messaging, calendar, contact + profile */}
        <div className="flex items-center gap-2 md:gap-3 min-w-0 z-10">
          {onOpenMessaging && (
            <button
              type="button"
              onClick={onOpenMessaging}
              className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-black/25 backdrop-blur-sm px-3 py-1.5 text-sm font-medium text-white hover:bg-black/40 transition-colors shrink-0"
              title="RMQ Messaging"
            >
              <ChatBubbleLeftRightIcon className="w-4 h-4 shrink-0" />
              RMQ Messaging
            </button>
          )}

          {onOpenCalendar && (
            <button
              type="button"
              onClick={onOpenCalendar}
              className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-black/25 backdrop-blur-sm px-3 py-1.5 text-sm font-medium text-white hover:bg-black/40 transition-colors shrink-0"
              title="Calendar"
            >
              <CalendarIcon className="w-4 h-4 shrink-0" />
              Calendar
            </button>
          )}

          <div className="relative" ref={contactRef}>
            <button
              type="button"
              onClick={() => setContactOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/25 backdrop-blur-sm px-3 py-1.5 text-sm font-medium text-white hover:bg-black/40 transition-colors"
              aria-expanded={contactOpen}
              aria-haspopup="true"
            >
              Contact
              <ChevronDownIcon className={`w-4 h-4 transition-transform ${contactOpen ? 'rotate-180' : ''}`} />
            </button>

            {contactOpen && (
              <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl bg-gray-700/95 backdrop-blur-md shadow-xl overflow-hidden z-50">
                <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-300">
                  Need help?
                </div>
                <div className="py-2">
                  {contacts.map((contact) => {
                    const phone = resolvePhone(contact);
                    const mobile = resolveMobile(contact);
                    const whatsAppUrl = mobile ? buildWhatsAppUrl(mobile) : '';
                    return (
                      <div key={contact.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-3 mb-2">
                          <EmployeeCircle
                            employee={contact}
                            sizeClass="w-11 h-11 text-xs"
                            showRing={false}
                          />
                          <span className="text-sm font-semibold text-gray-100 truncate">
                            {contact.display_name}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 pl-14">
                          {phone ? (
                            <a
                              href={`tel:${phone}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-600/80 hover:bg-gray-600 px-2.5 py-1.5 text-xs text-gray-100"
                            >
                              <PhoneIcon className="w-3.5 h-3.5" />
                              Call
                            </a>
                          ) : (
                            <span className="text-xs text-gray-500 px-1">No phone</span>
                          )}
                          {contact.email ? (
                            <a
                              href={`mailto:${contact.email}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-600/80 hover:bg-gray-600 px-2.5 py-1.5 text-xs text-gray-100"
                            >
                              <EnvelopeIcon className="w-3.5 h-3.5" />
                              Email
                            </a>
                          ) : (
                            <span className="text-xs text-gray-500 px-1">No email</span>
                          )}
                          {whatsAppUrl ? (
                            <a
                              href={whatsAppUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-600/80 hover:bg-gray-600 px-2.5 py-1.5 text-xs text-green-400"
                            >
                              <FaWhatsapp className="w-3.5 h-3.5" />
                              WhatsApp
                            </a>
                          ) : (
                            <span className="text-xs text-gray-500 px-1">No WhatsApp</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {headerProfile && (
            <div className="flex md:hidden items-center gap-2 min-w-0" title={headerProfile.display_name}>
              <EmployeeCircle
                employee={headerProfile}
                sizeClass="w-10 h-10 text-sm"
                showRing={false}
              />
              <span className="hidden sm:block text-sm font-medium text-white truncate max-w-[8rem] drop-shadow">
                {headerProfile.display_name}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default ClockInGateHeader;
