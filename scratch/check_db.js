import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envLocal = fs.readFileSync('.env.local', 'utf-8');
const supabaseUrl = envLocal.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim();
const supabaseKey = envLocal.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();

console.log("Supabase URL:", supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: numbers, error: nErr } = await supabase.from('wa_numbers').select('*');
  console.log("\n--- wa_numbers ---");
  console.log(numbers);
  if (nErr) console.error("Error wa_numbers:", nErr);

  const { data: latestMsg, error: mErr } = await supabase.from('wa_messages').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("\n--- Latest wa_messages ---");
  console.log(latestMsg);
  if (mErr) console.error("Error wa_messages:", mErr);

  const { data: latestActivities, error: aErr } = await supabase.from('app_activity').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("\n--- Latest app_activity ---");
  console.log(latestActivities);
  if (aErr) console.error("Error app_activity:", aErr);
}

check();
