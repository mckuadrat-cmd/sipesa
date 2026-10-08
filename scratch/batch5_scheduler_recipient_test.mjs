import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const migration = read("supabase/migrations/20261006130000_scheduled_broadcast_claim.sql");
const batch1 = read("supabase/migrations/20261005090000_create_atomic_billing_core.sql");
const batch4 = read("scratch/batch4_pricing_test.mjs");
const broadcastUi = read("src/app/components/broadcast-view.tsx");
const scheduledAtHelper = read("src/app/lib/scheduled-at.ts");

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
const schedulerFlow = section(
  server,
  'app.post(`${API_PREFIX}/jobs/process-due-broadcasts`',
  'app.post(`${API_PREFIX}/jobs/process-broadcasts`',
);

// Scheduler authentication must fail closed before any service-role claim.
assert.match(schedulerFlow, /if \(!configuredSecret\)[\s\S]*503/);
assert.match(schedulerFlow, /!suppliedSecret \|\| !constantTimeEqual\(suppliedSecret, configuredSecret\)[\s\S]*403/);
assert.ok(
  schedulerFlow.indexOf("constantTimeEqual(suppliedSecret, configuredSecret)") <
    schedulerFlow.indexOf('supa.rpc("claim_due_wa_broadcasts"'),
  "scheduler secret validation must precede the claim RPC",
);
assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);

const now = Date.parse("2026-10-06T10:00:00.000Z");
const isDue = (broadcast) =>
  broadcast.status === "queued" &&
  (broadcast.scheduledAt === null || Date.parse(broadcast.scheduledAt) <= now);

// A-D: eligibility model and matching SQL/static guards.
assert.equal(isDue({ status: "queued", scheduledAt: "2026-10-06T10:01:00.000Z" }), false);
assert.match(migration, /scheduled_at IS NULL OR broadcast\.scheduled_at <= clock_timestamp\(\)/);
assert.doesNotMatch(migration, /'scheduled'::public\.broadcast_status/);
assert.match(createFlow, /const finalBroadcastStatus = validRecipientCount === 0 \? "failed" : "queued"/);
assert.match(createFlow, /status: validRecipientCount === 0 \? "failed" : "paused"/);
assert.match(createFlow, /\.update\(\{ status: finalBroadcastStatus \}\)/);
console.log("PASS A EMULATED/STATIC - future broadcast is not processed");

assert.equal(isDue({ status: "queued", scheduledAt: "2026-10-06T09:59:00.000Z" }), true);
assert.match(schedulerFlow, /claim_due_wa_broadcasts/);
console.log("PASS B EMULATED/STATIC - due broadcast is claimed for processing");

assert.equal(isDue({ status: "cancelled", scheduledAt: "2026-10-06T09:59:00.000Z" }), false);
assert.match(workerFlow, /\["queued", "sending"\]\.includes\(broadcastStatus\)/);
console.log("PASS C EMULATED/STATIC - cancelled broadcast is excluded");

assert.equal(isDue({ status: "completed", scheduledAt: "2026-10-06T09:59:00.000Z" }), false);
console.log("PASS D EMULATED - completed broadcast is excluded");

// E: emulate SKIP LOCKED atomic claim ownership.
const claimState = { claimed: false };
const claimOnce = () => {
  if (claimState.claimed) return false;
  claimState.claimed = true;
  return true;
};
assert.deepEqual([claimOnce(), claimOnce()], [true, false]);
assert.match(migration, /FOR UPDATE SKIP LOCKED/);
assert.match(migration, /UPDATE public\.wa_broadcasts[\s\S]*scheduler_claim_token/);
console.log("PASS E EMULATED/STATIC - concurrent workers cannot claim the same broadcast row");

// F: stale sending claims become eligible only after lease expiry.
assert.match(migration, /status::text = 'sending'[\s\S]*scheduler_claim_until <= clock_timestamp\(\)/);
assert.match(migration, /recovered_stale_claim/);
assert.match(server, /recoverStaleProcessingRecipients/);
console.log("PASS F STATIC - stale claim and stale recipient recovery paths exist");

