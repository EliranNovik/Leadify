export type PortalLoginLocale = 'en' | 'he' | 'fr' | 'de';

export const PORTAL_LOGIN_LOCALES: Array<{ code: PortalLoginLocale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'עברית' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
];

export type PortalLoginMessages = {
  navAbout: string;
  navContact: string;
  title: string;
  subtitle: string;
  subtitleCase: string;
  email: string;
  password: string;
  signIn: string;
  signingIn: string;
  helperText: string;
  invalidLink: string;
  invalidCredentials: string;
  loginFailed: string;
  welcome: string;
};

export const portalLoginMessages: Record<PortalLoginLocale, PortalLoginMessages> = {
  en: {
    navAbout: 'About',
    navContact: 'Contact',
    title: 'Client Portal',
    subtitle: 'Sign in to view your case',
    subtitleCase: 'Sign in to view your case #{{case}}',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    helperText: 'Use the email on file for this case and the password provided by our office.',
    invalidLink: 'Invalid portal link',
    invalidCredentials: 'Invalid email or password',
    loginFailed: 'Login failed',
    welcome: 'Welcome',
  },
  he: {
    navAbout: 'אודות',
    navContact: 'צור קשר',
    title: 'פורטל לקוחות',
    subtitle: 'התחברו כדי לצפות בתיק שלכם',
    subtitleCase: 'התחברו כדי לצפות בתיק #{{case}}',
    email: 'אימייל',
    password: 'סיסמה',
    signIn: 'התחברות',
    signingIn: 'מתחבר…',
    helperText: 'השתמשו באימייל הרשום בתיק ובסיסמה שקיבלתם ממשרדנו.',
    invalidLink: 'קישור פורטל לא תקין',
    invalidCredentials: 'אימייל או סיסמה שגויים',
    loginFailed: 'ההתחברות נכשלה',
    welcome: 'ברוכים הבאים',
  },
  fr: {
    navAbout: 'À propos',
    navContact: 'Contact',
    title: 'Portail client',
    subtitle: 'Connectez-vous pour consulter votre dossier',
    subtitleCase: 'Connectez-vous pour consulter votre dossier #{{case}}',
    email: 'E-mail',
    password: 'Mot de passe',
    signIn: 'Se connecter',
    signingIn: 'Connexion…',
    helperText:
      'Utilisez l’e-mail enregistré pour ce dossier et le mot de passe fourni par notre cabinet.',
    invalidLink: 'Lien du portail invalide',
    invalidCredentials: 'E-mail ou mot de passe incorrect',
    loginFailed: 'Échec de la connexion',
    welcome: 'Bienvenue',
  },
  de: {
    navAbout: 'Über uns',
    navContact: 'Kontakt',
    title: 'Kundenportal',
    subtitle: 'Melden Sie sich an, um Ihren Fall einzusehen',
    subtitleCase: 'Melden Sie sich an, um Ihren Fall einzusehen #{{case}}',
    email: 'E-Mail',
    password: 'Passwort',
    signIn: 'Anmelden',
    signingIn: 'Anmeldung…',
    helperText:
      'Verwenden Sie die für diesen Fall hinterlegte E-Mail-Adresse und das von unserem Büro bereitgestellte Passwort.',
    invalidLink: 'Ungültiger Portal-Link',
    invalidCredentials: 'Ungültige E-Mail oder Passwort',
    loginFailed: 'Anmeldung fehlgeschlagen',
    welcome: 'Willkommen',
  },
};

const STORAGE_KEY = 'portal_login_locale';

export function loadPortalLoginLocale(): PortalLoginLocale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in portalLoginMessages) return raw as PortalLoginLocale;
  } catch {
    // ignore
  }
  return 'en';
}

export function savePortalLoginLocale(locale: PortalLoginLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

export function isRtlLocale(locale: PortalLoginLocale): boolean {
  return locale === 'he';
}
