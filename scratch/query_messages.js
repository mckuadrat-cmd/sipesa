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
  const res = await fetch(`${supabaseUrl}/rest/v1/wa_messages?limit=1`, { headers });
  const data = await res.json();
  console.log("COLUMNS IN WA_MESSAGES:", Object.keys(data[0] || {}));
  
  // Find messages with direction 'in' or different types
  const res2 = await fetch(`${supabaseUrl}/rest/v1/wa_messages?direction=eq.in&limit=5`, { headers });
  const inMessages = await res2.json();
  console.log("\nINCOMING MESSAGES:", inMessages.map(m => ({
    id: m.id,
    type: m.message_type,
    text_body: m.text_body,
    payload: m.payload
  })));

  // Find messages with type 'image'
  const res3 = await fetch(`${supabaseUrl}/rest/v1/wa_messages?message_type=eq.image&limit=5`, { headers });
  const imageMessages = await res3.json();
  console.log("\nIMAGE MESSAGES:", imageMessages.map(m => ({
    id: m.id,
    type: m.message_type,
    text_body: m.text_body,
    payload: m.payload
  })));
}

run();
