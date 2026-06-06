import fs from 'fs';
import path from 'path';

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
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };
  
  try {
    const resUsers = await fetch(`${supabaseUrl}/rest/v1/app_users?select=*`, { headers });
    const users = await resUsers.json();
    console.log("=== USERS ===");
    console.log(JSON.stringify(users, null, 2));

    const resOrgs = await fetch(`${supabaseUrl}/rest/v1/orgs?select=*`, { headers });
    const orgs = await resOrgs.json();
    console.log("=== ORGS ===");
    console.log(JSON.stringify(orgs, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
