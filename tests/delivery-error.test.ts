import test from "node:test";
import assert from "node:assert/strict";
import { deliveryFailureCsvFields, normalizeDeliveryFailure } from "../src/app/lib/delivery-error.ts";

test("parses complete Meta webhook error", () => {
  const failure = normalizeDeliveryFailure({
    meta_status_payload: { status: "failed", errors: [{ code: 131026, error_subcode: 7, title: "Message undeliverable", message: "Provider detail", error_data: { details: "Delivery failed" }, type: "OAuthException", fbtrace_id: "trace" }] },
  });
  assert.equal(failure?.code, "131026");
  assert.equal(failure?.subcode, "7");
  assert.equal(failure?.source, "META_WEBHOOK");
  assert.equal(failure?.acceptedByMeta, true);
  assert.equal(failure?.technicalDetails, "Delivery failed");
});

test("recognizes known Meta codes without claiming an inactive or blocked number", () => {
  for (const code of ["131026", "130472", "131049", "131053"]) {
    const failure = normalizeDeliveryFailure({ error_code: code, error: "legacy" });
    assert.equal(failure?.code, code);
    assert.ok(!failure?.userMessage.toLowerCase().includes("pasti tidak aktif"));
    assert.ok(!failure?.userMessage.toLowerCase().includes("pasti memblokir"));
  }
});

test("supports historical payload fallback and legacy string-only records", () => {
  assert.equal(normalizeDeliveryFailure({ metaStatusPayload: { status: "failed", errors: [{ code: 131049, title: "Healthy ecosystem engagement" }] } })?.code, "131049");
  const legacy = normalizeDeliveryFailure({ error: "RECIPIENT_VALIDATION_FAILED: Variable template kosong" });
  assert.equal(legacy?.code, null);
  assert.equal(legacy?.source, "AMBIGUOUS");
});

test("preserves explicit internal failure classification", () => {
  const failure = normalizeDeliveryFailure({ error: "Saldo token tidak cukup", failure_source: "BILLING", failure_stage: "token_debit", retry_classification: "NON_RETRYABLE" });
  assert.equal(failure?.source, "BILLING");
  assert.equal(failure?.retry, "NON_RETRYABLE");
});

test("exports sanitized structured fields without raw Meta payload", () => {
  const failure = normalizeDeliveryFailure({ meta_status_payload: { status: "failed", secret: "must-not-export", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "safe detail" } }] } });
  const fields = deliveryFailureCsvFields(failure);
  assert.equal(fields[0], "131026");
  assert.ok(!fields.join("|").includes("must-not-export"));
});
