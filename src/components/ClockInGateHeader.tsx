import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bars3Icon,
  XMarkIcon,
  PhoneIcon,
  EnvelopeIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';

const CONTACT_EMPLOYEE_IDS = [1, 3] as const;

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
  const mobile = emp.mobile?.trim();
  const phone = emp.phone?.trim();
  return mobile || phone || null;
}

const EmployeeCircle: React.FC<{
  employee: { id: number; display_name: string; photo_url?: string | null; photo?: string | null };
  sizeClass?: string;
}> = ({ employee, sizeClass = 'w-10 h-10 text-sm' }) => {
  const [imgErr, setImgErr] = useState(false);
  const photo = resolvePhotoUrl(employee);
  const showPhoto = photo.length > 0 && !imgErr;

  if (showPhoto) {
    return (
      <img
        src={photo}
        alt=""
        className={`${sizeClass} rounded-full object-cover ring-2 ring-white/30 shrink-0`}
        onError={() => setImgErr(true)}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} shrink-0 flex items-center justify-center rounded-full font-bold text-white ring-2 ring-white/30`}
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
};

const ClockInGateHeader: React.FC<ClockInGateHeaderProps> = ({ employeeId, onSignOut }) => {
  const navigate = useNavigate();
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
    void supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo')
      .eq('id', employeeId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCurrentEmployee(data as CurrentEmployeeProfile);
        }
      })
      .catch(() => setCurrentEmployee(null));
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

  return (
    <header
      className="absolute top-0 left-0 right-0 z-30 pt-safe"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        {/* Hamburger */}
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
              <button
                type="button"
                onClick={() => { navigate('/about'); setIsMenuOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10"
              >
                About Us
              </button>
              <button
                type="button"
                onClick={() => { navigate('/how-it-works'); setIsMenuOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10"
              >
                How It Works
              </button>
              {onSignOut && (
                <button
                  type="button"
                  onClick={() => { setIsMenuOpen(false); onSignOut(); }}
                  className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10 border-t border-white/10"
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>

        {/* Contact + profile */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="relative" ref={contactRef}>
            <button
              type="button"
              onClick={() => setContactOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/25 backdrop-blur-sm px-3 py-1.5 text-sm font-medium text-white hover:bg-black/40 transition-colors"
              aria-expanded={contactOpen}
              aria-haspopup="true"
            >
              Contact
              <ChevronDownIcon className={`w-4 h-4 transition-transform ${contactOpen ? 'rotate-180' : ''}`} />
            </button>

            {contactOpen && (
              <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-black/80 backdrop-blur-md shadow-xl overflow-hidden z-50">
                <div className="px-4 py-2.5 border-b border-white/10 text-xs font-semibold uppercase tracking-wide text-white/60">
                  Need help?
                </div>
                <div className="py-2">
                  {contacts.map((contact) => {
                    const phone = resolvePhone(contact);
                    return (
                      <div key={contact.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-3 mb-2">
                          <EmployeeCircle employee={contact} sizeClass="w-11 h-11 text-xs" />
                          <span className="text-sm font-semibold text-white truncate">
                            {contact.display_name}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 pl-14">
                          {phone ? (
                            <a
                              href={`tel:${phone}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-2.5 py-1.5 text-xs text-white"
                            >
                              <PhoneIcon className="w-3.5 h-3.5" />
                              Call
                            </a>
                          ) : (
                            <span className="text-xs text-white/40 px-1">No phone</span>
                          )}
                          {contact.email ? (
                            <a
                              href={`mailto:${contact.email}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-2.5 py-1.5 text-xs text-white"
                            >
                              <EnvelopeIcon className="w-3.5 h-3.5" />
                              Email
                            </a>
                          ) : (
                            <span className="text-xs text-white/40 px-1">No email</span>
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
            <div className="flex items-center gap-2 min-w-0" title={headerProfile.display_name}>
              <EmployeeCircle employee={headerProfile} sizeClass="w-10 h-10 md:w-11 md:h-11 text-sm" />
              <span className="hidden sm:block text-sm font-medium text-white truncate max-w-[8rem] md:max-w-[12rem] drop-shadow">
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
