import fs from 'fs';

const envPath = 'd:/Buildapps/sipesa/.env.local';
const envContent = fs.readFileSync(envPath, 'utf-8');

const env = {};
envContent.split(/\r?\n/).forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

async function run() {
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/wa_numbers`, { headers });
  const data = await res.json();
  console.log("WA_NUMBERS:", data.map(n => ({
    id: n.id,
    label: n.label,
    phone_e164: n.phone_e164,
    phone_number_id: n.phone_number_id,
    waba_id: n.waba_id,
    org_id: n.org_id,
    is_active: n.is_active
  })));
}

run();
