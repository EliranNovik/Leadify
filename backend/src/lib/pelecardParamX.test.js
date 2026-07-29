const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PELECARD_PARAM_X_MAX,
  buildLeadContactParamX,
  parseLeadContactParamX,
  resolveLeadNumberForParamX,
  resolvePelecardParamX,
  isLegacyPaymentLink,
} = require('./pelecardParamX');

test('new lead uses leads.lead_number via client_id join', () => {
  assert.equal(
    resolveLeadNumberForParamX({
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      leads: { lead_number: '12345/2' },
      plan_contact_id: 10,
    }),
    '12345.2',
  );
  assert.equal(
    isLegacyPaymentLink({
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      leads: { lead_number: '12345/2' },
    }),
    false,
  );
});

test('new lead does not fall back to legacy_id', () => {
  assert.equal(
    resolveLeadNumberForParamX({
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      legacy_id: null,
      plan_contact_id: 10,
    }),
    null,
  );
});

test('legacy lead uses payment_links.legacy_id (leads_lead.id)', () => {
  assert.equal(
    resolveLeadNumberForParamX({
      legacy_id: 554433,
      is_legacy_payment_plan: true,
      client_id: null,
      plan_contact_id: 22,
    }),
    '554433',
  );
  assert.equal(
    buildLeadContactParamX({
      legacy_id: 554433,
      is_legacy_payment_plan: true,
      plan_contact_id: 22,
    }),
    '554433-22',
  );
});

test('legacy lead accepts legacy_ prefix on client_id', () => {
  assert.equal(
    resolveLeadNumberForParamX({
      client_id: 'legacy_99887',
      plan_contact_id: 3,
    }),
    '99887',
  );
});

test('builds ParamX from lead number and plan_contact_id', () => {
  assert.equal(
    buildLeadContactParamX({
      plan_contact_id: 678,
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      leads: { lead_number: '12345' },
    }),
    '12345-678',
  );
});

test('sanitizes sublead slash for ParamX', () => {
  assert.equal(
    buildLeadContactParamX({
      plan_contact_id: 99,
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      leads: { lead_number: '12345/2' },
    }),
    '12345.2-99',
  );
});

test('stays within Pelecard 19-char ParamX limit', () => {
  const value = buildLeadContactParamX({
    plan_contact_id: 123456789,
    client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    leads: { lead_number: '987654321012345' },
  });
  assert.ok(value);
  assert.ok(value.length <= PELECARD_PARAM_X_MAX);
  assert.match(value, /-123456789$/);
});

test('resolve prefers lead-contact over secure_token payment_ prefix', () => {
  const value = resolvePelecardParamX(
    {
      plan_contact_id: 42,
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      leads: { lead_number: '9001' },
      secure_token: 'payment_1760000000123_abcdef',
      pelecard_raw_response: { paramX: 'poldrandomcode' },
    },
    'payment_1760000000123_abcdef',
  );
  assert.equal(value, '9001-42');
});

test('parses lead-contact ParamX back', () => {
  assert.deepEqual(parseLeadContactParamX('12345.2-678'), {
    leadNumber: '12345.2',
    planContactId: 678,
  });
});

test('returns null when plan_contact_id is missing', () => {
  assert.equal(
    buildLeadContactParamX({
      payment_plan_id: 999,
      client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      leads: { lead_number: '12345' },
    }),
    null,
  );
});
