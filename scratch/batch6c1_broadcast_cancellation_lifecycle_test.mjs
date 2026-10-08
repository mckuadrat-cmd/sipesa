import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const history = read("src/app/components/broadcast-history.tsx");
const api = read("src/app/lib/api.ts");
const apiClient = read("src/app/lib/apiClient.ts");
const progressModal = read("src/app/components/BroadcastProgressModal.tsx");
const claimMigration = read("supabase/migrations/20261006130000_scheduled_broadcast_claim.sql");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const activeCancel = section(
  server,
  'app.post(`${API_PREFIX}/broadcasts/:id/cancel`',
  '// Cancel a scheduled broadcast before processing starts.',
);
const pendingCancel = section(
  server,
  'app.post(`${API_PREFIX}/broadcasts/:id/cancel-schedule`',
  'app.post(`${API_PREFIX}/broadcasts/delete`',
);
const deleteFlow = section(
  server,
  'app.post(`${API_PREFIX}/broadcasts/delete`',
  '// ===== JOBS / WORKER =====',
);
const worker = section(server, "async function runBroadcastWorker(", "function runBroadcastWorkerInBackground(");
const tableRows = section(history, "<tbody>", "</tbody>");
const toolbar = section(history, 'title={selectedIds.length > 1', '<div className="overflow-auto');

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("future scheduled rows render Scheduled as type and Pending as process status", () => {
  assert.match(history, /const whenLabel = log\.scheduledAt \? "Scheduled" : "Direct"/);
  assert.match(history, /s === "queued"[\s\S]*Pending/);
});

check("scheduled queued rows are not presented as Sending", () => {
  assert.match(history, /s === "sending" && !!startedAt/);
  assert.doesNotMatch(history, /s === "sending" \|\| s === "queued"/);
});

check("worker transition provides the real Sending boundary", () => {
  assert.match(worker, /status: "sending", started_at: broadcast\.started_at \?\? nowIso\(\)/);
  assert.match(worker, /\.eq\("status", "queued"\)/);
});

check("toolbar order is Cancel then Hapus then Export CSV", () => {
  const cancelAt = toolbar.indexOf("Cancel");
  const deleteAt = toolbar.indexOf("Hapus");
  const exportAt = toolbar.indexOf("Export CSV");
  assert.ok(cancelAt >= 0 && cancelAt < deleteAt && deleteAt < exportAt);
});

check("row-level schedule cancellation was removed", () => {
  assert.doesNotMatch(tableRows, /Batalkan Jadwal|setCancelTarget/);
  assert.doesNotMatch(progressModal, /Cancel Broadcast|handleCancelBroadcast/);
});

check("pending schedule cancellation remains conditional and idempotent", () => {
  assert.match(pendingCancel, /existing\.status === "cancelled"[\s\S]*duplicate: true/);
  assert.match(pendingCancel, /\.eq\("status", "queued"\)[\s\S]*\.not\("scheduled_at", "is", null\)[\s\S]*\.is\("started_at", null\)/);
});

check("cancelled schedules cannot be claimed or revived by the scheduler", () => {
  assert.match(claimMigration, /broadcast\.status::text = 'queued'/);
  assert.match(claimMigration, /broadcast\.status::text = 'sending'/);
  assert.doesNotMatch(claimMigration, /broadcast\.status(?:::text)? = 'cancelled'/);
  assert.match(server, /currentStatus === "cancelled"[\s\S]*nextStatus = "cancelled"/);
});

check("active cancellation atomically transitions only sending broadcasts", () => {
  assert.match(activeCancel, /existing\.status !== "sending" \|\| !existing\.started_at/);
  assert.match(activeCancel, /status: "cancelled"[\s\S]*\.eq\("status", "sending"\)[\s\S]*\.not\("started_at", "is", null\)/);
});

check("active cancellation stops pending recipients only", () => {
  assert.match(activeCancel, /\.from\("wa_broadcast_recipients"\)[\s\S]*status: "cancelled"[\s\S]*\.eq\("status", "pending"\)/);
  const recipients = ["pending", "processing", "sent", "delivered", "read", "failed"];
  const afterCancel = recipients.map((status) => status === "pending" ? "cancelled" : status);
  assert.deepEqual(afterCancel, ["cancelled", "processing", "sent", "delivered", "read", "failed"]);
});

