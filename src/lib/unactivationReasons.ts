/**
 * Mapping of unactivation reason IDs to their text labels
 * Used for legacy leads when unactivation_reason is not available
 */
export const UNACTIVATION_REASON_MAP: { [key: number]: string } = {
  1: 'test',
  2: 'spam',
  3: 'no intent',
  4: 'IrrelevantBackground',
  5: 'incorrect contact',
  6: 'no legal eligibility',
  7: 'no profitability',
  8: "can't be reached",
  9: 'double - same source',
  10: 'double -diff. source',
  11: 'non active category',
  12: 'expired',
};

/**
 * Get the unactivation reason text from reason_id
 * @param reasonId - The reason ID from the database
 * @returns The reason text or null if not found
 */
export const getUnactivationReasonFromId = (reasonId: number | null | undefined): string | null => {
  if (!reasonId) return null;
  return UNACTIVATION_REASON_MAP[reasonId] || null;
};

/**
 * Get all available unactivation reasons as an array of {id, name} objects
 */
export const getAllUnactivationReasons = (): Array<{ id: number; name: string }> => {
  return Object.entries(UNACTIVATION_REASON_MAP).map(([id, name]) => ({
    id: parseInt(id, 10),
    name,
  }));
};

