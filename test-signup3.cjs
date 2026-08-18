const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) {
    process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  }
});
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
supa.auth.signUp({
  email: 'test' + Date.now() + '@example.com',
  password: 'Password123!',
  options: {
    data: {
      full_name: 'test',
      org_name: 'test',
      username: 'test' + Date.now(),
      wa_number: '08123456789'
    }
  }
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(err => console.error(err));
