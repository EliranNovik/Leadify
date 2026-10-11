/**
 * The notification a client receives when their case handler or retention handler changes.
 *
 * Four templates back this, one per role and language, and they were written at different times in
 * different styles: only 199 carries the full `{case_handler_*}` / `{department_manager_*}` set, 200
 * has two misspelled name placeholders and nothing else, and 197/198 predate the idea of putting
 * phone and email in the body at all. Rewriting them in the database was considered and declined, so
 * the renderer here meets them where they are.
 *
 * The trick that makes that tractable is reading the templates by *section* rather than by
 * placeholder name. All four share the same shape — an opening sentence, then a block each for the
 * legal representative, the department manager and the office's general contact — so a placeholder
 * that says only what kind of value it holds (`[Full Name]`, `[Link]`, and `{business_card_link}`,
 * which 199 reuses for three different people) can be resolved from the block it sits in. That also
 * gives us a clean way to drop the department manager block entirely, which matters because most
 * departments do not have one.
 */
import { supabase } from './supabase';
import { fetchLeadContacts } from './contactHelpers';
import { convertBodyToHtml } from './emailBodyHtml';
import { buildOutgoingHtmlWithSignature } from './emailSignature';
import { getMailboxStatus, sendEmailViaBackend } from './mailboxApi';

export type ReassignNotifyRole = 'handler' | 'retainer_handler';
export type ReassignNotifyLanguage = 'en' | 'he';

/**
 * Templates in `misc_emailtemplate`, by role and language.
 *
 * Hebrew case handler is 200 ("New case handler assigned HE"). Template 100 is unrelated — it holds
 * the Jerusalem parking directions.
 */
export const REASSIGN_NOTIFY_TEMPLATE_IDS: Record<
  ReassignNotifyRole,
  Record<ReassignNotifyLanguage, number>
> = {
  handler: { en: 199, he: 200 },
  retainer_handler: { en: 197, he: 198 },
};

/** Anastasya Chemeris, who appears in every one of these emails as the office's general contact. */
export const OFFICE_GENERAL_CONTACT_EMPLOYEE_ID = 181;

/**
 * Fallback for her office address, used only if the usual lookup comes back empty.
 *
 * Normally unnecessary: like every employee her email comes from `users.employee_id`, since
 * `tenants_employee` has no email column, and she does have a row there. Left blank deliberately —
 * the renderer drops a line whose placeholders all came out empty, so an address that cannot be
 * resolved costs the client one missing line rather than a wrong one.
 */
export const OFFICE_GENERAL_CONTACT_EMAIL = '';

/** One person as they appear in a contact block. Empty strings mean "no value", never "unknown". */
export type NotifyContact = {
  name: string;
  phone: string;
  email: string;
  businessCardLink: string;
};

export type ReassignNotifyPeople = {
  /** The newly assigned handler, who the opening sentence and first block are about. */
  representative: NotifyContact;
  /** Null when the lead's department has nobody flagged as its manager, which is the common case. */
  departmentManager: NotifyContact | null;
  office: NotifyContact;
};

type ContactSlot = keyof ReassignNotifyPeople;
type ContactField = keyof NotifyContact;

/**
 * The headings that open each contact block, in both languages.
 *
 * Matched only at the start of a line and only when followed by a colon. The Hebrew representative
 * heading would otherwise also match the opening sentence of 198 and 200, which mention
 * "הנציג/ה המשפטי/ת" mid-sentence.
 */
const SECTION_HEADINGS: { slot: ContactSlot; labels: string[] }[] = [
  { slot: 'representative', labels: ['Legal Representative', 'נציג/ה משפטי/ת'] },
  { slot: 'departmentManager', labels: ['Department Manager', 'מנהל/ת המחלקה'] },
  { slot: 'office', labels: ['Office General Contact', 'איש/אשת קשר כללי/ת במשרד'] },
];

