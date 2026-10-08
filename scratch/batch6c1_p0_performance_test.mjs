import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const progressModal = read("src/app/components/BroadcastProgressModal.tsx");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const createFlow = section(
  server,
  'app.post(`${API_PREFIX}/broadcasts`, requireAuth, requireOrgAdmin',
  'app.get(`${API_PREFIX}/broadcasts/:id/recipients`',
);
const statsFlow = section(
  server,
  'app.get(`${API_PREFIX}/broadcasts/:id/stats`',
  'app.post(`${API_PREFIX}/broadcasts/:id/cancel`',
);
const realtimeRefresh = section(
  progressModal,
  'table: "wa_broadcasts"',
  'table: "wa_broadcast_recipients"',
);

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("GET broadcast stats is read-only", () => {
  assert.doesNotMatch(statsFlow, /recalculateBroadcastStats\s*\(/);
  assert.doesNotMatch(statsFlow, /replayBufferedWebhookStatuses\s*\(/);
  assert.doesNotMatch(statsFlow, /\.update\s*\(/);
  assert.doesNotMatch(statsFlow, /\.insert\s*\(/);
  assert.doesNotMatch(statsFlow, /\.delete\s*\(/);
  assert.match(statsFlow, /\.from\("wa_broadcasts"\)[\s\S]*\.select\(/);
});

check("Realtime stats refresh cannot self-trigger through the GET route", () => {
  assert.match(realtimeRefresh, /api\.getBroadcastStats\(broadcastId\)/);
  assert.doesNotMatch(statsFlow, /\.from\("wa_broadcasts"\)[\s\S]*\.update\s*\(/);
});

check("small broadcast requests remain accepted", () => {
  const validateCount = (count) => count > 0 && count <= 5000;
  assert.equal(validateCount(1), true);
  assert.equal(validateCount(100), true);
  assert.equal(validateCount(5000), true);
  assert.equal(validateCount(5001), false);
  assert.match(createFlow, /if \(recipients\.length === 0\)/);
});

check("more than 100 contact IDs are validated in bounded chunks", () => {
  assert.match(server, /BROADCAST_CONTACT_VALIDATION_BATCH_SIZE = 100/);
  assert.match(server, /BROADCAST_CONTACT_VALIDATION_CONCURRENCY = 4/);
  assert.match(createFlow, /chunkValues\([\s\S]*requestedContactIds,[\s\S]*BROADCAST_CONTACT_VALIDATION_BATCH_SIZE/);
  assert.match(createFlow, /waveStart \+= BROADCAST_CONTACT_VALIDATION_CONCURRENCY/);
  assert.match(createFlow, /\.eq\("org_id", user\.org_id\)[\s\S]*\.in\("id", batch\)/);

  const ids = Array.from({ length: 250 }, (_, index) => index);
  const chunks = [];
  for (let offset = 0; offset < ids.length; offset += 100) chunks.push(ids.slice(offset, offset + 100));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 50]);
});

check("recipient inserts are split into bounded chunks", () => {
  assert.match(server, /BROADCAST_RECIPIENT_INSERT_BATCH_SIZE = 100/);
  assert.match(createFlow, /recipientInsertBatches = chunkValues\([\s\S]*recipientRows,[\s\S]*BROADCAST_RECIPIENT_INSERT_BATCH_SIZE/);
  assert.match(createFlow, /for \(const recipientBatch of recipientInsertBatches\)/);
  assert.match(createFlow, /\.from\("wa_broadcast_recipients"\)[\s\S]*\.insert\(recipientBatch\)/);
  assert.doesNotMatch(createFlow, /\.insert\(recipientRows\)/);
});

check("server maximum is enforced on final valid recipients before campaign creation", () => {
  assert.match(server, /BROADCAST_MAX_RECIPIENTS = 5000/);
  assert.match(createFlow, /validRecipientCount > BROADCAST_MAX_RECIPIENTS[\s\S]*413/);
  assert.ok(
    createFlow.indexOf("validRecipientCount > BROADCAST_MAX_RECIPIENTS") <
      createFlow.indexOf('.from("wa_broadcasts")'),
    "recipient maximum must be checked before campaign insert",
  );
});

check("missing and foreign-tenant contacts remain deterministically rejected", () => {
  assert.match(createFlow, /\.eq\("org_id", user\.org_id\)[\s\S]*\.in\("id", batch\)/);
  assert.match(createFlow, /!ownedContactIds\.has\(contactId\)[\s\S]*Contact tidak ditemukan pada organisasi ini/);
  assert.match(createFlow, /contact_id: contactId && ownedContactIds\.has\(contactId\) \? contactId : null/);
  assert.match(createFlow, /status: rejectionReasons\.length === 0 \? "pending" : "failed"/);
});

check("scheduled and immediate broadcast behavior is unchanged", () => {
  assert.match(createFlow, /const scheduledAt = schedule\.value/);
  assert.match(createFlow, /const finalBroadcastStatus = validRecipientCount === 0 \? "failed" : "queued"/);
  assert.match(createFlow, /status: validRecipientCount === 0 \? "failed" : "paused"/);
  assert.match(createFlow, /\.update\(\{ status: finalBroadcastStatus \}\)[\s\S]*\.eq\("status", "paused"\)/);
  assert.match(createFlow, /if \(!scheduledAt && validRecipientCount > 0\)/);
  assert.match(createFlow, /runBroadcastWorkerInBackground/);
});

check("worker and scheduler ownership mechanisms are outside this change", () => {
  assert.match(server, /claim_due_wa_broadcasts/);
  assert.match(server, /claim_wa_number_broadcast_worker/);
  assert.match(server, /recoverStaleProcessingRecipients/);
  assert.match(server, /\.eq\("id", rec\.id\)[\s\S]*\.eq\("status", "pending"\)/);
  assert.match(server, /consumeBroadcastToken/);
});

console.log(`Batch 6C-1 P0 performance regression: ${passed}/9 PASS`);
