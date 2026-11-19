import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceBroadcastPreflight,
  fingerprintBroadcastRequest,
  normalizeIdempotencyKey,
  resolveIdempotencyReplay,
} from "../supabase/functions/server/broadcast-create-guards.ts";
import { ensureBroadcastCreateAttempt } from "../src/app/lib/broadcast-idempotency.ts";

test("direct create is rejected whenever shared pre-flight has a blocker", () => {
  for (const code of ["MEDIA_URL_INVALID", "SENDER_ACCESS_TOKEN_MISSING", "TEMPLATE_METADATA_UNVERIFIED", "INSUFFICIENT_BALANCE", "RECIPIENT_INVALID"]) {
    const decision = enforceBroadcastPreflight(
      { blockers: [{ code, scope: "test", message: code }], duplicateRisks: [] },
      { duplicateRiskAcknowledged: true },
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "PREFLIGHT_BLOCKED");
  }
});

test("duplicate warning requires explicit acknowledgement but does not become a blocker", () => {
  const input = { blockers: [], duplicateRisks: [{ rowNumber: 2 }] };
  assert.equal(enforceBroadcastPreflight(input, { duplicateRiskAcknowledged: false }).allowed, false);
  assert.equal(enforceBroadcastPreflight(input, { duplicateRiskAcknowledged: true }).allowed, true);
});

test("same key and same canonical payload resolves to the existing broadcast", async () => {
  const left = { recipients: [{ phone: "628111", vars: { var2: "B", var1: "A" } }], mode: "template" };
  const right = { mode: "template", recipients: [{ vars: { var1: "A", var2: "B" }, phone: "628111" }] };
  const fingerprint = await fingerprintBroadcastRequest(left);
  assert.equal(fingerprint, await fingerprintBroadcastRequest(right));
  assert.deepEqual(
    resolveIdempotencyReplay({ id: "broadcast-1", request_fingerprint: fingerprint, idempotency_completed_at: "2026-11-19T00:00:00Z" }, await fingerprintBroadcastRequest(right)),
    { outcome: "replay", broadcastId: "broadcast-1" },
  );
});

test("same key and different payload is rejected", async () => {
  const original = await fingerprintBroadcastRequest({ recipients: [{ phone: "628111", vars: { var1: "Ahmad" } }] });
  const changed = await fingerprintBroadcastRequest({ recipients: [{ phone: "628111", vars: { var1: "Aisyah" } }] });
  assert.notEqual(original, changed);
  assert.equal(resolveIdempotencyReplay({ id: "broadcast-1", request_fingerprint: original, idempotency_completed_at: "2026-11-19T00:00:00Z" }, changed).outcome, "conflict");
});

test("a concurrent replay cannot use a broadcast before recipient provisioning completes", async () => {
  const fingerprint = await fingerprintBroadcastRequest({ recipients: [{ phone: "628111" }] });
  assert.equal(
    resolveIdempotencyReplay({ id: "broadcast-1", request_fingerprint: fingerprint, idempotency_completed_at: null }, fingerprint).outcome,
    "in_progress",
  );
});

test("frontend reuses a key for retry and rotates it for a different logical payload", () => {
  let sequence = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const first = ensureBroadcastCreateAttempt(null, { rows: [1, 2] }, createId);
  const retry = ensureBroadcastCreateAttempt(first, { rows: [1, 2] }, createId);
  const intentional = ensureBroadcastCreateAttempt(retry, { rows: [1, 2, 3] }, createId);
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.notEqual(intentional.idempotencyKey, first.idempotencyKey);
});

test("two intentional broadcasts may use different keys even with the same payload", () => {
  let sequence = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const first = ensureBroadcastCreateAttempt(null, { rows: [1, 2] }, createId);
  const second = ensureBroadcastCreateAttempt(null, { rows: [1, 2] }, createId);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test("two students on one number remain distinct rows in the fingerprint", async () => {
  const twoStudents = await fingerprintBroadcastRequest({
    recipients: [
      { phone: "628111", vars: { var1: "Ahmad" } },
      { phone: "628111", vars: { var1: "Aisyah" } },
    ],
  });
  const oneStudent = await fingerprintBroadcastRequest({ recipients: [{ phone: "628111", vars: { var1: "Ahmad" } }] });
  assert.notEqual(twoStudents, oneStudent);
});

test("idempotency keys are bounded and safe for indexed storage", () => {
  assert.equal(normalizeIdempotencyKey("12345678-1234-1234-1234-123456789012"), "12345678-1234-1234-1234-123456789012");
  assert.throws(() => normalizeIdempotencyKey("short"));
  assert.throws(() => normalizeIdempotencyKey("x".repeat(16) + "/unsafe"));
});
