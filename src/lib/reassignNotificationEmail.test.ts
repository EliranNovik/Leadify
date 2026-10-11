/**
 * The reassignment notification renderer, pinned against the four templates as they actually are.
 *
 * These bodies are copied verbatim out of `misc_emailtemplate`, inconsistencies and typos included,
 * because the whole point of the renderer is to cope with them without anyone editing the database.
 * If someone does tidy a template up, these fixtures are what should be updated first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultNotifyLanguage,
  employeeDisplayPhone,
  reassignNotificationSubject,
  renderReassignNotificationBody,
  type NotifyContact,
  type ReassignNotifyPeople,
} from './reassignNotificationEmail';

const TEMPLATE_199_EN_HANDLER = `Dear Client,

This is an automated notification to inform you that your case has been assigned to {case_handler_name}, your designated legal representative, who will be responsible for handling your case and providing updates.

For any questions or inquiries, please use the following contact details:

Legal Representative:
{case_handler_name}
{case_handler_phone}
{case_handler_email}
Contact Details & Digital Business Card: {business_card_link}

Department Manager:
{department_manager_name}
{department_manager_phone}
{department_manager_email}
Contact Details & Digital Business Card: {business_card_link}

Office General Contact:
[employee_id_181_name]
[employee_id_181_phone]
[employee_id_181_email]
Contact Details & Digital Business Card: {business_card_link}

Please do not reply to this automated message.

Best regards,
Decker, Pex & Levi Law Office`;

const TEMPLATE_197_EN_RETENTION = `Dear Client,

Please be informed that all updates regarding the status of your case will now be handled by [Full Name], your legal representative.

For any status inquiries, please contact your legal representative directly:

Legal Representative: [Full Name]
Contact Details & Digital Business Card: [Link]

Department Manager: [Full Name]
Contact Details & Digital Business Card: [Link]

Office General Contact: [Full Name]
Contact Details & Digital Business Card: [Link]

Please do not reply to this automated message.

Best regards,
Decker, Pex & Levi Law Office`;

const TEMPLATE_200_HE_HANDLER = `לקוח/ה יקר/ה,

זוהי הודעה אוטומטית לעדכנך כי התיק שלך הועבר לטיפולו/ה של {case_manger_name}, אשר מונה/תה לנציג/ה המשפטי/ת האחראי/ת על הטיפול בתיק ועל מתן עדכונים בנוגע להתקדמותו.

לכל שאלה או בירור, ניתן לפנות באמצעות פרטי הקשר הבאים:

נציג/ה משפטי/ת: {case_manger},
פרטי התקשרות וכרטיס ביקור דיגיטלי: [קישור]

מנהל/ת המחלקה: [שם מלא]
פרטי התקשרות וכרטיס ביקור דיגיטלי: [קישור]

איש/אשת קשר כללי/ת במשרד: [שם מלא]
פרטי התקשרות וכרטיס ביקור דיגיטלי: [קישור]

נא לא להשיב להודעה אוטומטית זו.

בברכה,
משרד עורכי דין דקר, פקס, לוי`;

const TEMPLATE_198_HE_RETENTION = `לקוח/ה יקר/ה,

נבקש לעדכנך כי מעתה כל העדכונים בנוגע לסטטוס התיק שלך יטופלו על ידי [שם מלא], הנציג/ה המשפטי/ת שלך.

לכל בירור בנוגע לסטטוס התיק, ניתן לפנות ישירות באמצעות פרטי הקשר הבאים:

נציג/ה משפטי/ת: [שם מלא]
פרטי התקשרות וכרטיס ביקור דיגיטלי: [קישור]

מנהל/ת המחלקה: [שם מלא]
פרטי התקשרות וכרטיס ביקור דיגיטלי: [קישור]

איש/אשת קשר כללי/ת במשרד: [שם מלא]
פרטי התקשרות וכרטיס ביקור דיגיטלי: [קישור]

נא לא להשיב להודעה אוטומטית זו.

בברכה,
משרד עורכי דין דקר, פקס, לוי`;

const ALL_TEMPLATES = [
  TEMPLATE_199_EN_HANDLER,
  TEMPLATE_197_EN_RETENTION,
  TEMPLATE_200_HE_HANDLER,
  TEMPLATE_198_HE_RETENTION,
];

const contact = (name: string, id: number): NotifyContact => ({
  name,
  phone: `050-000-${id}`,
  email: `${name.split(' ')[0].toLowerCase()}@example.com`,
  businessCardLink: `https://crm.example.com/business-card/${id}`,
});

const HANDLER = contact('Dana Levi', 42);
const MANAGER = contact('Shira Cohen', 61);
const OFFICE = contact('Anastasya Chemeris', 181);

const WITH_MANAGER: ReassignNotifyPeople = {
  representative: HANDLER,
  departmentManager: MANAGER,
  office: OFFICE,
};

const WITHOUT_MANAGER: ReassignNotifyPeople = { ...WITH_MANAGER, departmentManager: null };

/** Any `{token}` or `[token]` left behind means a placeholder went unrecognised. */
const leftoverPlaceholders = (body: string): string[] =>
  body.match(/\{[^}\n]{1,60}\}|\[[^\]\n]{1,60}\]/g) ?? [];

