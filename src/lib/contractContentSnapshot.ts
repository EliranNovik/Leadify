import { supabase } from './supabase';

/**
 * Deep-clone a TipTap JSON doc so each contract instance owns its own body.
 * Admin templates must never be mutated by per-entity editors.
 */
export function cloneContractContent(content: unknown): unknown | null {
  if (content == null) return null;
  try {
    return JSON.parse(JSON.stringify(content));
  } catch {
    return content;
  }
}

/** Load template body and return an isolated snapshot for a new contract row. */
export async function fetchTemplateContentSnapshot(
  templateId: string,
): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('contract_templates')
    .select('content')
    .eq('id', templateId)
    .maybeSingle();

  if (error) throw error;
  return cloneContractContent(data?.content ?? null);
}

/**
 * True for employee / recruitment / firm contracts that must own their body
 * in `contracts.custom_content` (never write back to the admin template).
 */
export function isPerEntityDigitalContract(contract: {
  employee_id?: unknown;
  user_id?: unknown;
  external_firm_id?: unknown;
} | null | undefined): boolean {
  if (!contract) return false;
  return Boolean(contract.employee_id || contract.user_id || contract.external_firm_id);
}

/**
 * If a per-entity draft still has null custom_content (legacy live-link rows),
 * snapshot the template into custom_content once so future edits stay isolated.
 */
export async function ensurePerEntityContractContentSnapshot(params: {
  contract: any;
  templateContent: unknown;
}): Promise<any> {
  const { contract, templateContent } = params;
  if (!contract?.id || !isPerEntityDigitalContract(contract)) return contract;
  if (contract.custom_content) return contract;
  if (templateContent == null) return contract;

  const snapshot = cloneContractContent(templateContent);
  const { error } = await supabase
    .from('contracts')
    .update({ custom_content: snapshot })
    .eq('id', contract.id);

  if (error) {
    console.error('Failed to snapshot contract content from template:', error);
    return contract;
  }

  return { ...contract, custom_content: snapshot };
}
