import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gwokwhznesggqoqrzaet.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2t3aHpuZXNnZ3FvcXJ6YWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTA4NTMsImV4cCI6MjA4NjU2Njg1M30.feNwS4Ut279I1-8pNMjbryzAdnjP7Z2MP5NMD2m6-jU';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Querying latest broadcasts...');
  const { data: broadcasts, error: bErr } = await supabase
    .from('wa_broadcasts')
    .select('id, title, status, total_recipients, total_sent, total_failed, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (bErr) {
    console.error('Error fetching broadcasts:', bErr);
    return;
  }

  for (const b of broadcasts) {
    console.log(`\nBroadcast: ${b.title} (ID: ${b.id})`);
    console.log(`  Status: ${b.status}`);
    console.log(`  Total Recipients: ${b.total_recipients}, Sent: ${b.total_sent}, Failed: ${b.total_failed}`);
    console.log(`  Created At: ${b.created_at}`);

    // Query recipient status counts
    const { data: recipients, error: rErr } = await supabase
      .from('wa_broadcast_recipients')
      .select('status')
      .eq('broadcast_id', b.id);

    if (rErr) {
      console.error(`  Error fetching recipients:`, rErr);
      continue;
    }

    const counts = {};
    recipients.forEach(r => {
      counts[r.status] = (counts[r.status] || 0) + 1;
    });
    console.log(`  Recipients status breakdown:`, counts);
  }
}

main().catch(console.error);
