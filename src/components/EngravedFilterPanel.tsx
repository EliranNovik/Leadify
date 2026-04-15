/**
 * Recessed field look on the **input only** (no outer wrapper — avoids a grey “halo” ring).
 */
export const ENGRAVED_FILTER_CONTROL_CLASSES =
  'rounded-2xl !border-0 ' +
  'bg-base-100/90 dark:bg-base-100/35 ' +
  'shadow-[inset_0_4px_14px_rgba(0,0,0,0.10),inset_0_2px_4px_rgba(0,0,0,0.04)] ' +
  'dark:shadow-[inset_0_5px_18px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.05)] ' +
  'placeholder:text-base-content/45 ' +
  'focus:!border-0 focus:outline-none focus:ring-0 focus:ring-offset-0 ' +
  'focus-visible:ring-0 focus-visible:ring-offset-0 ' +
  'focus:shadow-[inset_0_5px_16px_rgba(0,0,0,0.12)] dark:focus:shadow-[inset_0_5px_20px_rgba(0,0,0,0.55)]';

/**
 * Primary action next to recessed fields — slightly raised.
 */
export const ENGRAVED_FILTER_PRIMARY_BUTTON_CLASSES =
  'shadow-[0_4px_14px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.25)] ' +
  'hover:shadow-[0_6px_18px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.25)] ' +
  'active:translate-y-px active:shadow-inner ' +
  'dark:shadow-[0_4px_18px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]';
