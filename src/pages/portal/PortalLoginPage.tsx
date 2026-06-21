import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { portalLogin } from '../../lib/portalApi';
import { setPortalSession } from '../../lib/portalSession';
import { usePortalSession } from './usePortalSession';
import PortalPublicShell from './components/PortalPublicShell';
import { PortalLoginI18nProvider, usePortalLoginI18n } from './i18n/PortalLoginI18nContext';

const INPUT_CLASS =
  'h-11 w-full rounded-[10px] border border-base-300 bg-white px-4 text-sm text-base-content shadow-sm transition placeholder:text-base-content/35 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

const PortalLoginForm: React.FC = () => {
  const { leadRef = '' } = useParams<{ leadRef: string }>();
  const navigate = useNavigate();
  const { loading: sessionLoading, valid } = usePortalSession(false);
  const { t, format } = usePortalLoginI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sessionLoading && valid && leadRef) {
      navigate(`/portal/${encodeURIComponent(leadRef)}/case`, { replace: true });
    }
  }, [sessionLoading, valid, leadRef, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadRef) {
      toast.error(t.invalidPortalLink);
      return;
    }
    setSubmitting(true);
    try {
      const result = await portalLogin(decodeURIComponent(leadRef), email, password);
      if (!result.ok || !result.session_token) {
        toast.error(result.error || t.invalidCredentials);
        return;
      }
      setPortalSession(result.session_token, result.lead_ref || leadRef);
      toast.success(
        result.contact?.name
          ? format('welcome', { name: result.contact.name })
          : t.signIn,
      );
      navigate(`/portal/${encodeURIComponent(result.lead_ref || leadRef)}/case`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.loginFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const caseNumber = leadRef ? decodeURIComponent(leadRef) : '';
  const subtitle = caseNumber
    ? format('signInSubtitleWithCase', { case: caseNumber })
    : t.signInSubtitle;

  const loginHeader = (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-base-content md:text-3xl">
        {t.clientPortal}
      </h1>
      <p className="mt-3 text-base text-base-content/55 md:text-lg">{subtitle}</p>
    </div>
  );

  if (sessionLoading) {
    return (
      <PortalPublicShell leadRef={leadRef} showLanguageSwitcher splitHero>
        <div className="w-full">
          {loginHeader}
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      </PortalPublicShell>
    );
  }

  return (
    <PortalPublicShell leadRef={leadRef} showLanguageSwitcher splitHero>
      <div className="w-full">
        {loginHeader}

        <form onSubmit={handleSubmit} className="space-y-7">
          <div>
            <label className="mb-2.5 block text-sm font-medium text-base-content/60" htmlFor="portal-email">
              {t.email}
            </label>
            <input
              id="portal-email"
              type="email"
              autoComplete="email"
              required
              placeholder={t.emailPlaceholder}
              className={INPUT_CLASS}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-2.5 block text-sm font-medium text-base-content/60" htmlFor="portal-password">
              {t.password}
            </label>
            <input
              id="portal-password"
              type="password"
              autoComplete="current-password"
              required
              placeholder={t.passwordPlaceholder}
              className={INPUT_CLASS}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary mt-2 h-11 w-full rounded-xl border-0 font-semibold"
            disabled={submitting}
          >
            {submitting ? t.signingIn : t.signIn}
          </button>
        </form>

        <p className="mt-10 text-xs leading-relaxed text-base-content/45">{t.signInHint}</p>
      </div>
    </PortalPublicShell>
  );
};

const PortalLoginPage: React.FC = () => (
  <PortalLoginI18nProvider>
    <PortalLoginForm />
  </PortalLoginI18nProvider>
);

export default PortalLoginPage;
