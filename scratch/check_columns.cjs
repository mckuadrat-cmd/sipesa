const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('.env.local', 'utf8');
const env = {};
envLocal.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  }
});

const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function run() {
  console.log('Querying wa_broadcasts...');
  const { data, error } = await supa
    .from('wa_broadcasts')
    .select('id, total_delivered, total_read')
    .limit(1);

  if (error) {
    console.error('Error querying columns:', error.message);
  } else {
    console.log('Columns total_delivered and total_read exist! Data:', data);
  }
}

run();
