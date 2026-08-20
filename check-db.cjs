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
  const supa = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, serviceKey || process.env.VITE_SUPABASE_ANON_KEY);
  
  console.log('Querying key_info for midtrans transactions...');
  const { data: txs, error: txErr } = await supa
    .from('key_info')
    .select('key, value')
    .like('key', 'midtrans_tx:%');
    
  if (txErr) {
    console.error('Error querying key_info:', txErr);
  } else {
    console.log('Midtrans Transactions:', JSON.stringify(txs, null, 2));
  }

  console.log('Querying billing_balance...');
  const { data: balances, error: balErr } = await supa
    .from('billing_balance')
    .select('*');

  if (balErr) {
    console.error('Error querying billing_balance:', balErr);
  } else {
    console.log('Billing Balances:', JSON.stringify(balances, null, 2));
  }
}

run();
