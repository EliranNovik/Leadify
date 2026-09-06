/**
 * Test the handler New / Re-assigned digest for employee id 75 only.
 *
 * Preview (no email):
 *   node scripts/test-handler-new-cases-digest-employee-75.js
 *
 * Send the real email to employee 75:
 *   node scripts/test-handler-new-cases-digest-employee-75.js --send
 *
 * Send that employee's digest to yourself:
 *   node scripts/test-handler-new-cases-digest-employee-75.js --send --send-to you@yourcompany.com
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { processHandlerNewCasesDigest } = require('../src/services/handlerNewCasesDigestService');

const EMPLOYEE_ID = 75;

function hasFlag(name) {
  return process.argv.includes(name);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

async function main() {
  const send = hasFlag('--send');
  const sendTo = readArg('--send-to');

  console.log(`[handler-digest-test] employeeId=${EMPLOYEE_ID} dryRun=${!send} sendTo=${sendTo || 'handler email'}`);

  const result = await processHandlerNewCasesDigest({
    employeeId: EMPLOYEE_ID,
    dryRun: !send,
    force: send,
    sendTo,
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.recipients?.length) {
    console.log(`[handler-digest-test] No New / Re-assigned cases for employee ${EMPLOYEE_ID}.`);
    return;
  }

  if (!send) {
    console.log('[handler-digest-test] Preview only. Re-run with --send to deliver the email.');
  }
}

main().catch((error) => {
  console.error('[handler-digest-test] Failed:', error.message || error);
  process.exit(1);
});
