const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Read env variables
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    const val = v.join('=').trim().replace(/^"|"$/g, '');
    process.env[k.trim()] = val;
  }
});

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Checking tables...");
  
  // Try querying a public endpoint or checking table metadata if possible
  const { data: users, error: userError } = await supabase.from('app_users').select('*').limit(1);
  if (userError) {
    console.error("app_users error:", userError.message);
  } else {
    console.log("app_users row keys:", users.length > 0 ? Object.keys(users[0]) : "No rows");
  }

  const { data: numbers, error: numberError } = await supabase.from('wa_numbers').select('*').limit(1);
  if (numberError) {
    console.error("wa_numbers error:", numberError.message);
  } else {
    console.log("wa_numbers row keys:", numbers.length > 0 ? Object.keys(numbers[0]) : "No rows");
  }
}

run();
