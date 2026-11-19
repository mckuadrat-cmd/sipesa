import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serverSource = readFileSync(new URL("../supabase/functions/server/index.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20261119130000_broadcast_create_idempotency.sql", import.meta.url),
  "utf8",
);

test("POST /broadcasts enforces shared pre-flight before inserting a broadcast", () => {
  const routeStart = serverSource.indexOf('app.post(`${API_PREFIX}/broadcasts`,');
  const routeEnd = serverSource.indexOf('app.post(`${API_PREFIX}/broadcasts/:id/start`', routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.ok(routeStart > 0 && routeEnd > routeStart);
  assert.ok(route.includes("evaluateBroadcastPreflightCore(supa, user"));
  assert.ok(route.includes("enforceBroadcastPreflight(preflight.result"));
  assert.ok(route.indexOf("enforceBroadcastPreflight(preflight.result") < route.indexOf('.from("wa_broadcasts")\n      .insert'));
});

test("shared pre-flight makes critical sender, template, media, parameter, and balance failures blockers", () => {
  const coreStart = serverSource.indexOf("async function evaluateBroadcastPreflightCore");
  const coreEnd = serverSource.indexOf('app.post(`${API_PREFIX}/broadcasts/preflight`', coreStart);
  const core = serverSource.slice(coreStart, coreEnd);
  for (const contract of [
    "evaluateSenderReadiness(numberRow)",
    "evaluateTemplateMetadataPolicy(template)",
    "validateTemplateRuntimeInput(template",
    "inspectMediaReference(mediaUrl)",
    "INSUFFICIENT_BALANCE",
  ]) assert.ok(core.includes(contract), `missing shared pre-flight contract: ${contract}`);
  assert.ok(!core.includes("TEMPLATE_METADATA_STALE"), "template age must not be a blocker");
});

test("idempotency migration uses an org-scoped partial unique index and remains nullable for legacy clients", () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS idempotency_key text/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_broadcasts_org_idempotency_key/);
  assert.match(migrationSource, /ON public\.wa_broadcasts \(org_id, idempotency_key\)/);
  assert.match(migrationSource, /WHERE idempotency_key IS NOT NULL/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS idempotency_completed_at timestamptz/);
  assert.doesNotMatch(migrationSource, /idempotency_key text NOT NULL/i);
});

test("idempotent replay exits before recipient insert, worker start, and billing work", () => {
  const routeStart = serverSource.indexOf('app.post(`${API_PREFIX}/broadcasts`,');
  const routeEnd = serverSource.indexOf('app.post(`${API_PREFIX}/broadcasts/:id/start`', routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  const replayReturn = route.indexOf("idempotentReplay: true");
  const recipientInsert = route.indexOf('.from("wa_broadcast_recipients")');
  const workerStart = route.indexOf("runBroadcastWorkerInBackground");
  assert.ok(replayReturn > 0 && replayReturn < recipientInsert && replayReturn < workerStart);
});
