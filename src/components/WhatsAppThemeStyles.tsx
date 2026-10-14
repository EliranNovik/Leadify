import React from 'react';

import WHATSAPP_THEME_CSS from '../lib/whatsappThemeCss';

/**
 * The stylesheet behind the WhatsApp dark theme and its toggle. Render once inside each themed
 * surface. The CSS itself lives in lib/whatsappThemeCss so it can be unit-tested.
 */
const WhatsAppThemeStyles: React.FC = () => <style>{WHATSAPP_THEME_CSS}</style>;

export default WhatsAppThemeStyles;