test('no template leaves an unresolved placeholder behind', () => {
  for (const template of ALL_TEMPLATES) {
    for (const people of [WITH_MANAGER, WITHOUT_MANAGER]) {
      const body = renderReassignNotificationBody(template, people);
      assert.deepEqual(leftoverPlaceholders(body), [], `leftovers in:\n${body}`);
    }
  }
});

test('template 199 fills each block with its own person', () => {
  const body = renderReassignNotificationBody(TEMPLATE_199_EN_HANDLER, WITH_MANAGER);

  assert.match(body, /assigned to Dana Levi, your designated legal representative/);
  assert.match(body, /Legal Representative:\nDana Levi\n050-000-42\ndana@example\.com\n/);
  assert.match(body, /Department Manager:\nShira Cohen\n050-000-61\nshira@example\.com\n/);
  assert.match(body, /Office General Contact:\nAnastasya Chemeris\n050-000-181\nanastasya@example\.com\n/);
});

test("199's single business-card placeholder resolves to three different links", () => {
  /*
   * The template reuses `{business_card_link}` in all three blocks, so the name cannot be what
   * decides whose link it is. Getting this wrong would send every client the same person's card.
   */
  const body = renderReassignNotificationBody(TEMPLATE_199_EN_HANDLER, WITH_MANAGER);
  const links = body.match(/https:\/\/crm\.example\.com\/business-card\/\d+/g) ?? [];
  assert.deepEqual(links, [
    'https://crm.example.com/business-card/42',
    'https://crm.example.com/business-card/61',
    'https://crm.example.com/business-card/181',
  ]);
});

test('template 197 maps its four identical [Full Name] slots to the right people', () => {
  // Two of the four are the representative: once in the opening sentence, once in their own block.
  const body = renderReassignNotificationBody(TEMPLATE_197_EN_RETENTION, WITH_MANAGER);

  assert.match(body, /handled by Dana Levi, your legal representative/);
  assert.match(body, /Legal Representative: Dana Levi/);
  assert.match(body, /Department Manager: Shira Cohen/);
  assert.match(body, /Office General Contact: Anastasya Chemeris/);

  const links = body.match(/https:\/\/crm\.example\.com\/business-card\/\d+/g) ?? [];
  assert.deepEqual(links, [
    'https://crm.example.com/business-card/42',
    'https://crm.example.com/business-card/61',
    'https://crm.example.com/business-card/181',
  ]);
});

test("template 200's misspelled placeholders still resolve", () => {
  // `{case_manger_name}` and `{case_manger}` are typos in the stored template, not in this test.
  const body = renderReassignNotificationBody(TEMPLATE_200_HE_HANDLER, WITH_MANAGER);

  assert.match(body, /הועבר לטיפולו\/ה של Dana Levi, אשר/);
  assert.match(body, /נציג\/ה משפטי\/ת: Dana Levi,/);
  assert.match(body, /מנהל\/ת המחלקה: Shira Cohen/);
  assert.match(body, /איש\/אשת קשר כללי\/ת במשרד: Anastasya Chemeris/);
});

test('the Hebrew opening sentence is not mistaken for a section heading', () => {
  /*
   * 198 and 200 both mention "הנציג/ה המשפטי/ת" mid-sentence before any block starts. Treating that
   * as the representative heading would shift every later block onto the wrong person.
   */
  const body = renderReassignNotificationBody(TEMPLATE_198_HE_RETENTION, WITH_MANAGER);

  assert.match(body, /יטופלו על ידי Dana Levi, הנציג\/ה המשפטי\/ת שלך/);
  assert.match(body, /מנהל\/ת המחלקה: Shira Cohen/);
  assert.match(body, /איש\/אשת קשר כללי\/ת במשרד: Anastasya Chemeris/);
});

test('a lead with no department manager loses the whole block, not just its values', () => {
  const body = renderReassignNotificationBody(TEMPLATE_199_EN_HANDLER, WITHOUT_MANAGER);

  assert.ok(!body.includes('Department Manager'), 'the heading should be gone too');
  assert.ok(!body.includes('Shira'), 'no manager detail should survive');
  // Exactly one blank line between the two remaining blocks: the dropped section took its own with it.
  assert.match(
    body,
    /Contact Details & Digital Business Card: https:\/\/crm\.example\.com\/business-card\/42\n\nOffice General Contact:/,
  );
  assert.ok(!/\n\n\n/.test(body), 'no blank-line gap should be left behind');
});

test('the retention templates also drop the manager block cleanly', () => {
  for (const template of [TEMPLATE_197_EN_RETENTION, TEMPLATE_198_HE_RETENTION]) {
    const body = renderReassignNotificationBody(template, WITHOUT_MANAGER);
    assert.ok(!body.includes('Department Manager'));
    assert.ok(!body.includes('מנהל/ת המחלקה'));
    assert.ok(!body.includes('Shira'));
    assert.ok(!/\n\n\n/.test(body));
  }
});

