import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const progress = read("src/app/components/BroadcastProgressModal.tsx");
const view = read("src/app/components/broadcast-view.tsx");
const api = read("src/app/lib/api.ts");
const server = read("supabase/functions/server/index.ts");
const migration = read("supabase/migrations/20261104120000_allow_approved_duplicate_broadcast_recipients.sql");

assert.match(server, /from\("wa_messages"\)[\s\S]{0,100}\.select\("id"\)/);
const mediaRoute = server.slice(server.indexOf('app.get(`${API_PREFIX}/media/:mediaId`'), server.indexOf("// GET all organization contacts"));
assert.doesNotMatch(mediaRoute, /from\("wa_messages"\)[\s\S]{0,100}access_token/);

assert.match(api, /slice\(0, requiredVariableCount\)/);
assert.match(server, /mode === "template"[\s\S]{0,100}templateRequirements\.bodyVariableCount/);

assert.match(view, /Kirim juga ke nomor duplikat/);
assert.match(view, /allowDuplicates: allowDuplicateRecipients/);
assert.match(server, /!allowDuplicateRecipients && phone && seenPhones\.has\(phone\)/);
assert.match(migration, /p_allow_duplicates boolean/);
assert.match(migration, /SET status = 'pending', error = NULL/);

assert.match(api, /deferStart: !payload\.scheduled/);
assert.match(progress, /status === "SUBSCRIBED"[\s\S]{0,150}requestStart\(\)/);
assert.match(progress, /realtimeQueueRef\.current\.push\(updated\)/);
assert.match(progress, /realtimeQueueRef\.current\.shift\(\)/);
assert.match(progress, /Menunggu/);
assert.match(progress, /Mengirim/);
assert.match(progress, /Terkirim/);
assert.match(progress, /Diterima/);
assert.match(progress, /Dibaca/);

assert.match(progress, /distanceFromBottom <= 120/);
assert.match(progress, /Memuat penerima berikutnya/);
assert.doesNotMatch(progress, /Muat 100 berikutnya/);
assert.match(progress, /Hentikan Broadcast/);
assert.match(progress, /Laporan sementara belum diperbarui/);
assert.doesNotMatch(progress, /Coba Lagi/);

console.log("Broadcast realtime repair regression: PASS");
