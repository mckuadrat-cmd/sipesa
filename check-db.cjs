async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient('https://gwokwhznesggqoqrzaet.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2t3aHpuZXNnZ3FvcXJ6YWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTA4NTMsImV4cCI6MjA4NjU2Njg1M30.feNwS4Ut279I1-8pNMjbryzAdnjP7Z2MP5NMD2m6-jU');
  
  console.log('Testing key_info upsert...');
  const { data, error } = await supa.from('key_info').upsert({ key: 'test_key_123', value: { test: true } }, { onConflict: 'key' }).select('*');
  console.log('Upsert result:', data, 'Error:', error);
}

run();
