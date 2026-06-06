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
  
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
    const schema = await res.json();
    console.log("Error schema response:", schema);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
