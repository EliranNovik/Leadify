/** Main content wrapper — left-align on md+ when case/notes rails would overlap a centered invoice. */
export function getPublicProformaMainLayoutClass(hasDesktopSidePanels: boolean): string {
  const base =
    'w-full pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] pt-[4.75rem] px-4';

  if (hasDesktopSidePanels) {
    return `${base} md:ml-4 md:mr-[min(22rem,36vw)] md:max-w-3xl md:pb-8 md:pt-8 md:px-6 lg:ml-8 lg:mr-[24rem] lg:max-w-4xl`;
  }

  return `${base} md:mx-auto md:max-w-4xl md:px-4 md:pb-8 md:pt-8 lg:px-6`;
}
