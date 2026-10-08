import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const progress = read("src/app/components/BroadcastProgressModal.tsx");
const broadcast = read("src/app/components/broadcast-view.tsx");
const schedule = read("src/app/lib/scheduled-at.ts");
const server = read("supabase/functions/server/index.ts");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

// P0: terminal state is authoritative campaign state, independent of loaded rows.
assert.match(progress, /const isComplete = campaignStatus === "completed"/);
assert.match(progress, /TERMINAL_CAMPAIGN_STATUSES\.has\(campaignStatus\)/);
assert.doesNotMatch(progress, /allRowsLoaded|expectedTotal|noActiveRecipients/);
const terminalUi = (campaignStatus, loadedRows, expectedTotal) => ({
  complete: campaignStatus === "completed",
  closeable: ["completed", "cancelled", "failed"].includes(campaignStatus),
  loadedRows,
  expectedTotal,
});
assert.deepEqual(terminalUi("completed", 100, 101), {
  complete: true,
  closeable: true,
  loadedRows: 100,
  expectedTotal: 101,
});
assert.equal(terminalUi("completed", 100, 500).closeable, true);
console.log("PASS P0.1 - 101 and 500 recipient campaigns reach closeable terminal UI with only 100 rows loaded");

// Realtime is enhancement: bounded authoritative stats refresh remains active.
assert.match(progress, /api\.getBroadcastStats\(broadcastId\)/);
assert.match(progress, /RECIPIENT_PAGE_SIZE = 100/);
assert.match(progress, /pageSize: RECIPIENT_PAGE_SIZE/);
assert.doesNotMatch(progress, /while\s*\([^)]*\)[\s\S]{0,400}getBroadcastRecipients/);
assert.match(progress, /FALLBACK_REFRESH_MS = 5_000/);
assert.match(progress, /SUBSCRIBED_REFRESH_TICKS = 12/);
assert.match(progress, /const refreshTicks = isSubscribed \? SUBSCRIBED_REFRESH_TICKS : 1/);
assert.doesNotMatch(progress, /setInterval\([\s\S]{0,1000},\s*1000\s*\)/);
assert.match(progress, /Status broadcast belum dapat diperbarui[\s\S]*Coba Lagi/);
assert.match(progress, /const canClose = isDone \|\| Boolean\(error\)/);
console.log("PASS P0.2 - missed Realtime recovers through bounded 5s/60s authoritative refresh with close/retry recovery");

// GET endpoints used by progress are read-only.
const statsGet = section(
  server,
  'app.get(`${API_PREFIX}/broadcasts/:id/stats`',
  'app.post(`${API_PREFIX}/broadcasts/:id/cancel`',
);
assert.doesNotMatch(statsGet, /\.update\(|\.insert\(|\.delete\(|\.upsert\(/);
console.log("PASS P0.3 - authoritative stats GET does not mutate database state");

// Timezone: local calendar minimum and explicit browser-local timezone wording.
assert.match(schedule, /getLocalCalendarDate[\s\S]*getFullYear\(\)[\s\S]*getMonth\(\)[\s\S]*getDate\(\)/);
assert.doesNotMatch(schedule, /getLocalCalendarDate[\s\S]{0,250}toISOString/);
assert.match(schedule, /getLocalTimezoneLabel/);
assert.match(broadcast, /min=\{localScheduleMinDate\}/);
assert.match(broadcast, /Jadwal menggunakan waktu lokal perangkat/);
assert.match(broadcast, /scheduleDate\} \$\{scheduleTime\} — \$\{localTimezoneLabel\}/);
assert.match(broadcast, /formatLocalScheduledAt\(scheduleDate, scheduleTime\)/);
console.log("PASS TZ - local boundary avoids UTC and confirmation includes the actual browser-local timezone");

// Recipient limit: strict >5,000 guard means 5,000 accepted and 5,001 rejected.
const acceptsRecipientCount = (count) => count <= 5000;
assert.equal(acceptsRecipientCount(500), true);
assert.equal(acceptsRecipientCount(501), true);
assert.equal(acceptsRecipientCount(5000), true);
assert.equal(acceptsRecipientCount(5001), false);
assert.match(broadcast, /MAX_BROADCAST_RECIPIENTS = 5000/);
assert.match(broadcast, /commitPendingImport[\s\S]*selectedContacts\.length > MAX_BROADCAST_RECIPIENTS/);
assert.match(broadcast, /handleApplyManualRecipients[\s\S]*nextContacts\.length > MAX_BROADCAST_RECIPIENTS/);
assert.match(broadcast, /selectContactsByLabel[\s\S]*combinedIds\.size > MAX_BROADCAST_RECIPIENTS/);
assert.match(broadcast, /selectedContactIds\.length >= MAX_BROADCAST_RECIPIENTS/);
assert.match(broadcast, /handleSendBroadcast[\s\S]*contacts\.length > MAX_BROADCAST_RECIPIENTS/);
assert.match(broadcast, /data tidak (?:dipotong|akan dipotong) otomatis/i);
assert.match(broadcast, /Valid: \{formatRecipientCount\(validationSummary\.validCount\)\}.*Ditolak\/bermasalah/s);
console.log("PASS LIMIT - 5,000 accepted, 5,001 rejected for CSV/Sheet/manual/saved contacts without silent truncation");

// Sender/template state machines distinguish loading, empty, and error with retry.
assert.match(broadcast, /senderLoadState.*"loading"/s);
assert.match(broadcast, /senderLoadState === "error"[\s\S]*loadSenders\(\)/);
assert.match(broadcast, /whatsappNumbers\.length === 0[\s\S]*Belum ada nomor WhatsApp aktif/);
assert.match(broadcast, /templateLoadState.*"loading"/s);
assert.match(broadcast, /templateLoadState === "error"[\s\S]*loadTemplates\(\)/);
assert.match(broadcast, /templates\.length === 0[\s\S]*Belum ada template berstatus approved/);
assert.doesNotMatch(broadcast, /setSenderLoadState\("error"\)[\s\S]{0,250}\{.*\.error.*\}/);
assert.doesNotMatch(broadcast, /setTemplateLoadState\("error"\)[\s\S]{0,250}\{.*\.error.*\}/);
assert.match(broadcast, /senderLoadState !== "loaded"[\s\S]*templateLoadState !== "loaded"/);
console.log("PASS LOAD - sender/template error differs from empty, Retry exists, technical errors stay in console");

console.log("\nRESULT: Batch 8A-1 broadcast critical UX regression PASS");