/**
 * Placeholders that name their own person, and so mean the same thing wherever they appear.
 *
 * The `case_manger` spellings are template 200's typo, kept here rather than corrected in the
 * database. `retention_handler_*` and `retainer_handler_*` are both listed because the two names are
 * used interchangeably for that role across the codebase.
 */
const EXPLICIT_PLACEHOLDERS: { token: string; slot: ContactSlot; field: ContactField }[] = [
  { token: '{case_handler_name}', slot: 'representative', field: 'name' },
  { token: '{case_handler_phone}', slot: 'representative', field: 'phone' },
  { token: '{case_handler_email}', slot: 'representative', field: 'email' },
  { token: '{retention_handler_name}', slot: 'representative', field: 'name' },
  { token: '{retention_handler_phone}', slot: 'representative', field: 'phone' },
  { token: '{retention_handler_email}', slot: 'representative', field: 'email' },
  { token: '{retainer_handler_name}', slot: 'representative', field: 'name' },
  { token: '{retainer_handler_phone}', slot: 'representative', field: 'phone' },
  { token: '{retainer_handler_email}', slot: 'representative', field: 'email' },
  { token: '{case_manger_name}', slot: 'representative', field: 'name' },
  { token: '{case_manger_phone}', slot: 'representative', field: 'phone' },
  { token: '{case_manger_email}', slot: 'representative', field: 'email' },
  { token: '{case_manger}', slot: 'representative', field: 'name' },
  { token: '{department_manager_name}', slot: 'departmentManager', field: 'name' },
  { token: '{department_manager_phone}', slot: 'departmentManager', field: 'phone' },
  { token: '{department_manager_email}', slot: 'departmentManager', field: 'email' },
  { token: '[employee_id_181_name]', slot: 'office', field: 'name' },
  { token: '[employee_id_181_phone]', slot: 'office', field: 'phone' },
  { token: '[employee_id_181_email]', slot: 'office', field: 'email' },
];

/**
 * Placeholders that say only what kind of value they hold, leaving the section to decide whose.
 *
 * `{business_card_link}` belongs here even though it looks specific: 199 uses the one token for the
 * handler, the department manager and the office contact, so the name cannot be what resolves it.
 */
const GENERIC_PLACEHOLDERS: { token: string; field: ContactField }[] = [
  { token: '[Full Name]', field: 'name' },
  { token: '[שם מלא]', field: 'name' },
  { token: '{business_card_link}', field: 'businessCardLink' },
  { token: '[Link]', field: 'businessCardLink' },
  { token: '[קישור]', field: 'businessCardLink' },
];

/** The block a line opens, or null when the line is ordinary prose. */
function headingSlot(line: string): ContactSlot | null {
  const trimmed = line.trim().toLowerCase();
  for (const { slot, labels } of SECTION_HEADINGS) {
    if (labels.some((label) => trimmed.startsWith(`${label.toLowerCase()}:`))) return slot;
  }
  return null;
}

function contactValue(
  people: ReassignNotifyPeople,
  slot: ContactSlot,
  field: ContactField,
): string {
  const contact = people[slot];
  if (!contact) return '';
  return String(contact[field] || '').trim();
}

/**
 * Substitute one line's placeholders.
 *
 * Reports whether the line held any placeholder and whether any of them produced a value, which is
 * how the caller decides to drop lines like a bare `{department_manager_phone}` or a
 * "Contact Details:" label with nothing to put after it.
 */
function fillLine(
  line: string,
  slot: ContactSlot,
  people: ReassignNotifyPeople,
): { text: string; hadPlaceholder: boolean; filledAny: boolean } {
  let text = line;
  let hadPlaceholder = false;
  let filledAny = false;

  const apply = (token: string, value: string) => {
    if (!text.includes(token)) return;
    hadPlaceholder = true;
    if (value) filledAny = true;
    text = text.split(token).join(value);
  };

  for (const placeholder of EXPLICIT_PLACEHOLDERS) {
    apply(placeholder.token, contactValue(people, placeholder.slot, placeholder.field));
  }
  // Resolved against the block the line sits in rather than against their own name.
  for (const placeholder of GENERIC_PLACEHOLDERS) {
    apply(placeholder.token, contactValue(people, slot, placeholder.field));
  }

  return { text, hadPlaceholder, filledAny };
}