test('a contact line with nothing to show is dropped rather than left empty', () => {
  // Anastasya's email cannot be read from the database, so 199's bare email line has to disappear.
  const people: ReassignNotifyPeople = {
    ...WITH_MANAGER,
    office: { ...OFFICE, email: '' },
  };
  const body = renderReassignNotificationBody(TEMPLATE_199_EN_HANDLER, people);

  assert.match(body, /Office General Contact:\nAnastasya Chemeris\n050-000-181\nContact Details/);
  assert.ok(!/\n\n\n/.test(body), 'dropping the line should not leave a gap');
});

test('a labelled line whose only value is missing is dropped with its label', () => {
  const people: ReassignNotifyPeople = {
    ...WITH_MANAGER,
    representative: { ...HANDLER, businessCardLink: '' },
  };
  const body = renderReassignNotificationBody(TEMPLATE_197_EN_RETENTION, people);

  // "Contact Details & Digital Business Card:" with no link after it is noise, so the line goes.
  assert.match(body, /Legal Representative: Dana Levi\n\nDepartment Manager: Shira Cohen/);
});

test('text outside the contact blocks is passed through untouched', () => {
  const body = renderReassignNotificationBody(TEMPLATE_199_EN_HANDLER, WITH_MANAGER);
  assert.match(body, /^Dear Client,\n/);
  assert.match(body, /Please do not reply to this automated message\.\n\nBest regards,\nDecker, Pex & Levi Law Office$/);
});

test('the \\N import marker never reaches the client as a phone number', () => {
  /*
   * An old import wrote Postgres's COPY null marker into these columns as literal text, across 97
   * phone and 102 mobile values. Shira is the real case that exposed it: a perfectly good desk line
   * alongside `mobile = "\N"`.
   */
  assert.equal(employeeDisplayPhone({ phone: '0732379218', mobile: '\\N' }), '0732379218');
  assert.equal(employeeDisplayPhone({ phone: '\\N', mobile: '0586291922' }), '0586291922');
  assert.equal(employeeDisplayPhone({ phone: null, mobile: '0587228838' }), '0587228838');
});

test('the desk phone leads, because this number is being published to a client', () => {
  // The opposite of `getEmployeeCallPhone`, which prefers mobile for staff to dial.
  assert.equal(employeeDisplayPhone({ phone: '0732379218', mobile: '0586291922' }), '0732379218');
});

test('an employee with no usable number shows a dash', () => {
  for (const row of [
    { phone: '\\N', mobile: '\\N' },
    { phone: null, mobile: null },
    { phone: '', mobile: '   ' },
    { phone: undefined, mobile: '\\N' },
  ]) {
    assert.equal(employeeDisplayPhone(row), '-', JSON.stringify(row));
  }
  assert.equal(employeeDisplayPhone(null), '-');
  assert.equal(employeeDisplayPhone(undefined), '-');
});

test('the dashed phone line survives instead of being dropped', () => {
  /*
   * A dash and an empty string behave very differently here: empty would take the whole line with it,
   * leaving a block that reads as though the lawyer has no number at all rather than as though we do
   * not have one on file. 109 of 185 employees land in this case.
   */
  const body = renderReassignNotificationBody(TEMPLATE_199_EN_HANDLER, {
    ...WITH_MANAGER,
    departmentManager: { ...MANAGER, phone: employeeDisplayPhone({ phone: '\\N', mobile: '\\N' }) },
  });

  assert.match(body, /Department Manager:\nShira Cohen\n-\nshira@example\.com\n/);
  assert.ok(!body.includes('\\N'), 'no import marker should survive into the body');
});

test('the internal HE suffix never reaches the subject line', () => {
  assert.equal(reassignNotificationSubject('New case handler assigned'), 'New case handler assigned');
  assert.equal(reassignNotificationSubject('New case handler assigned HE'), 'New case handler assigned');
  assert.equal(reassignNotificationSubject('Retention Handler Assigned HE'), 'Retention Handler Assigned');
  assert.equal(reassignNotificationSubject(''), 'Case update');
});

test('the preselected language follows what most of the batch speaks', () => {
  const lead = (language: string | null) => ({
    id: `id-${language}`,
    leadType: 'new' as const,
    leadNumber: 'L1',
    name: 'Client',
    categoryId: '1',
    language,
  });

  assert.equal(defaultNotifyLanguage([lead('HE'), lead('HE'), lead('EN')]), 'he');
  assert.equal(defaultNotifyLanguage([lead('HE'), lead('EN')]), 'en', 'a tie should fall to English');
  assert.equal(defaultNotifyLanguage([lead('EN'), lead('RU')]), 'en');
  assert.equal(defaultNotifyLanguage([lead(null)]), 'en');
  assert.equal(defaultNotifyLanguage([]), 'en');
});
