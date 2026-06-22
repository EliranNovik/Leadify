import React from 'react';
import type { PoaDocController } from '../PoaFormPrimitives';
import GermanCitizenshipPoaDoc from './GermanCitizenshipPoaDoc';
import StandardHebrewPoaDoc from './StandardHebrewPoaDoc';
import AustrianStandardPoaDoc from './AustrianStandardPoaDoc';
import AustrianMinorPoaDoc from './AustrianMinorPoaDoc';

export type PoaDocComponent = React.FC<{ ctrl: PoaDocController }>;

/** Map a poa_types.key to the React component that renders its document. */
export const POA_DOC_RENDERERS: Record<string, PoaDocComponent> = {
  german_citizenship: GermanCitizenshipPoaDoc,
  standard_hebrew: StandardHebrewPoaDoc,
  austrian_citizenship_standard: AustrianStandardPoaDoc,
  austrian_citizenship_minor: AustrianMinorPoaDoc,
};

export function getPoaDocRenderer(key: string | null | undefined): PoaDocComponent | null {
  if (!key) return null;
  return POA_DOC_RENDERERS[key] ?? null;
}
