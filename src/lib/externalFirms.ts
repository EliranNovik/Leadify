import { supabase } from './supabase';

export type ExternalFirmRow = {
  id: string;
  name: string;
};

/** Shortest name worth creating a firm for; one character is almost always a slip. */
const MIN_FIRM_NAME_LENGTH = 2;

/** `ilike` treats these as wildcards, so a name containing one has to be escaped to match literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Find a firm by name, or create it.
 *
 * These are the rows the External Firms page lists, so a firm added here from an expense drawer
 * shows up there as an ordinary firm; `name` is the only column the table requires, and the type,
 * VAT number and contacts get filled in on that page afterwards.
 *
 * An existing firm is returned rather than a second row created, because the name is the only thing
 * being matched on and two firms sharing one are indistinguishable everywhere they are displayed.
 * The check is case-insensitive and ignores surrounding spaces, which is how someone retyping a
 * firm they could not find in the picker would differ from the stored name.
 */
export async function createExternalFirm(
  rawName: string,
): Promise<{ firm: ExternalFirmRow; alreadyExisted: boolean }> {
  const name = rawName.trim();
  if (name.length < MIN_FIRM_NAME_LENGTH) {
    throw new Error('Enter at least 2 characters for the firm name');
  }

  const { data: existing, error: lookupError } = await supabase
    .from('firms')
    .select('id, name')
    .ilike('name', escapeLikePattern(name))
    .limit(1);
  if (lookupError) throw lookupError;

  const match = existing?.[0];
  if (match) {
    return {
      firm: { id: String(match.id), name: String(match.name || name) },
      alreadyExisted: true,
    };
  }

  const { data, error } = await supabase
    .from('firms')
    .insert({ name })
    .select('id, name')
    .single();
  if (error) throw error;

  return {
    firm: { id: String(data.id), name: String(data.name || name) },
    alreadyExisted: false,
  };
}
