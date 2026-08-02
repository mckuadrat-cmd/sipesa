const fs = require('fs');
let VITE_SUPABASE_URL = '';
let VITE_SUPABASE_ANON_KEY = '';
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    const val = v.join('=').trim().replace(/^"|"$/g, '');
    if (k.trim() === 'VITE_SUPABASE_URL') VITE_SUPABASE_URL = val;
    if (k.trim() === 'VITE_SUPABASE_ANON_KEY') VITE_SUPABASE_ANON_KEY = val;
  }
});
async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);
  
  const { data, error } = await supa.from('app_activity').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('Recent Logs:', data);
}
run();
