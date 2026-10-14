/**
 * The dark theme for the WhatsApp surfaces, and the toggle's own styling.
 *
 * Rendered once per surface. Everything is scoped under `.wa-dark`, so a surface in light mode is
 * untouched and the rest of the app is never affected.
 *
 * How it works, and why
 * ---------------------
 * These screens were built with hardcoded light utilities — `bg-white`, `text-gray-500`,
 * `border-gray-200` and so on, over five hundred of them — and no `dark:` variants. Rewriting every
 * call site would be a vast diff across three files of 2.5k–8k lines, so instead the handful of
 * distinct utilities they actually use are remapped here. `.wa-dark .bg-white` outranks `.bg-white`
 * on specificity, so no `!important` is needed.
 *
 * DaisyUI components (buttons, inputs, modals, dropdowns) are not restyled here at all. The surface
 * root carries `data-theme`, which is DaisyUI's own per-element theming, so they re-theme themselves.
 *
 * Deliberately left alone: `text-white`, `bg-black/*` and `ring-black/5` are already correct on dark
 * — they sit on coloured buttons, modal backdrops and shadows, not on light surfaces.
 *
 * Kept in its own module, away from the component, so it can be asserted on in a unit test: the CSS
 * below is a template literal, and merely evaluating it is what proves it is still well-formed.
 *
 * NO BACKTICKS BELOW THIS LINE, not even inside a CSS comment — a backtick ends the literal, and the
 * result can still parse and build while throwing at runtime. Write class names unquoted.
 */
