const fs = require('fs');
let serviceKey = '';
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    const val = v.join('=').trim().replace(/^"|"$/g, '');
    process.env[k.trim()] = val;
    if (k.trim() === 'SUPABASE_SERVICE_ROLE_KEY') serviceKey = val;
  }
});

async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(process.env.VITE_SUPABASE_URL, serviceKey);
  
  const { data: acts } = await supa.from('app_activity').select('*').order('created_at', { ascending: false }).limit(10);
  console.log('Recent Activity:');
  acts.forEach(a => console.log(a.type, a.message, a.meta));

  const { data: recs } = await supa.from('wa_broadcast_recipients').select('id, status, wa_message_id, provider_message_id, error').order('created_at', { ascending: false }).limit(5);
  console.log('\nRecipients:', recs);
  
}
run();
