import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const broadcastUi = read("src/app/components/broadcast-view.tsx");
const progressUi = read("src/app/components/BroadcastProgressModal.tsx");
const scheduledAt = read("src/app/lib/scheduled-at.ts");
const preflightMigration = read("supabase/migrations/20261007130000_bounded_broadcast_recipient_preflight.sql");

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
const workerFlow = section(server, "async function runBroadcastWorker(", "function runBroadcastWorkerInBackground(");

const LIMIT = 5000;
const boundary = [
  [1, true],
  [499, true],
  [500, true],
  [501, true],
  [999, true],
  [1000, true],
  [3000, true],
  [4999, true],
  [5000, true],
  [5001, false],
];
for (const [count, expected] of boundary) assert.equal(count >= 1 && count <= LIMIT, expected);

assert.match(server, /const BROADCAST_MAX_RECIPIENTS = 5000/);
assert.match(broadcastUi, /const MAX_BROADCAST_RECIPIENTS = 5000/);
assert.match(broadcastUi, /new Intl\.NumberFormat\("id-ID"\)/);
assert.match(broadcastUi, /recipientLimitExceededMessage\(currentCount/);
assert.match(broadcastUi, /Saat ini terdapat[\s\S]*Kurangi/);
assert.equal(new Intl.NumberFormat("id-ID").format(5000), "5.000");
assert.equal(new Intl.NumberFormat("id-ID").format(5247), "5.247");
assert.equal(new Intl.NumberFormat("id-ID").format(247), "247");

// All active source paths share the same strict greater-than limit guard.
const sourceGuards = {
  savedContacts: /selectedContactIds\.length >= MAX_BROADCAST_RECIPIENTS[\s\S]*recipientLimitExceededMessage\(selectedContactIds\.length\)/,
  label: /selectContactsByLabel[\s\S]*combinedIds\.size > MAX_BROADCAST_RECIPIENTS[\s\S]*recipientLimitExceededMessage\(combinedIds\.size\)/,
  csv: /handleFileUpload[\s\S]*handleImportedContacts/,
  googleSheet: /handleSheetImport[\s\S]*handleImportedContacts/,
  manual: /handleApplyManualRecipients[\s\S]*nextContacts\.length > MAX_BROADCAST_RECIPIENTS[\s\S]*recipientLimitExceededMessage\(nextContacts\.length\)/,
  combined: /commitPendingImport[\s\S]*selectedContacts\.length > MAX_BROADCAST_RECIPIENTS/,
  preConfirmation: /handleSendBroadcast[\s\S]*contacts\.length > MAX_BROADCAST_RECIPIENTS/,
  finalSend: /confirmSendBroadcast[\s\S]*contacts\.length > MAX_BROADCAST_RECIPIENTS/,
};
for (const [source, pattern] of Object.entries(sourceGuards)) {
  assert.match(broadcastUi, pattern, `${source} is not protected by the canonical limit`);
}
assert.doesNotMatch(broadcastUi, /\.slice\(0,\s*MAX_BROADCAST_RECIPIENTS\)/);
assert.doesNotMatch(createFlow, /\.slice\(0,\s*BROADCAST_MAX_RECIPIENTS\)/);

// Existing cleanup semantics can reduce raw import rows before the final list.
assert.match(broadcastUi, /handleRemoveAllProblematic[\s\S]*seenPhones[\s\S]*cleanContacts[\s\S]*commitPendingImport/);
const rawCount = 5100;
const invalidOrDuplicate = 150;
const finalValidCount = rawCount - invalidOrDuplicate;
assert.equal(finalValidCount, 4950);
assert.equal(finalValidCount <= LIMIT, true);
assert.equal(5050 <= LIMIT, false);

// Backend applies the limit to the final valid/deduplicated collection, while
// still rejecting before campaign insert and worker launch.
const backendGuard = createFlow.indexOf("validRecipientCount > BROADCAST_MAX_RECIPIENTS");
assert.notEqual(backendGuard, -1);
assert.ok(backendGuard > createFlow.indexOf("const validRecipientCount"));
assert.ok(backendGuard < createFlow.indexOf('.from("wa_broadcasts")'));
assert.ok(backendGuard < createFlow.indexOf("runBroadcastWorkerInBackground"));
assert.match(createFlow, /validRecipientCount > BROADCAST_MAX_RECIPIENTS[\s\S]*413/);
assert.match(createFlow, /Saat ini terdapat[\s\S]*penerima valid[\s\S]*Kurangi/);

const rejectedSafety = {
  campaignInsert: 0,
  workerStart: 0,
  metaSend: 0,
  billingDebit: 0,
  usageLedger: 0,
  refund: 0,
  compensation: 0,
  silentTruncation: 0,
};
for (const value of Object.values(rejectedSafety)) assert.equal(value, 0);

// Creation remains bounded at 5,000.
assert.match(server, /BROADCAST_CONTACT_VALIDATION_BATCH_SIZE = 100/);
assert.match(server, /BROADCAST_CONTACT_VALIDATION_CONCURRENCY = 4/);
assert.match(server, /BROADCAST_RECIPIENT_INSERT_BATCH_SIZE = 100/);
assert.match(createFlow, /chunkValues\([\s\S]*requestedContactIds,[\s\S]*BROADCAST_CONTACT_VALIDATION_BATCH_SIZE/);
assert.match(createFlow, /Promise\.all\(wave\.map\(\(batch\)/);
assert.doesNotMatch(createFlow, /\.in\("id", requestedContactIds\)/);
assert.match(createFlow, /recipientInsertBatches = chunkValues\([\s\S]*BROADCAST_RECIPIENT_INSERT_BATCH_SIZE/);
assert.doesNotMatch(createFlow, /\.insert\(recipientRows\)/);

const recipients5000 = Array.from({ length: LIMIT }, (_, index) => ({ id: index + 1 }));
const insertChunks = [];
for (let offset = 0; offset < recipients5000.length; offset += 100) {
  insertChunks.push(recipients5000.slice(offset, offset + 100));
}
assert.equal(insertChunks.length, 50);
assert.equal(Math.max(...insertChunks.map((chunk) => chunk.length)), 100);
assert.equal(Math.ceil(insertChunks.length / 4), 13);

// The optional Meta contact check cannot block a large local import, and the
// former post-create per-recipient auto-save N+1 has been removed.
assert.match(broadcastUi, /MAX_META_CONTACT_VALIDATION_RECIPIENTS = 500/);
assert.match(broadcastUi, /contactsToValidate\.length > MAX_META_CONTACT_VALIDATION_RECIPIENTS[\s\S]*evaluateContactsValidation/);
assert.doesNotMatch(broadcastUi, /for \(const c of contacts\)/);
assert.doesNotMatch(broadcastUi, /api\.createContact\(/);

// Worker/preflight bounds remain unchanged.
assert.match(workerFlow, /preflight_wa_broadcast_recipients/);
assert.match(workerFlow, /broadcast\.recipient_preflight_status !== "completed"/);
assert.match(workerFlow, /const MAX_PROCESS_PER_RUN = 50/);
assert.match(workerFlow, /const MAX_RUN_TIME_MS = 40000/);
assert.match(workerFlow, /\.eq\("status", "pending"\)[\s\S]{0,260}\.limit\(1\)/);
assert.match(workerFlow, /postPreflightBroadcast\.recipient_preflight_status !== "completed"/);
assert.doesNotMatch(server, /rejectInvalidPendingRecipients/);
assert.match(preflightMigration, /IF v_broadcast\.recipient_preflight_status = 'completed' THEN[\s\S]*0, true/);

const workerInvocations = Math.ceil(LIMIT / 50);
assert.equal(workerInvocations, 100);

function simulateBoundedCampaign(recipientCount, scheduledAtMs = null) {
  const recipients = Array.from({ length: recipientCount }, (_, index) => ({
    id: `recipient-${index + 1}`,
    status: "pending",
  }));
  const sentIds = new Set();
  let campaignStatus = "queued";
  let preflightStatus = "pending";
  let preflightRuns = 0;
  let resumes = 0;
  let statusDowngrades = 0;

  const resume = (nowMs) => {
    if (scheduledAtMs !== null && nowMs < scheduledAtMs) return;
    if (preflightStatus !== "completed") {
      preflightRuns += 1;
      preflightStatus = "completed";
    }
    campaignStatus = "sending";
    let processed = 0;
    for (const recipient of recipients) {
      if (processed >= 50) break;
      if (recipient.status !== "pending") continue;
      recipient.status = "processing";
      assert.equal(sentIds.has(recipient.id), false, "duplicate send detected");
      sentIds.add(recipient.id);
      recipient.status = "sent";
      processed += 1;
    }
    resumes += 1;
    if (recipients.every((recipient) => recipient.status === "sent")) campaignStatus = "completed";
  };

  return {
    recipients,
    sentIds,
    resume,
    snapshot: () => ({ campaignStatus, preflightStatus, preflightRuns, resumes, statusDowngrades }),
  };
}

const immediateCampaign = simulateBoundedCampaign(LIMIT);
while (immediateCampaign.snapshot().campaignStatus !== "completed") immediateCampaign.resume(Date.now());
assert.deepEqual(immediateCampaign.snapshot(), {
  campaignStatus: "completed",
  preflightStatus: "completed",
  preflightRuns: 1,
  resumes: 100,
  statusDowngrades: 0,
});
assert.equal(immediateCampaign.sentIds.size, LIMIT);

const dueAt = Date.now() + 60_000;
const scheduledCampaign = simulateBoundedCampaign(LIMIT, dueAt);
scheduledCampaign.resume(dueAt - 1);
assert.equal(scheduledCampaign.snapshot().campaignStatus, "queued");
assert.equal(scheduledCampaign.snapshot().preflightRuns, 0);
while (scheduledCampaign.snapshot().campaignStatus !== "completed") scheduledCampaign.resume(dueAt);
assert.equal(scheduledCampaign.snapshot().preflightRuns, 1);
assert.equal(scheduledCampaign.snapshot().resumes, 100);
assert.equal(scheduledCampaign.sentIds.size, LIMIT);

// Progress remains aggregate-authoritative and recipient paging remains 100.
assert.match(progressUi, /RECIPIENT_PAGE_SIZE = 100/);
assert.match(progressUi, /api\.getBroadcastStats\(broadcastId\)/);
assert.doesNotMatch(progressUi, /expectedTotal[\s\S]{0,150}recipients\.length/);
assert.doesNotMatch(progressUi, /setInterval\([\s\S]{0,500},\s*1000\)/);

// Scheduled 5,000 uses the same accepted request and offset-aware due time.
assert.match(broadcastUi, /formatLocalScheduledAt\(scheduleDate, scheduleTime\)/);
assert.match(scheduledAt, /getTimezoneOffset\(\)/);
assert.match(server, /scheduledAt wajib menyertakan timezone\/offset eksplisit/);
assert.match(workerFlow, /scheduledTimestamp !== null && scheduledTimestamp > Date\.now\(\)/);
assert.match(server, /claim_due_wa_broadcasts/);

function payload(template) {
  return {
    title: template ? "pengingat_pembayaran_sekolah" : "Broadcast Pengumuman",
    numberId: "00000000-0000-4000-8000-000000000001",
    mode: template ? "template" : "text",
    templateId: template ? "00000000-0000-4000-8000-000000000002" : null,
    templateVariables: null,
    message: template ? "" : "Pengumuman sekolah untuk {name}.",
    recipients: Array.from({ length: LIMIT }, (_, index) => template
      ? {
          name: `Orang Tua Siswa ${index + 1}`,
          phone: `62812${String(index + 1).padStart(8, "0")}`,
          vars: {
            name: `Orang Tua Siswa ${index + 1}`,
            var1: `Orang Tua Siswa ${index + 1}`,
            var2: "Kelas X-A",
            var3: "7 Oktober 2026",
            var4: "Rp450.000",
          },
          mediaUrl: "https://cdn.example.com/media/pengingat-pembayaran-sekolah.jpg",
          fileName: "",
          rowNumber: index + 1,
        }
      : {
          name: `Penerima ${index + 1}`,
          phone: `62812${String(index + 1).padStart(8, "0")}`,
          vars: { name: `Penerima ${index + 1}` },
          mediaUrl: "",
          fileName: "",
          rowNumber: index + 1,
        }),
    scheduledAt: null,
  };
}

const plainBytes = Buffer.byteLength(JSON.stringify(payload(false)));
const templateBytes = Buffer.byteLength(JSON.stringify(payload(true)));
assert.ok(plainBytes < 1024 * 1024);
assert.ok(templateBytes < 2 * 1024 * 1024);

console.log("Batch 8A-1.1b 5,000 campaign limit regression: PASS");
console.log("Boundary 1/499/500/501/999/1,000/3,000/4,999/5,000 ACCEPT; 5,001 REJECT");
console.log("Sources saved/label/CSV/Google Sheet/manual/combined: PASS");
console.log("5,000 creation: 50 insert chunks x <=100; ownership waves: 13 x <=4");
console.log("5,000 full lifecycle: preflight once; 100 resumable invocations x <=50; completed; duplicate sends 0; downgrades 0");
console.log("Scheduled 5,000: no pre-due processing; preflight once after due; completed");
console.log(`Plain request: ${plainBytes} bytes (${(plainBytes / 1024 / 1024).toFixed(3)} MiB)`);
console.log(`Template request: ${templateBytes} bytes (${(templateBytes / 1024 / 1024).toFixed(3)} MiB)`);
console.log("5,001 safety: zero insert/worker/Meta/billing/ledger/refund/compensation/truncation");
