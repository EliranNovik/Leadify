export type PortalLoginLocale = 'en' | 'he' | 'fr' | 'de';

export const PORTAL_LOGIN_LOCALES: PortalLoginLocale[] = ['en', 'he', 'fr', 'de'];

export const PORTAL_LOGIN_LOCALE_LABELS: Record<PortalLoginLocale, string> = {
  en: 'English',
  he: 'עברית',
  fr: 'Français',
  de: 'Deutsch',
};

export type PortalLoginMessages = {
  clientPortal: string;
  signInSubtitle: string;
  signInSubtitleWithCase: string;
  email: string;
  password: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  signIn: string;
  signingIn: string;
  signInHint: string;
  invalidPortalLink: string;
  invalidCredentials: string;
  welcome: string;
  loginFailed: string;
  about: string;
  contact: string;
  signInNav: string;
  needHelp: string;
  contactUs: string;
  whatsapp: string;
  call: string;
  language: string;
  logoAlt: string;
  aboutTitle: string;
  aboutSubtitle: string;
  aboutIntro: string;
  aboutFeature1Title: string;
  aboutFeature1Body: string;
  aboutFeature2Title: string;
  aboutFeature2Body: string;
  aboutFeature3Title: string;
  aboutFeature3Body: string;
  aboutFeature4Title: string;
  aboutFeature4Body: string;
  aboutHelpPrefix: string;
  aboutHelpMiddle: string;
  aboutHelpSuffix: string;
  signInToPortal: string;
  followOurChannel: string;
  followChannel: string;
  youtubeChannel: string;
  heroTitle: string;
};