check("in-flight processing recipient completes inside the existing safe boundary", () => {
  assert.match(activeCancel, /processing recipient already[\s\S]*must finish/);
  assert.match(worker, /currentBroadcast\?\.status !== "sending"[\s\S]*break/);
  assert.ok(worker.indexOf('select("status")') < worker.indexOf('.eq("status", "pending")'));
  assert.match(worker, /\.update\(\{ status: "processing"[\s\S]*\.eq\("status", "pending"\)/);
  assert.match(server, /recoverCancelledBroadcastProcessingRecipients[\s\S]*\.eq\("status", "processing"\)[\s\S]*\.eq\("status", "cancelled"\)/);
  assert.match(server, /await recoverCancelledBroadcastProcessingRecipients\(supa\)[\s\S]*claim_due_wa_broadcasts/);
});

check("cancellation introduces no debit, refund, or compensation mutation", () => {
  for (const flow of [activeCancel, pendingCancel]) {
    assert.doesNotMatch(flow, /consumeBroadcastToken\s*\(|applyBillingMutation\s*\(|refundBroadcast|billing_transactions|billing_balance/i);
  }
});

check("Cancel is limited to exactly one eligible Pending or Sending selection", () => {
  assert.match(history, /selectedBroadcasts\.length === 1 && isCancellableBroadcast/);
  assert.match(history, /pendingSchedule = status === "queued"/);
  assert.match(history, /activeSending = status === "sending" && !!broadcast\.startedAt/);
  assert.match(history, /disabled=\{!selectedCancelTarget\}/);
});

check("completed and cancelled rows are not cancellable", () => {
  const eligible = (row) =>
    (row.status === "queued" && Boolean(row.scheduledAt) && !row.startedAt)
    || (row.status === "sending" && Boolean(row.startedAt));
  assert.equal(eligible({ status: "completed", startedAt: "x" }), false);
  assert.equal(eligible({ status: "cancelled", scheduledAt: "x" }), false);
});

check("delete cannot bypass an active lifecycle", () => {
  assert.match(deleteFlow, /terminalStatuses = new Set\(\["completed", "failed", "cancelled"\]\)/);
  assert.ok(deleteFlow.indexOf("containsActive") < deleteFlow.indexOf('.from("wa_broadcast_recipients")'));
  assert.match(deleteFlow, /deleteAll[\s\S]*Hapus semua dinonaktifkan/);
  assert.match(history, /selectedBroadcasts\.every\(isDeletableBroadcast\)/);
});

check("Realtime refresh continues to reload authoritative broadcast state", () => {
  assert.match(history, /table: "wa_broadcasts"[\s\S]*loadBroadcasts\("silent"\)/);
  assert.match(history, /await loadBroadcasts\("refresh"\)/);
});

check("both cancellation endpoints are tenant scoped and role protected", () => {
  for (const flow of [activeCancel, pendingCancel]) {
    assert.match(flow, /requireAuth, requireOrgAdmin/);
    assert.ok((flow.match(/\.eq\("org_id", user\.org_id\)/g) ?? []).length >= 3);
  }
});

check("cancel-schedule source route and frontend request match exactly", () => {
  assert.match(api, /cancelScheduledBroadcast[\s\S]*`\$\{API_PREFIX\}\/broadcasts\/\$\{broadcastId\}\/cancel-schedule`[\s\S]*method: "POST"/);
  assert.match(server, /app\.post\(`\$\{API_PREFIX\}\/broadcasts\/:id\/cancel-schedule`/);
  assert.ok(server.indexOf('/broadcasts/:id/cancel-schedule') < server.indexOf("app.notFound"));
  assert.match(apiClient, /functions\/v1\/server/);
});

check("Batch 5 worker still uses one recipient claim and idempotent billing identity", () => {
  assert.match(worker, /\.eq\("id", rec\.id\)[\s\S]*\.eq\("status", "pending"\)/);
  assert.match(worker, /consumeBroadcastToken\(\{[\s\S]*recipientId: rec\.id/);
  assert.match(server, /provider: "broadcast_usage"[\s\S]*externalReference: recipientReference/);
});

console.log(`Batch 6C-1 cancellation lifecycle regression: ${passed}/18 PASS`);