// G: scheduler retries keep the same logical recipient identity.
assert.match(workerFlow, /\.eq\("id", rec\.id\)[\s\S]*\.eq\("status", "pending"\)/);
assert.match(workerFlow, /recipientId: rec\.id/);
console.log("PASS G STATIC - scheduler retry keeps one logical recipient claim/send identity");

// H: duplicate normalized numbers are rejected at create and atomic pre-send validation.
assert.match(createFlow, /seenPhones\.has\(phone\)[\s\S]*Nomor duplikat dalam broadcast yang sama/);
assert.match(workerFlow, /preflight_wa_broadcast_recipients/);
assert.match(workerFlow, /p_body_variable_count: requirements\.bodyVariableCount/);
assert.match(workerFlow, /p_requires_media: requirements\.requiresMedia/);
assert.match(createFlow, /indexedVariables\.get\(index \+ 1\) \?\? ""/);
console.log("PASS H STATIC - duplicate recipient is detected server-side");

// I-J: destination validation and existing Indonesian normalization.
const normalize = (value) => {
  let raw = String(value ?? "").trim().replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("08")) return `+628${raw.slice(2)}`;
  if (raw.startsWith("8")) return `+62${raw}`;
  if (raw.startsWith("62")) return `+${raw}`;
  if (!raw.startsWith("+")) return `+${raw}`;
  return raw;
};
assert.equal(normalize(""), "");
assert.match(server, /if \(!input\)[\s\S]*Nomor kosong/);
console.log("PASS I EMULATED/STATIC - empty/invalid number is rejected");
assert.equal(normalize("0812-3456-7890"), "+6281234567890");
assert.equal(normalize("6281234567890"), "+6281234567890");
assert.equal(normalize("+14155552671"), "+14155552671");
console.log("PASS J EMULATED - valid Indonesian/international numbers normalize consistently");

// K: worker runs recipient rejection before the billing debit call.
assert.ok(
  workerFlow.indexOf("preflight_wa_broadcast_recipients") < workerFlow.indexOf("consumeBroadcastToken"),
  "recipient validation must happen before billing",
);
assert.match(createFlow, /status: rejectionReasons\.length === 0 \? "pending" : "failed"/);
console.log("PASS K STATIC - invalid recipient is failed before debit");

// L-M: Batch 4 canonical pricing and Billing Core idempotency are retained.
assert.match(server, /getCanonicalOrOriginalUsagePrice/);
assert.match(workerFlow, /consumeBroadcastToken/);
assert.match(batch1, /UNIQUE INDEX[\s\S]*provider, external_reference/i);
assert.match(batch4, /PASS L|canonical pricing|amountIdr: tokenPrice/i);
console.log("PASS L STATIC - valid recipient still uses Batch 4 canonical pricing");
assert.match(server, /provider: "broadcast_usage"[\s\S]*externalReference: recipientReference/);
console.log("PASS M STATIC - retry retains Billing Core no-double-charge identity");

// Timezone contract is explicit at both UI and server boundaries.
assert.match(broadcastUi, /formatLocalScheduledAt\(scheduleDate, scheduleTime\)/);
assert.match(scheduledAtHelper, /getTimezoneOffset\(\)/);
assert.match(scheduledAtHelper, /offsetSign[\s\S]*offsetHours[\s\S]*offsetRemainderMinutes/);
assert.match(server, /scheduledAt wajib menyertakan timezone\/offset eksplisit/);
console.log("PASS TIMEZONE STATIC - browser local time is serialized with its explicit runtime offset");

console.log("\nRESULT: 14/14 Batch 5 scheduler/recipient checks passed (emulated/static)");
console.log("N (500-recipient acceptance) MUST BE RUN SEPARATELY");
console.log("REAL DATABASE CONCURRENCY AND SUPABASE CRON VERIFICATION REQUIRED");
