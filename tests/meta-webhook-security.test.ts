import assert from "node:assert/strict";
import test from "node:test";

import {
  createMetaWebhookSignature,
  verifyMetaWebhookSignature,
} from "../supabase/functions/server/meta-webhook-security.js";

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("accepts an authentic Meta webhook signature for the exact raw payload", async () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "synthetic-waba" }] });
  const secret = "synthetic-test-secret";
  const signature = await createMetaWebhookSignature(rawBody, secret);

  assert.deepEqual(
    await verifyMetaWebhookSignature(rawBody, `sha256=${toHex(signature)}`, secret),
    { ok: true, reason: "valid" },
  );
});

test("rejects tampered, malformed, and unsigned webhook payloads", async () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const secret = "synthetic-test-secret";
  const signature = await createMetaWebhookSignature(rawBody, secret);
  const header = `sha256=${toHex(signature)}`;

  assert.deepEqual(
    await verifyMetaWebhookSignature(`${rawBody} `, header, secret),
    { ok: false, reason: "invalid_signature" },
  );
  assert.deepEqual(
    await verifyMetaWebhookSignature(rawBody, "sha256=not-hex", secret),
    { ok: false, reason: "invalid_signature" },
  );
  assert.deepEqual(
    await verifyMetaWebhookSignature(rawBody, null, secret),
    { ok: false, reason: "missing_signature" },
  );
});
