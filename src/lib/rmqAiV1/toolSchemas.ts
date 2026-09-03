/** Lightweight schema checks — invalid tool JSON becomes tool_error, not model input. */

export function validateToolResult(name: string, result: string): { ok: true } | { ok: false; error: string } {
  if (!result || !String(result).trim()) {
    return { ok: false, error: `${name} returned an empty result` };
  }
  if (result.startsWith('Error executing') || result.startsWith('Invalid arguments')) {
    return { ok: false, error: result };
  }
  if (
    name === 'list_client_meetings' ||
    name === 'list_calendar_day' ||
    name === 'list_meetings' ||
    name === 'list_signed_contracts' ||
    name === 'list_paid_payments' ||
    name === 'list_missed_client_comms' ||
    name === 'list_expenses' ||
    name === 'list_employee_presence' ||
    name === 'web_search'
  ) {
    const looksJson = result.trim().startsWith('{') || result.trim().startsWith('[');
    if (looksJson) {
      try {
        JSON.parse(result);
      } catch {
        return { ok: false, error: `${name} returned malformed JSON` };
      }
    }
  }
  return { ok: true };
}

export function wrapInvalidToolResult(name: string, error: string): string {
  if (name === 'web_search') {
    return `Error executing web_search: ${error}. Say you could not verify the public fact. Do not invent sources.`;
  }
  return `Error executing ${name}: ${error}. Do not invent the missing CRM facts. Say you cannot verify them.`;
}
