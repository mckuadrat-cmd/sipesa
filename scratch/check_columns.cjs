const fs = require('fs');

const envLocal = fs.readFileSync('.env.local', 'utf8');
const env = {};
envLocal.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  }
});

async function main() {
  console.log('Fetching dev/webhook-debug...');
  const res = await fetch(`${env.VITE_API_BASE_URL}/dev/webhook-debug`);
  const json = await res.json();
  console.log('Broadcasts:', json.broadcasts);
  console.log('Recipients sample:', json.recipients?.slice(0, 5));
}

main().catch(console.error);
