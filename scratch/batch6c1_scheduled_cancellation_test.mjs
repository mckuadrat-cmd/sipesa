import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const broadcastView = read("src/app/components/broadcast-view.tsx");
const broadcastHistory = read("src/app/components/broadcast-history.tsx");
const progressModal = read("src/app/components/BroadcastProgressModal.tsx");
const api = read("src/app/lib/api.ts");
const claimMigration = read("supabase/migrations/20261006130000_scheduled_broadcast_claim.sql");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const cancelScheduleFlow = section(
  server,
  'app.post(`${API_PREFIX}/broadcasts/:id/cancel-schedule`',
  'app.post(`${API_PREFIX}/broadcasts/delete`',
);

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("scheduled confirmation uses Jadwalkan CTA", () => {
  assert.match(
    broadcastView,
    /scheduleEnabled \? "Ya, Jadwalkan" : "Ya, Kirim Sekarang"/,
  );
});

check("immediate confirmation uses Kirim Sekarang CTA", () => {
  assert.match(broadcastView, /"Ya, Kirim Sekarang"/);
  assert.doesNotMatch(broadcastView, /Ya, Kirim Broadcast/);
});

check("future scheduled queued broadcast has an atomic cancellation path", () => {
  assert.match(cancelScheduleFlow, /existing\.scheduled_at/);
  assert.match(cancelScheduleFlow, /existing\.status !== "queued"/);
  assert.match(cancelScheduleFlow, /existing\.started_at/);
  assert.match(
    cancelScheduleFlow,
    /\.update\(\{[\s\S]*status: "cancelled"[\s\S]*\.eq\("status", "queued"\)[\s\S]*\.not\("scheduled_at", "is", null\)[\s\S]*\.is\("started_at", null\)/,
  );
});

check("second cancellation is idempotent and reconciles pending recipients", () => {
  assert.match(
    cancelScheduleFlow,
    /existing\.status === "cancelled"[\s\S]*\.eq\("status", "pending"\)[\s\S]*duplicate: true/,
  );
  assert.match(cancelScheduleFlow, /current\?\.status === "cancelled"[\s\S]*duplicate: true/);
});

check("cancelled broadcasts are not scheduler-claim eligible", () => {
  assert.match(claimMigration, /broadcast\.status::text = 'queued'/);
  assert.match(claimMigration, /broadcast\.status::text = 'sending'/);
  assert.doesNotMatch(claimMigration, /broadcast\.status(?:::text)? = 'cancelled'/);

  const isClaimable = (status) => status === "queued" || status === "sending";
  assert.equal(isClaimable("cancelled"), false);
});

check("only pending recipients are terminally cancelled", () => {
  assert.match(
    cancelScheduleFlow,
    /\.from\("wa_broadcast_recipients"\)[\s\S]*status: "cancelled"[\s\S]*\.eq\("org_id", user\.org_id\)[\s\S]*\.eq\("broadcast_id", cancelled\.id\)[\s\S]*\.eq\("status", "pending"\)/,
  );
});

check("cancellation does not debit billing", () => {
  assert.doesNotMatch(cancelScheduleFlow, /consumeBroadcastToken|applyBillingMutation|billing_transactions|billing_balance/);
});

check("sending or already-started broadcast is rejected by the pending-schedule endpoint", () => {
  const cancellable = (row) => Boolean(
    row.scheduledAt && row.status === "queued" && !row.startedAt,
  );
  assert.equal(cancellable({ scheduledAt: "2026-10-07T10:00:00+07:00", status: "sending", startedAt: null }), false);
  assert.equal(cancellable({ scheduledAt: "2026-10-07T10:00:00+07:00", status: "queued", startedAt: "2026-10-07T03:00:01Z" }), false);
  assert.match(cancelScheduleFlow, /tidak dapat dibatalkan/);
  assert.doesNotMatch(progressModal, /Cancel Broadcast|handleCancelBroadcast/);
});

check("other tenants cannot discover or cancel the broadcast", () => {
  assert.match(cancelScheduleFlow, /requireAuth, requireOrgAdmin/);
  const tenantFilters = cancelScheduleFlow.match(/\.eq\("org_id", user\.org_id\)/g) ?? [];
  assert.ok(tenantFilters.length >= 4, "all read/write boundaries must remain tenant scoped");
});

check("history keeps the scheduled cancellation path in the selection toolbar", () => {
  assert.match(
    broadcastHistory,
    /pendingSchedule = status === "queued" && !!broadcast\.scheduledAt && !broadcast\.startedAt/,
  );
  assert.match(broadcastHistory, /Batalkan Jadwal/);
  assert.match(broadcastHistory, /Dibatalkan/);
  assert.match(broadcastHistory, /"Batalkan Jadwal Broadcast"/);
  assert.match(api, /cancelScheduledBroadcast[\s\S]*\/cancel-schedule/);
});

console.log(`Batch 6C-1 scheduled cancellation regression: ${passed}/10 PASS`);