export const portalLoginMessages: Record<PortalLoginLocale, PortalLoginMessages> = {
  en: {
    clientPortal: 'Client Portal',
    signInSubtitle: 'Sign in to view your case',
    signInSubtitleWithCase: 'Sign in to view your case {{case}}',
    email: 'Email',
    password: 'Password',
    emailPlaceholder: 'you@example.com',
    passwordPlaceholder: 'Enter your password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signInHint:
      'Please sign in using the email address registered for this matter and the credentials issued by our office.',
    invalidPortalLink: 'Invalid portal link',
    invalidCredentials: 'Invalid email or password',
    welcome: 'Welcome, {{name}}',
    loginFailed: 'Login failed',
    about: 'About',
    contact: 'Contact',
    signInNav: 'Sign in',
    needHelp: 'Need help?',
    contactUs: 'Contact us',
    whatsapp: 'WhatsApp',
    call: 'Call',
    language: 'Language',
    logoAlt: 'Decker Pex & CO Law Offices',
    aboutTitle: 'About the Client Portal',
    aboutSubtitle: 'A secure place to follow your case with Decker Pex & Co Law Offices',
    aboutIntro:
      'The Client Portal gives you private online access to information about your case. It is available only to clients who have been invited by our office. Sign in with the email on file for your matter and the password we provided.',
    aboutFeature1Title: 'Your case at a glance',
    aboutFeature1Body:
      'See upcoming meetings, payments, and the latest stage of your matter in one dashboard.',
    aboutFeature2Title: 'Documents & progress',
    aboutFeature2Body:
      'Follow case stages, read updates from our team, and view documents shared with you.',
    aboutFeature3Title: 'Finance',
    aboutFeature3Body:
      'Review outstanding payments, pay online when available, and access invoices.',
    aboutFeature4Title: 'Contacts & meetings',
    aboutFeature4Body:
      'Keep contact details up to date, upload profile photos, and request meetings with our office.',
    aboutHelpPrefix: 'If you need help signing in or have questions about your case, use',
    aboutHelpMiddle: 'at the top of this page or',
    aboutHelpSuffix: 'at the bottom right.',
    signInToPortal: 'Sign in to your portal',
    followOurChannel: 'Follow our channel',
    followChannel: 'Subscribe on YouTube',
    youtubeChannel: 'YouTube channel',
    heroTitle: 'Welcome to your personal portal of Decker Pex & CO Law Office.',
  },
  he: {
    clientPortal: 'פורטל לקוחות',
    signInSubtitle: 'התחברו כדי לצפות בתיק שלכם',
    signInSubtitleWithCase: 'התחברו כדי לצפות בתיק {{case}}',
    email: 'דוא"ל',
    password: 'סיסמה',
    emailPlaceholder: 'you@example.com',
    passwordPlaceholder: 'הזינו את הסיסמה',
    signIn: 'התחברות',
    signingIn: 'מתחבר…',
    signInHint:
      'אנא התחברו באמצעות כתובת הדוא"ל הרשומה לתיק זה והפרטים שקיבלתם ממשרדנו.',
    invalidPortalLink: 'קישור פורטל לא תקין',
    invalidCredentials: 'דוא"ל או סיסמה שגויים',
    welcome: 'ברוכים הבאים, {{name}}',
    loginFailed: 'ההתחברות נכשלה',
    about: 'אודות',
    contact: 'יצירת קשר',
    signInNav: 'התחברות',
    needHelp: 'צריכים עזרה?',
    contactUs: 'צרו קשר',
    whatsapp: 'WhatsApp',
    call: 'התקשרו',
    language: 'שפה',
    logoAlt: 'Decker Pex & CO Law Offices',
    aboutTitle: 'אודות פורטל הלקוחות',
    aboutSubtitle: 'מקום מאובטח לעקוב אחר התיק שלכם עם Decker Pex & Co Law Offices',
    aboutIntro:
      'פורטל הלקוחות מעניק לכם גישה פרטית מקוונת למידע על התיק שלכם. הוא זמין רק ללקוחות שהוזמנו על ידי משרדנו. התחברו עם הדוא"ל הרשום בתיק ובסיסמה שקיבלתם.',
    aboutFeature1Title: 'התיק שלכם במבט אחד',
    aboutFeature1Body: 'צפו בפגישות קרובות, תשלומים ושלב העדכני של התיק בלוח בקרה אחד.',
    aboutFeature2Title: 'מסמכים והתקדמות',
    aboutFeature2Body: 'עקבו אחר שלבי התיק, קראו עדכונים מהצוות שלנו וצפו במסמכים ששותפו אתכם.',
    aboutFeature3Title: 'כספים',
    aboutFeature3Body: 'עיינו בתשלומים פתוחים, שלמו אונליין כשאפשר וגשו לחשבוניות.',
    aboutFeature4Title: 'אנשי קשר ופגישות',
    aboutFeature4Body: 'עדכנו פרטי קשר, העלו תמונות פרופיל ובקשו פגישות עם משרדנו.',
    aboutHelpPrefix: 'אם אתם זקוקים לעזרה בהתחברות או יש לכם שאלות לגבי התיק, השתמשו ב',
    aboutHelpMiddle: 'בחלק העליון של הדף או ב',
    aboutHelpSuffix: 'בפינה הימנית התחתונה.',
    signInToPortal: 'התחברות לפורטל',
    followOurChannel: 'עקבו אחר הערוץ שלנו',
    followChannel: 'הירשמו ב-YouTube',
    youtubeChannel: 'ערוץ YouTube',
    heroTitle: 'ברוכים הבאים לפורטל האישי שלכם של משרד עורכי הדין דקר פקס ושות׳.',
  },
  fr: {
    clientPortal: 'Portail client',
    signInSubtitle: 'Connectez-vous pour consulter votre dossier',
    signInSubtitleWithCase: 'Connectez-vous pour consulter votre dossier {{case}}',
    email: 'E-mail',
    password: 'Mot de passe',
    emailPlaceholder: 'vous@exemple.com',
    passwordPlaceholder: 'Saisissez votre mot de passe',
    signIn: 'Se connecter',
    signingIn: 'Connexion…',
    signInHint:
      'Veuillez vous connecter avec l’adresse e-mail enregistrée pour ce dossier et les identifiants transmis par notre cabinet.',
    invalidPortalLink: 'Lien du portail invalide',
    invalidCredentials: 'E-mail ou mot de passe incorrect',
    welcome: 'Bienvenue, {{name}}',
    loginFailed: 'Échec de la connexion',
    about: 'À propos',
    contact: 'Contact',
    signInNav: 'Connexion',
    needHelp: 'Besoin d’aide ?',
    contactUs: 'Contactez-nous',
    whatsapp: 'WhatsApp',
    call: 'Appeler',
    language: 'Langue',
    logoAlt: 'Decker Pex & CO Law Offices',
    aboutTitle: 'À propos du portail client',
    aboutSubtitle: 'Un espace sécurisé pour suivre votre dossier avec Decker Pex & Co Law Offices',
    aboutIntro:
      'Le portail client vous donne un accès en ligne privé aux informations concernant votre dossier. Il est réservé aux clients invités par notre cabinet. Connectez-vous avec l’e-mail enregistré pour votre dossier et le mot de passe que nous vous avons fourni.',
    aboutFeature1Title: 'Votre dossier en un coup d’œil',
    aboutFeature1Body:
      'Consultez les prochains rendez-vous, les paiements et la dernière étape de votre dossier sur un seul tableau de bord.',
    aboutFeature2Title: 'Documents et avancement',
    aboutFeature2Body:
      'Suivez les étapes du dossier, lisez les mises à jour de notre équipe et consultez les documents partagés avec vous.',
    aboutFeature3Title: 'Finances',
    aboutFeature3Body:
      'Consultez les paiements en attente, payez en ligne lorsque c’est possible et accédez aux factures.',
    aboutFeature4Title: 'Contacts et rendez-vous',
    aboutFeature4Body:
      'Mettez à jour vos coordonnées, téléchargez une photo de profil et demandez des rendez-vous avec notre cabinet.',
    aboutHelpPrefix:
      'Si vous avez besoin d’aide pour vous connecter ou des questions sur votre dossier, utilisez',
    aboutHelpMiddle: 'en haut de cette page ou',
    aboutHelpSuffix: 'en bas à droite.',
    signInToPortal: 'Se connecter au portail',
    followOurChannel: 'Suivez notre chaîne',
    followChannel: 'S’abonner sur YouTube',
    youtubeChannel: 'Chaîne YouTube',
    heroTitle:
      'Bienvenue sur votre portail personnel du cabinet d’avocats Decker Pex & Co.',
  },
  de: {
    clientPortal: 'Kundenportal',
    signInSubtitle: 'Melden Sie sich an, um Ihren Fall einzusehen',
    signInSubtitleWithCase: 'Melden Sie sich an, um Ihren Fall einzusehen {{case}}',
    email: 'E-Mail',
    password: 'Passwort',
    emailPlaceholder: 'ihre@email.de',
    passwordPlaceholder: 'Passwort eingeben',
    signIn: 'Anmelden',
    signingIn: 'Anmeldung…',
    signInHint:
      'Bitte melden Sie sich mit der für diesen Fall hinterlegten E-Mail-Adresse und den von unserem Büro übermittelten Zugangsdaten an.',
    invalidPortalLink: 'Ungültiger Portal-Link',
    invalidCredentials: 'E-Mail oder Passwort ungültig',
    welcome: 'Willkommen, {{name}}',
    loginFailed: 'Anmeldung fehlgeschlagen',
    about: 'Über uns',
    contact: 'Kontakt',
    signInNav: 'Anmelden',
    needHelp: 'Brauchen Sie Hilfe?',
    contactUs: 'Kontaktieren Sie uns',
    whatsapp: 'WhatsApp',
    call: 'Anrufen',
    language: 'Sprache',
    logoAlt: 'Decker Pex & CO Law Offices',
    aboutTitle: 'Über das Kundenportal',
    aboutSubtitle: 'Ein sicherer Ort, um Ihren Fall mit Decker Pex & Co Law Offices zu verfolgen',
    aboutIntro:
      'Das Kundenportal bietet Ihnen privaten Online-Zugang zu Informationen über Ihren Fall. Es steht nur Kunden zur Verfügung, die von unserem Büro eingeladen wurden. Melden Sie sich mit der hinterlegten E-Mail und dem von uns bereitgestellten Passwort an.',
    aboutFeature1Title: 'Ihr Fall auf einen Blick',
    aboutFeature1Body:
      'Sehen Sie anstehende Termine, Zahlungen und die aktuelle Phase Ihres Falls in einem Dashboard.',
    aboutFeature2Title: 'Dokumente und Fortschritt',
    aboutFeature2Body:
      'Verfolgen Sie Fallphasen, lesen Sie Updates unseres Teams und sehen Sie mit Ihnen geteilte Dokumente.',
    aboutFeature3Title: 'Finanzen',
    aboutFeature3Body:
      'Prüfen Sie offene Zahlungen, bezahlen Sie online, wenn möglich, und greifen Sie auf Rechnungen zu.',
    aboutFeature4Title: 'Kontakte und Termine',
    aboutFeature4Body:
      'Aktualisieren Sie Kontaktdaten, laden Sie Profilfotos hoch und fordern Sie Termine bei unserem Büro an.',
    aboutHelpPrefix:
      'Wenn Sie Hilfe bei der Anmeldung benötigen oder Fragen zu Ihrem Fall haben, nutzen Sie',
    aboutHelpMiddle: 'oben auf dieser Seite oder',
    aboutHelpSuffix: 'unten rechts.',
    signInToPortal: 'Zum Portal anmelden',
    followOurChannel: 'Folgen Sie unserem Kanal',
    followChannel: 'Auf YouTube abonnieren',
    youtubeChannel: 'YouTube-Kanal',
    heroTitle:
      'Willkommen in Ihrem persönlichen Portal der Kanzlei Decker Pex & Co.',
  },
};

export function isPortalLoginLocale(value: string): value is PortalLoginLocale {
  return PORTAL_LOGIN_LOCALES.includes(value as PortalLoginLocale);
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