/**
 * Fill a template body for one lead.
 *
 * With no department manager the whole block goes, heading and trailing blank line included, so the
 * client reads straight from the legal representative to the office contact instead of meeting an
 * empty section.
 */
export function renderReassignNotificationBody(
  templateContent: string,
  people: ReassignNotifyPeople,
): string {
  const lines = String(templateContent || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const out: string[] = [];
  // Everything before the first heading is the opening sentence, which is about the new handler.
  let slot: ContactSlot = 'representative';
  let dropping = false;

  for (const line of lines) {
    const heading = headingSlot(line);
    if (heading) {
      slot = heading;
      dropping = heading === 'departmentManager' && !people.departmentManager;
    }
    // Runs to the next heading, which swallows the blank line that separated the blocks.
    if (dropping) continue;

    const filled = fillLine(line, slot, people);
    if (filled.hadPlaceholder && !filled.filledAny) continue;
    out.push(filled.text);
  }

  return out.join('\n');
}

/**
 * Subject line for the notification.
 *
 * Taken from the template's own name, minus the trailing " HE" the Hebrew rows carry so staff can
 * tell the pair apart in the template list. That suffix is an internal marker and has no business
 * arriving in a client's inbox.
 */
export function reassignNotificationSubject(templateName: string): string {
  return String(templateName || '').replace(/\s+HE$/i, '').trim() || 'Case update';
}

/** Public business-card page for an employee, which is what the templates link to. */
export function buildBusinessCardLink(employeeId: number): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/business-card/${employeeId}`;
}

/**
 * A stored value, or '' when what is stored only stands in for one.
 *
 * `\N` is Postgres's COPY marker for null, and an old import wrote it into these columns as literal
 * text: it sits in 97 `phone` and 102 `mobile` values. Untouched it reaches the client as "\N" where
 * their lawyer's number should be.
 */
function cleanField(value: unknown): string {
  const trimmed = String(value ?? '').trim();
  return trimmed === '\\N' ? '' : trimmed;
}

/** Printed when neither number survives cleaning, which is true of 109 of the 185 employee rows. */
const NO_PHONE_PLACEHOLDER = '-';

/**
 * The number to print for an employee: desk phone first, mobile second, a dash when neither is real.
 *
 * The dash earns its place. An empty value would make the renderer drop the line, and a contact block
 * that quietly loses its phone row reads as though the lawyer has no number rather than as though we
 * do not have it on file.
 *
 * Note this is the opposite preference to `getEmployeeCallPhone`, which puts mobile first because it
 * is choosing a number for staff to dial. This is choosing one to publish to a client, so the office
 * line leads.
 */
export function employeeDisplayPhone(
  row: { mobile?: unknown; phone?: unknown } | null | undefined,
): string {
  return cleanField(row?.phone) || cleanField(row?.mobile) || NO_PHONE_PLACEHOLDER;
}

type EmployeeRow = {
  id: number;
  display_name: string | null;
  official_name: string | null;
  phone: string | null;
  mobile: string | null;
};

/**
 * Contact details for a set of employees, in two queries rather than two per employee.
 *
 * Email lives on `users`, keyed by `employee_id`, because `tenants_employee` has no email column.
 */
async function fetchEmployeeContacts(
  employeeIds: number[],
): Promise<Map<number, NotifyContact>> {
  const ids = [...new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  const byId = new Map<number, NotifyContact>();
  if (ids.length === 0) return byId;

  const { data: rows, error } = await supabase
    .from('tenants_employee')
    .select('id, display_name, official_name, phone, mobile')
    .in('id', ids);
  if (error) throw error;

  const { data: userRows } = await supabase
    .from('users')
    .select('employee_id, email')
    .in('employee_id', ids);

  const emailByEmployee = new Map<number, string>();
  for (const row of userRows ?? []) {
    const employeeId = Number((row as { employee_id: unknown }).employee_id);
    const email = cleanField((row as { email: unknown }).email);
    // A few employees have more than one `users` row, so the first address found wins.
    if (Number.isFinite(employeeId) && email && !emailByEmployee.has(employeeId)) {
      emailByEmployee.set(employeeId, email);
    }
  }

  for (const row of (rows ?? []) as EmployeeRow[]) {
    const id = Number(row.id);
    byId.set(id, {
      // `official_name` is the formal version clients should see; the portal prefers it too.
      name: cleanField(row.official_name) || cleanField(row.display_name),
      phone: employeeDisplayPhone(row),
      // Left empty rather than dashed: the renderer drops the line, which beats printing "-" where
      // an address belongs.
      email: emailByEmployee.get(id) || '',
      businessCardLink: buildBusinessCardLink(id),
    });
  }

  return byId;
}

/**
 * The department manager for each of the given lead categories, by category id.
 *
 * Reproduces what the client portal does in SQL: the lead's category hangs off a main category, the
 * main category belongs to a department, and the department's manager is the employee in it flagged
 * `bonuses_role` 'dm'. Categories with no manager are simply absent from the map.
 *
 * Only two departments currently have such an employee, which covers 25 of the 143 categories; the
 * rest land in that absent case and get the department manager block dropped from their email.
 *
 * Activity is judged on `fired` rather than the portal's check for an active staff `users` row. The
 * two agree on today's data and this needs no second query, but it is a deliberate difference.
 */
export async function fetchDepartmentManagersByCategory(
  categoryIds: (string | number | null | undefined)[],
): Promise<Map<string, number>> {
  const keys = [
    ...new Set(
      categoryIds
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0),
    ),
  ];
  const byCategory = new Map<string, number>();
  if (keys.length === 0) return byCategory;

  const { data: categories } = await supabase
    .from('misc_category')
    .select('id, parent_id')
    .in('id', keys);
  if (!categories?.length) return byCategory;

  const parentIds = [
    ...new Set(
      categories
        .map((row) => String((row as { parent_id: unknown }).parent_id ?? '').trim())
        .filter(Boolean),
    ),
  ];
  if (parentIds.length === 0) return byCategory;

  const { data: mainCategories } = await supabase
    .from('misc_maincategory')
    .select('id, department_id')
    .in('id', parentIds);
  if (!mainCategories?.length) return byCategory;

  const departmentByParent = new Map<string, string>();
  for (const row of mainCategories) {
    const id = String((row as { id: unknown }).id ?? '').trim();
    const departmentId = String((row as { department_id: unknown }).department_id ?? '').trim();
    if (id && departmentId) departmentByParent.set(id, departmentId);
  }

  const departmentIds = [...new Set(departmentByParent.values())];
  if (departmentIds.length === 0) return byCategory;

  const { data: managers } = await supabase
    .from('tenants_employee')
    .select('id, department_id, bonuses_role, fired')
    .in('department_id', departmentIds)
    .order('id', { ascending: true });

  const managerByDepartment = new Map<string, number>();
  for (const row of managers ?? []) {
    const role = String((row as { bonuses_role: unknown }).bonuses_role ?? '')
      .trim()
      .toLowerCase();
    if (role !== 'dm' && role !== 'department manager') continue;
    if ((row as { fired: unknown }).fired === true) continue;
    const departmentId = String((row as { department_id: unknown }).department_id ?? '').trim();
    const employeeId = Number((row as { id: unknown }).id);
    // Lowest employee id wins, matching the portal's `ORDER BY te.id LIMIT 1`.
    if (departmentId && Number.isFinite(employeeId) && !managerByDepartment.has(departmentId)) {
      managerByDepartment.set(departmentId, employeeId);
    }
  }

  for (const row of categories) {
    const categoryId = String((row as { id: unknown }).id ?? '').trim();
    const parentId = String((row as { parent_id: unknown }).parent_id ?? '').trim();
    const departmentId = departmentByParent.get(parentId);
    const managerId = departmentId ? managerByDepartment.get(departmentId) : undefined;
    if (categoryId && managerId) byCategory.set(categoryId, managerId);
  }

  return byCategory;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(value: unknown): string {
  const trimmed = String(value ?? '').trim();
  return EMAIL_REGEX.test(trimmed) ? trimmed : '';
}

export type ReassignNotifyLead = {
  /** Report row id: a uuid for new leads, `legacy_<n>` for legacy ones. */
  id: string;
  leadType: 'new' | 'legacy';
  leadNumber: string;
  name: string;
  categoryId: string | number | null;
  /** The lead's own language, used to preselect English or Hebrew. */
  language?: string | null;
};

/** Strip the `legacy_` prefix the report puts on legacy row ids. */
export function rawLeadId(id: string): string {
  return String(id || '').replace(/^legacy_/i, '');
}

/**
 * The client address each lead's notification should go to.
 *
 * Prefers the lead's main contact, which is the address the rest of the CRM messages, and falls back
 * to the address denormalised onto the lead row. Leads that resolve to neither are returned absent so
 * the modal can show them as unsendable rather than failing the whole batch at send time.
 */
export async function fetchClientEmailsForLeads(
  leads: ReassignNotifyLead[],
): Promise<Map<string, string>> {
  const byLeadId = new Map<string, string>();
  if (leads.length === 0) return byLeadId;

  const newIds = leads.filter((lead) => lead.leadType === 'new').map((lead) => rawLeadId(lead.id));
  const legacyIds = leads
    .filter((lead) => lead.leadType === 'legacy')
    .map((lead) => Number(rawLeadId(lead.id)))
    .filter((id) => Number.isFinite(id));

  const leadRowEmail = new Map<string, string>();
  if (newIds.length > 0) {
    const { data } = await supabase.from('leads').select('id, email').in('id', newIds);
    for (const row of data ?? []) {
      leadRowEmail.set(String((row as { id: unknown }).id), validEmail((row as { email: unknown }).email));
    }
  }
  if (legacyIds.length > 0) {
    const { data } = await supabase.from('leads_lead').select('id, email').in('id', legacyIds);
    for (const row of data ?? []) {
      leadRowEmail.set(
        `legacy_${String((row as { id: unknown }).id)}`,
        validEmail((row as { email: unknown }).email),
      );
    }
  }

  const contactLists = await Promise.all(
    leads.map((lead) =>
      fetchLeadContacts(rawLeadId(lead.id), lead.leadType === 'legacy').catch(() => []),
    ),
  );

  leads.forEach((lead, index) => {
    const contacts = contactLists[index] ?? [];
    const main = contacts.find((contact) => contact.isMain && validEmail(contact.email));
    const any = contacts.find((contact) => validEmail(contact.email));
    const fromContact = validEmail(main?.email ?? any?.email);
    const key = lead.leadType === 'legacy' ? `legacy_${rawLeadId(lead.id)}` : rawLeadId(lead.id);
    const email = fromContact || leadRowEmail.get(key) || '';
    if (email) byLeadId.set(lead.id, email);
  });

  return byLeadId;
}

/** Map a lead's language name onto the two languages these templates exist in. */
export function defaultNotifyLanguage(leads: ReassignNotifyLead[]): ReassignNotifyLanguage {
  const hebrew = leads.filter((lead) => /^he|hebrew|עברית/i.test(String(lead.language ?? '').trim()));
  // Hebrew only when it is what most of the batch speaks; English is the safer default otherwise.
  return hebrew.length * 2 > leads.length ? 'he' : 'en';
}

export type ReassignNotifyTemplate = { id: number; name: string; content: string };

export async function fetchReassignNotifyTemplate(
  role: ReassignNotifyRole,
  language: ReassignNotifyLanguage,
): Promise<ReassignNotifyTemplate> {
  const templateId = REASSIGN_NOTIFY_TEMPLATE_IDS[role][language];
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('id, name, content')
    .eq('id', templateId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Email template ${templateId} was not found.`);
  }

  return {
    id: templateId,
    name: String((data as { name: unknown }).name ?? ''),
    content: String((data as { content: unknown }).content ?? ''),
  };
}