const WHATSAPP_THEME_CSS = `
.wa-dark {
  /* Matches the AI drawer's dark palette so the two feel like one product. */
  --wa-bg: #121316;
  --wa-bg-rail: #17181c;
  --wa-bg-raised: #1c1e22;
  --wa-bg-overlay: #26282e;
  --wa-bg-input: #2a2c32;
  --wa-border: #3a3d45;
  --wa-border-soft: #2a2c32;
  --wa-text: #f0f0f2;
  --wa-text-strong: #ffffff;
  --wa-text-mid: #c9ccd4;
  --wa-text-muted: #9a9da6;
  --wa-text-dim: #6f7279;

  /*
   * Bubbles follow WhatsApp's own dark palette rather than the AI drawer's indigo, because a chat
   * thread is the one place users compare against the real app.
   *
   * Read by whatsappOutgoingMessageStyle, which writes these as inline style values. Inline styles
   * outrank any stylesheet, so a variable is the only way to repaint them without editing every
   * bubble; in light mode the variable is simply undefined and the original colour applies.
   */
  --wa-bubble-out: #005c4b;
  --wa-bubble-out-text: #e9edef;
  --wa-bubble-out-link: #53bdeb;
  --wa-receipt-read: #53bdeb;
  --wa-receipt-sent: #8696a0;

  color-scheme: dark;
}

/* ---- Surfaces ---- */
.wa-dark .bg-white { background-color: var(--wa-bg-raised); }
.wa-dark .bg-gray-50 { background-color: var(--wa-bg-rail); }
.wa-dark .bg-gray-100 { background-color: var(--wa-bg); }
.wa-dark .bg-gray-200,
.wa-dark .bg-gray-300 { background-color: var(--wa-bg-overlay); }
.wa-dark .hover\\:bg-gray-50:hover,
.wa-dark .hover\\:bg-gray-100:hover { background-color: var(--wa-bg-overlay); }
.wa-dark .hover\\:bg-gray-200:hover,
.wa-dark .hover\\:bg-gray-300:hover,
.wa-dark .hover\\:bg-gray-400:hover { background-color: var(--wa-border); }
.wa-dark .bg-gray-100\\/80 { background-color: rgba(28, 30, 34, 0.8); }
.wa-dark .hover\\:bg-gray-300\\/70:hover { background-color: rgba(58, 61, 69, 0.7); }

/*
 * The frosted-glass chrome: chat header, composer field and popovers. Kept translucent so the
 * blur still reads as glass instead of turning into flat panels.
 */
.wa-dark .bg-white\\/95 { background-color: rgba(28, 30, 34, 0.95); }
.wa-dark .bg-white\\/90 { background-color: rgba(28, 30, 34, 0.9); }
.wa-dark .bg-white\\/85 { background-color: rgba(28, 30, 34, 0.85); }
.wa-dark .bg-white\\/80 { background-color: rgba(28, 30, 34, 0.8); }
.wa-dark .bg-white\\/75 { background-color: rgba(28, 30, 34, 0.75); }
.wa-dark .bg-white\\/70 { background-color: rgba(28, 30, 34, 0.7); }
.wa-dark .bg-white\\/55 { background-color: rgba(28, 30, 34, 0.62); }
.wa-dark .bg-white\\/50 { background-color: rgba(28, 30, 34, 0.58); }
.wa-dark .bg-white\\/45 { background-color: rgba(28, 30, 34, 0.55); }
.wa-dark .bg-white\\/40 { background-color: rgba(28, 30, 34, 0.5); }
.wa-dark .bg-white\\/35 { background-color: rgba(28, 30, 34, 0.45); }
.wa-dark .hover\\:bg-white\\/90:hover { background-color: rgba(38, 40, 46, 0.9); }
.wa-dark .hover\\:bg-white\\/50:hover { background-color: rgba(38, 40, 46, 0.6); }
.wa-dark .hover\\:bg-white\\/40:hover { background-color: rgba(38, 40, 46, 0.5); }
.wa-dark .hover\\:bg-white\\/35:hover { background-color: rgba(38, 40, 46, 0.45); }

/* ---- Text ---- */
.wa-dark .text-gray-900 { color: var(--wa-text-strong); }
.wa-dark .text-gray-800 { color: var(--wa-text); }
.wa-dark .text-gray-700,
.wa-dark .text-gray-600 { color: var(--wa-text-mid); }
.wa-dark .text-gray-500 { color: var(--wa-text-muted); }
.wa-dark .text-gray-400,
.wa-dark .text-gray-300 { color: var(--wa-text-dim); }
.wa-dark .hover\\:text-gray-700:hover { color: var(--wa-text); }
.wa-dark .placeholder-gray-500::placeholder,
.wa-dark .placeholder-gray-400::placeholder { color: var(--wa-text-dim); }

/* ---- Lines ---- */
.wa-dark .border-gray-100,
.wa-dark .border-gray-200,
.wa-dark .border-gray-300 { border-color: var(--wa-border); }
.wa-dark .border-gray-300\\/50 { border-color: rgba(58, 61, 69, 0.5); }
.wa-dark .border-white { border-color: var(--wa-border); }
.wa-dark .border-white\\/70 { border-color: rgba(58, 61, 69, 0.7); }
.wa-dark .border-white\\/40 { border-color: rgba(58, 61, 69, 0.45); }
.wa-dark .divide-gray-100 > :not([hidden]) ~ :not([hidden]) { border-color: var(--wa-border); }
.wa-dark .hover\\:ring-gray-200:hover { --tw-ring-color: var(--wa-border); }

/*
 * Incoming bubbles. Must stay below the .bg-white and .text-gray-900 rules above: it ties with
 * them on specificity, so source order is what makes it win.
 */
.wa-dark .wa-bubble-in { background-color: #202c33; color: #e9edef; }

/*
 * ---- Coloured tints ----
 *
 * The status pills (message window countdown, "Main" contact, PEX test mode) and the selected
 * conversation row are pale -50/-100 tints with dark text. Left as-is they would glare as
 * near-white blocks on a dark panel, so each becomes a translucent wash of the same hue with its
 * text lifted to a light shade. Translucent rather than solid so they tint whatever they sit on.
 *
 * The -600 accents are not touched: they are standalone icons on neutral surfaces, where they
 * stay legible either way.
 */
.wa-dark .bg-green-50 { background-color: rgba(16, 185, 129, 0.14); }
.wa-dark .bg-green-100 { background-color: rgba(16, 185, 129, 0.18); }
.wa-dark .bg-red-100 { background-color: rgba(239, 68, 68, 0.18); }
.wa-dark .bg-yellow-100 { background-color: rgba(245, 158, 11, 0.18); }
.wa-dark .bg-violet-100 { background-color: rgba(139, 92, 246, 0.2); }
.wa-dark .bg-blue-50 { background-color: rgba(59, 130, 246, 0.14); }
.wa-dark .bg-blue-100 { background-color: rgba(59, 130, 246, 0.18); }

.wa-dark .text-green-700,
.wa-dark .text-green-800,
.wa-dark .text-green-900 { color: #6ee7b7; }
.wa-dark .text-red-700 { color: #fca5a5; }
.wa-dark .text-yellow-700 { color: #fcd34d; }
.wa-dark .text-violet-800 { color: #c4b5fd; }
.wa-dark .text-blue-900 { color: #93c5fd; }

/*
 * ---- Timestamps and panel edges ----
 *
 * Both tie with the generic rules above on specificity, so they have to stay below them: source
 * order is what makes them win.
 */

/*
 * Timestamps go white. They share the grey utilities with the surrounding secondary text, which is
 * why they need their own hook rather than a lighter grey ramp; the opacity is dropped too, since
 * the bubble meta row is held at 70% for the light theme.
 */
.wa-dark .wa-timestamp { color: #ffffff; opacity: 1; }

/* An unread thread keeps its green, lifted to a shade that holds up on a dark row. */
.wa-dark .wa-timestamp-unread { color: #4ade80; opacity: 1; }

/*
 * No hairline between the rail, the contacts panel and the thread. On dark they are already three
 * distinct shades, so the border adds nothing and instead reads as an outline drawn round the panel.
 * Transparent rather than width zero, so nothing reflows between the two themes.
 */
.wa-dark .wa-panel-edge { border-color: transparent; }

/*
 * Same for the chat header and the composer bar. Their hairline exists to lift frosted glass off a
 * white thread; over a dark one the glass already separates itself by tone, and the border just
 * boxes them in. Their shadows stay, which is what keeps both reading as floating chrome.
 */
.wa-dark .wa-chrome-edge { border-color: transparent; }

/* ---- Theme switch: same control as the AI drawer's ai-theme-switch ---- */
.wa-theme-switch {
  position: relative;
  display: inline-flex;
  width: 3.5rem;
  height: 2rem;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  border: none;
  border-radius: 9999px;
  background: #e6e8ec;
  padding: 0.1875rem;
  box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.12);
  transition: background 0.25s ease, box-shadow 0.25s ease, transform 0.15s ease;
}
.wa-theme-switch:hover { transform: scale(1.04); }
.wa-theme-switch:active { transform: scale(0.98); }
.wa-dark .wa-theme-switch {
  background: #3a3d45;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.35);
}
.wa-theme-knob {
  display: flex;
  height: 1.625rem;
  width: 1.625rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
  transform: translateX(0);
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), background 0.25s ease, box-shadow 0.25s ease;
}
.wa-theme-knob.is-dark {
  background: #5c5f66;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transform: translateX(1.5rem);
}
.wa-theme-knob svg {
  height: 0.9rem;
  width: 0.9rem;
}

/* Thumb-sized on touch, matching the AI drawer's mobile sizing. */
@media (max-width: 768px) {
  .wa-theme-switch { width: 4.1rem; height: 2.4rem; }
  .wa-theme-knob { height: 1.95rem; width: 1.95rem; }
  .wa-theme-knob.is-dark { transform: translateX(1.7rem); }
  .wa-theme-knob svg { height: 1.1rem; width: 1.1rem; }
}
`;

export default WHATSAPP_THEME_CSS;
