import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicContactDropdown from '../../../components/public/PublicContactDropdown';
import { usePortalLoginI18nOptional } from '../i18n/PortalLoginI18nContext';
import PortalLanguageSwitcher from './PortalLanguageSwitcher';

type Props = {
  leadRef: string;
  variant?: 'hero' | 'light';
  showLanguageSwitcher?: boolean;
  hideAboutLink?: boolean;
};

const PortalPublicNav: React.FC<Props> = ({
  leadRef,
  variant = 'hero',
  showLanguageSwitcher = false,
  hideAboutLink = false,
}) => {
  const location = useLocation();
  const i18n = usePortalLoginI18nOptional();
  const encodedRef = encodeURIComponent(leadRef);
  const aboutPath = `/portal/${encodedRef}/about`;
  const signInPath = `/portal/${encodedRef}`;
  const isAbout = location.pathname.endsWith('/about');

  const linkClass =
    variant === 'hero'
      ? 'rounded-full px-3.5 py-2 text-sm font-medium text-white/95 transition-colors hover:bg-white/15 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]'
      : 'rounded-full px-3.5 py-2 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-200/80';

  const activeLinkClass =
    variant === 'hero' ? 'bg-white/20 ring-1 ring-white/25' : 'bg-base-200 text-base-content/90';

  const aboutLabel = i18n?.t.about ?? 'About';
  const contactLabel = i18n?.t.contact ?? 'Contact';
  const signInLabel = i18n?.t.signInNav ?? 'Sign in';

  return (
    <nav className="flex items-center gap-1 sm:gap-2">
      {!hideAboutLink ? (
        <Link
          to={aboutPath}
          className={`${linkClass} ${isAbout ? activeLinkClass : ''}`}
        >
          {aboutLabel}
        </Link>
      ) : null}
      <PublicContactDropdown
        label={contactLabel}
        variant={variant === 'hero' ? 'hero' : 'default'}
        placement="down"
        contactUsLabel={i18n?.t.contactUs}
        whatsappLabel={i18n?.t.whatsapp}
        emailLabel={i18n?.t.email}
        callLabel={i18n?.t.call}
      />
      {isAbout ? (
        <Link to={signInPath} className={linkClass}>
          {signInLabel}
        </Link>
      ) : null}
      {showLanguageSwitcher ? (
        <PortalLanguageSwitcher variant={variant === 'hero' ? 'hero' : 'default'} />
      ) : null}
    </nav>
  );
};

export default PortalPublicNav;