/**
 * Everything needed to render one lead's email, resolved once for the whole batch.
 *
 * The new handler and the office contact are the same on every email, so they are fetched once; only
 * the department manager varies, and then only by category.
 */
export async function buildReassignNotifyContext(params: {
  role: ReassignNotifyRole;
  language: ReassignNotifyLanguage;
  newEmployeeId: number;
  leads: ReassignNotifyLead[];
}): Promise<{
  template: ReassignNotifyTemplate;
  representative: NotifyContact;
  office: NotifyContact;
  departmentManagerByCategory: Map<string, NotifyContact>;
  clientEmailByLeadId: Map<string, string>;
}> {
  const [template, managerIdByCategory, clientEmailByLeadId] = await Promise.all([
    fetchReassignNotifyTemplate(params.role, params.language),
    fetchDepartmentManagersByCategory(params.leads.map((lead) => lead.categoryId)),
    fetchClientEmailsForLeads(params.leads),
  ]);

  const contacts = await fetchEmployeeContacts([
    params.newEmployeeId,
    OFFICE_GENERAL_CONTACT_EMPLOYEE_ID,
    ...managerIdByCategory.values(),
  ]);

  const blank: NotifyContact = { name: '', phone: '', email: '', businessCardLink: '' };
  const representative = contacts.get(params.newEmployeeId) ?? blank;
  const officeBase = contacts.get(OFFICE_GENERAL_CONTACT_EMPLOYEE_ID) ?? blank;
  const office: NotifyContact = {
    ...officeBase,
    // Her address is not in the database; see OFFICE_GENERAL_CONTACT_EMAIL.
    email: officeBase.email || OFFICE_GENERAL_CONTACT_EMAIL,
    businessCardLink: buildBusinessCardLink(OFFICE_GENERAL_CONTACT_EMPLOYEE_ID),
  };

  const departmentManagerByCategory = new Map<string, NotifyContact>();
  for (const [categoryId, managerId] of managerIdByCategory) {
    const contact = contacts.get(managerId);
    if (contact) departmentManagerByCategory.set(categoryId, contact);
  }

  return { template, representative, office, departmentManagerByCategory, clientEmailByLeadId };
}

