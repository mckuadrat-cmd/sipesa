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
  const supa = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, serviceKey);
  
  const { data: recs } = await supa.from('wa_broadcast_recipients').select('id, status, wa_message_id, provider_message_id').order('created_at', { ascending: false }).limit(5);
  console.log('Recipients:', recs);
  
  if (recs && recs.length > 0) {
    const ids = recs.map(r => r.wa_message_id).filter(Boolean);
    if (ids.length > 0) {
      const { data: msgs } = await supa.from('wa_messages').select('id, status, meta_message_id').in('id', ids);
      console.log('Messages:', msgs);
    } else {
      console.log('No wa_message_id found');
    }
  }
}

run();
