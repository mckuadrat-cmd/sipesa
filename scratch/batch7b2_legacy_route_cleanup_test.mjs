import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");
const api = fs.readFileSync("src/app/lib/api.ts", "utf8");

const removedRoutes = [
  "/dev/check-columns",
  "/dev/webhook-debug",
  "/dev/sync-read-statuses",
  "/dev/fix-all-broadcasts",
  "/dev/resume-broadcasts",
  "/dev/inspect-latest",
  "/superadmin/fix-stuck-broadcasts",
  "/superadmin/reset-broadcast",
];

for (const route of removedRoutes) {
  assert.doesNotMatch(server, new RegExp(`app\\.(?:get|post|put|delete)\\([^\\n]*${route.replaceAll("/", "\\/")}`));
}
console.log("PASS removed legacy routes are no longer registered");

assert.doesNotMatch(server, /reconciledBroadcasts|resumedCount|recipientsAround51/);
console.log("PASS no replacement GET broadcast repair/resume mutation route exists");

assert.match(server, /app\.post\(`\$\{API_PREFIX\}\/jobs\/process-due-broadcasts`/);
assert.match(server, /\.rpc\("claim_due_wa_broadcasts"/);
assert.match(server, /async function recoverStaleProcessingRecipients/);
assert.match(server, /app\.post\(`\$\{API_PREFIX\}\/broadcasts\/:id\/cancel`/);
assert.match(server, /app\.post\(`\$\{API_PREFIX\}\/broadcasts\/:id\/cancel-schedule`/);
console.log("PASS scheduler, atomic claim, stale recovery, and cancellation remain registered");

assert.match(server, /app\.post\(`\$\{API_PREFIX\}\/numbers\/:id\/test`/);
assert.match(api, /async sendBroadcastText\(/);
assert.match(api, /async topUp\(/);
console.log("PASS explicitly retained compatibility and payment items remain present");

assert.match(server, /app\.get\("\/webhook", handleWebhookGet\)/);
assert.match(server, /app\.post\("\/webhook", handleWebhookPost\)/);
assert.match(server, /app\.get\("\/webhooks\/meta", handleWebhookGet\)/);
assert.match(server, /app\.post\("\/webhooks\/meta", handleWebhookPost\)/);
console.log("PASS effective Meta webhook routes remain present");

console.log("Batch 7B-2 legacy route cleanup regression: 5/5 PASS");
