const fs = require('fs');
let serviceKey = '';
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    const val = v.join('=').trim().replace(/^"|"$/g, '');
    process.env[k.trim()] = val;
  }
});
// using ANON KEY for now, I'll bypass RLS by calling the API!