export type ReassignNotifyPreviewRow = {
  /** Where this lead's email would go, or '' when no address could be found. */
  clientEmail: string;
  /** The manager whose block the email will carry, or '' when the block gets dropped. */
  departmentManagerName: string;
};

/**
 * What the confirmation modal shows for each lead before anything is sent.
 *
 * Resolving it up front is most of the reason the modal exists: a lead with no client address on
 * file, or one whose department has no manager, becomes visible here rather than turning into a
 * silent skip or a quietly missing section after the fact.
 */
export async function buildReassignNotifyPreview(
  leads: ReassignNotifyLead[],
): Promise<Map<string, ReassignNotifyPreviewRow>> {
  const rows = new Map<string, ReassignNotifyPreviewRow>();
  if (leads.length === 0) return rows;

  const [clientEmailByLeadId, managerIdByCategory] = await Promise.all([
    fetchClientEmailsForLeads(leads),
    fetchDepartmentManagersByCategory(leads.map((lead) => lead.categoryId)),
  ]);
  const contacts = await fetchEmployeeContacts([...managerIdByCategory.values()]);

  for (const lead of leads) {
    const managerId = managerIdByCategory.get(String(lead.categoryId ?? '').trim());
    rows.set(lead.id, {
      clientEmail: clientEmailByLeadId.get(lead.id) || '',
      departmentManagerName: (managerId && contacts.get(managerId)?.name) || '',
    });
  }

  return rows;
}

