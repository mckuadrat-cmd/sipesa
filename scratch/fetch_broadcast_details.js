import fs from 'fs';

async function main() {
  const url = 'https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server/dev/broadcast-details';
  console.log('Fetching broadcast details from:', url);
  const res = await fetch(url);
  console.log('Response Status:', res.status);
  const data = await res.json();
  fs.writeFileSync('scratch/broadcast_details_debug.json', JSON.stringify(data, null, 2));
  console.log('Done!');
}

main().catch(console.error);
