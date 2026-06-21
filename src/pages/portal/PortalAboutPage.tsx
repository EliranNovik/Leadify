import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import PortalPublicShell from './components/PortalPublicShell';
import { PortalLoginI18nProvider, usePortalLoginI18n } from './i18n/PortalLoginI18nContext';

const PortalAboutContent: React.FC = () => {
  const { leadRef = '' } = useParams<{ leadRef: string }>();
  const { t } = usePortalLoginI18n();
  const signInPath = `/portal/${encodeURIComponent(leadRef)}`;

  const features = [
    { title: t.aboutFeature1Title, body: t.aboutFeature1Body },
    { title: t.aboutFeature2Title, body: t.aboutFeature2Body },
    { title: t.aboutFeature3Title, body: t.aboutFeature3Body },
    { title: t.aboutFeature4Title, body: t.aboutFeature4Body },
  ];

  return (
    <PortalPublicShell leadRef={leadRef} showLanguageSwitcher>
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white shadow-lg backdrop-blur-sm ring-1 ring-white/20">
            <ShieldCheckIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">
            {t.aboutTitle}
          </h1>
          <p className="mt-2 text-sm text-white/80 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
            {t.aboutSubtitle}
          </p>
        </div>

        <div className="rounded-[18px] bg-white/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-md md:p-8">
          <p className="text-sm leading-relaxed text-base-content/75">{t.aboutIntro}</p>

          <ul className="mt-6 space-y-4">
            {features.map((item) => (
              <li key={item.title}>
                <h2 className="text-sm font-bold text-base-content/90">{item.title}</h2>
                <p className="mt-1 text-sm text-base-content/60">{item.body}</p>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-sm text-base-content/55">
            {t.aboutHelpPrefix}{' '}
            <strong className="font-semibold text-base-content/75">{t.contact}</strong>{' '}
            {t.aboutHelpMiddle}{' '}
            <strong className="font-semibold text-base-content/75">{t.needHelp}</strong>{' '}
            {t.aboutHelpSuffix}
          </p>

          <div className="mt-8 flex justify-center">
            <Link to={signInPath} className="btn btn-primary rounded-full px-8">
              {t.signInToPortal}
            </Link>
          </div>
        </div>
      </div>
    </PortalPublicShell>
  );
};

const PortalAboutPage: React.FC = () => (
  <PortalLoginI18nProvider>
    <PortalAboutContent />
  </PortalLoginI18nProvider>
);

export default PortalAboutPage;
