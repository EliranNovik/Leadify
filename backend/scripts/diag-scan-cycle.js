/* Temporary diagnostic: run one real Scan Center sync cycle and report queue state */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const smartScanInboxService = require('../src/services/smartScanInboxService');
const supabase = require('../src/config/supabase');

const ATTS = process.env.EMAIL_ATTACHMENTS_TABLE || 'email_attachments';

(async () => {
  const before = await supabase.from(ATTS).select('id', { count: 'exact', head: true });
  console.log('email_attachments before:', before.count);

  const result = await smartScanInboxService.listInbox({ sync: true });
  console.log('mailbox:', result.mailbox, 'synced:', result.synced, 'warning:', result.warning || 'none');
  console.log('items:', result.items.length);
  for (const item of result.items.slice(0, 12)) {
    console.log(`  ${item.createdAt} | ${item.id.slice(0, 40)} | ${item.status}/${item.classificationStatus} | ${item.originalFilename} | lead=${item.lead?.leadNumber || '-'}`);
  }

  const after = await supabase.from(ATTS).select('id, email_id, name, storage_path', { count: 'exact' });
  console.log('\nemail_attachments after:', after.count, after.error?.message || '');
  for (const row of after.data || []) {
    console.log(`  email=${row.email_id} ${row.name} stored=${Boolean(row.storage_path)}`);
  }

  const { data: docs } = await supabase
    .from('smart_scan_documents')
    .select('id, source_email_id, original_filename, status, classification_status, parent_id, created_at, error')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('\nlatest smart_scan_documents:');
  for (const d of docs || []) {
    console.log(`  ${d.created_at} | email=${d.source_email_id} | ${d.status}/${d.classification_status} | parent=${d.parent_id ? 'y' : 'n'} | ${d.original_filename} | err=${(d.error || '').slice(0, 60)}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('DIAG FAILED', e);
  process.exit(1);
});