/** Raised before anything is sent when the signed-in user has no Outlook mailbox connected. */
export class MailboxNotConnectedError extends Error {
  constructor() {
    super('MAILBOX_NOT_CONNECTED');
    this.name = 'MailboxNotConnectedError';
  }
}

export type ReassignNotifyOutcome = {
  sent: string[];
  /** Leads deliberately not emailed, each with the reason to show the user. */
  skipped: { leadNumber: string; reason: string }[];
  failed: { leadNumber: string; message: string }[];
};

/**
 * Send one notification per lead, from the signed-in user's own Outlook mailbox.
 *
 * Sequential on purpose. These go out through Graph one message at a time, and a reassignment can
 * cover a long list; firing them all at once would risk throttling the mailbox and would make a
 * partial failure much harder to report. Each lead's outcome is collected rather than thrown so one
 * bad address cannot stop the rest of the batch.
 */
export async function sendReassignNotifications(params: {
  role: ReassignNotifyRole;
  language: ReassignNotifyLanguage;
  newEmployeeId: number;
  leads: ReassignNotifyLead[];
  onProgress?: (done: number, total: number) => void;
}): Promise<ReassignNotifyOutcome> {
  const outcome: ReassignNotifyOutcome = { sent: [], skipped: [], failed: [] };
  if (params.leads.length === 0) return outcome;

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.id) {
    throw new Error('You must be signed in to send emails.');
  }

  const mailbox = await getMailboxStatus(user.id);
  if (!mailbox?.connected) {
    throw new MailboxNotConnectedError();
  }

  const context = await buildReassignNotifyContext({
    role: params.role,
    language: params.language,
    newEmployeeId: params.newEmployeeId,
    leads: params.leads,
  });
  const subject = reassignNotificationSubject(context.template.name);

  let done = 0;
  for (const lead of params.leads) {
    try {
      const to = context.clientEmailByLeadId.get(lead.id);
      if (!to) {
        outcome.skipped.push({ leadNumber: lead.leadNumber, reason: 'No client email on file' });
        continue;
      }

      const categoryKey = String(lead.categoryId ?? '').trim();
      const body = renderReassignNotificationBody(context.template.content, {
        representative: context.representative,
        departmentManager: context.departmentManagerByCategory.get(categoryKey) ?? null,
        office: context.office,
      });

      // Direction is inferred from the text, so the Hebrew templates come out right-to-left.
      const { html, inlineAttachments } = await buildOutgoingHtmlWithSignature(
        convertBodyToHtml(body),
      );

      await sendEmailViaBackend({
        userId: user.id,
        subject,
        bodyHtml: html,
        bodyContentType: 'HTML',
        to: [to],
        attachments: inlineAttachments.length > 0 ? inlineAttachments : undefined,
        context: {
          clientId: lead.leadType === 'new' ? rawLeadId(lead.id) : null,
          legacyLeadId: lead.leadType === 'legacy' ? Number(rawLeadId(lead.id)) : null,
          leadType: lead.leadType,
          leadNumber: lead.leadNumber,
          contactEmail: to,
          contactName: lead.name,
        },
      });

      outcome.sent.push(lead.leadNumber);
    } catch (error: any) {
      outcome.failed.push({
        leadNumber: lead.leadNumber,
        message: String(error?.message || error || 'Send failed'),
      });
    } finally {
      done += 1;
      params.onProgress?.(done, params.leads.length);
    }
  }

  return outcome;
}
