// Read-only: is users.id the same value space as auth_id? Determines whether the
// "auth metadata" fallback in the WhatsApp pages can ever satisfy read_by -> users(id).
// Prints only shapes and counts, never identities.
require('dotenv').config({ path: 'backend/.env' });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

(async () => {
  const res = await fetch(`${url}/rest/v1/users?select=id,auth_id&limit=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await res.json();
  if (!Array.isArray(rows)) return console.error('users fetch failed:', rows);

  let idUuid = 0, idNumeric = 0, matches = 0, authNull = 0;
  for (const r of rows) {
    const id = String(r.id ?? '');
    if (UUID.test(id)) idUuid += 1;
    else if (/^\d+$/.test(id)) idNumeric += 1;
    if (r.auth_id == null) authNull += 1;
    else if (String(r.auth_id) === id) matches += 1;
  }
  console.log(`users rows sampled : ${rows.length}`);
  console.log(`id looks like uuid : ${idUuid}`);
  console.log(`id looks numeric   : ${idNumeric}`);
  console.log(`id === auth_id     : ${matches}`);
  console.log(`auth_id is null    : ${authNull}`);
})();
