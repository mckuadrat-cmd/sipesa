// Batch 2 verification suite.
// Signature checks import the production helper. Database and external Meta
// behavior are emulated and must be repeated against staging.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMetaWebhookSignature,
  verifyMetaWebhookSignature,
} from "../supabase/functions/server/meta-webhook-security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toHex = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

async function authenticatedWebhook(rawBody, signature, secret, effects) {
  const verification = await verifyMetaWebhookSignature(rawBody, signature, secret);
  if (!verification.ok) return verification;
  JSON.parse(rawBody);
  effects.databaseWrites += 1;
  return verification;
}

class WebhookModel {
  constructor() {
    this.messages = new Map();
    this.autoReplyClaims = new Set();
    this.autoReplies = 0;
    this.status = "pending";
    this.tail = Promise.resolve();
  }

  exclusive(action) {
    const run = this.tail.then(action, action);
    this.tail = run.catch(() => undefined);
    return run;
  }

  inbound(messageId, dailyClaim) {
    return this.exclusive(async () => {
      if (this.messages.has(messageId)) return { duplicate: true };
      this.messages.set(messageId, { id: messageId });
      if (!this.autoReplyClaims.has(dailyClaim)) {
        this.autoReplyClaims.add(dailyClaim);
        this.autoReplies += 1;
      }
      return { duplicate: false };
    });
  }

  advance(next) {
    const rank = { pending: 0, processing: 10, sent: 20, delivered: 30, read: 40 };
    if ((rank[next] ?? -1) > (rank[this.status] ?? -1)) this.status = next;
    return this.status;
  }
}

class ManualChatModel {
  constructor(balance) {
    this.balance = balance;
    this.ledger = new Map();
    this.messages = new Map();
    this.metaCalls = 0;
  }

  mutate(provider, reference, delta) {
    const key = `${provider}:${reference}`;
    if (this.ledger.has(key)) return { ...this.ledger.get(key), duplicate: true };
    if (this.balance + delta < 0) throw new Error("saldo token tidak mencukupi");
    const before = this.balance;
    this.balance += delta;
    const row = { before, after: this.balance, delta, duplicate: false };
    this.ledger.set(key, row);
    return row;
  }

  compensate(reference) {
    const debit = this.ledger.get(`manual_chat_debit:${reference}`);
    if (!debit) return { originalMissing: true };
    return this.mutate("manual_chat_refund", reference, -debit.delta);
  }

  async send({ reference, freeWindow, meta = "accept", localPostFailure = false }) {
    const existing = this.messages.get(reference);
    if (existing) return { ...existing, duplicate: true };

    const message = { status: "processing", billingState: freeWindow ? "not_required" : "pending" };
    this.messages.set(reference, message);

    if (!freeWindow) {
      try {
        this.mutate("manual_chat_debit", reference, -1);
        message.billingState = "debited";
      } catch (error) {
        message.status = "failed";
        message.billingState = "insufficient_balance";
        return { ...message, error: error.message };
      }
    }

    this.metaCalls += 1;
    if (meta === "reject") {
      if (!freeWindow) {
        this.compensate(reference);
        message.billingState = "refunded";
      }
      message.status = "failed";
      return { ...message, error: "Meta rejected" };
    }

    message.metaMessageId = `wamid.${reference}`;
    message.status = "sent";
    message.outcome = localPostFailure ? "accepted_reconciliation_required" : "accepted";
    return { ...message };
  }
}

async function main() {
  const secret = "unit-test-only-secret";
  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "entry-1" }] });
  const validSignature = `sha256=${toHex(await createMetaWebhookSignature(rawBody, secret))}`;

  let effects = { databaseWrites: 0 };
  assert.equal((await authenticatedWebhook(rawBody, validSignature, secret, effects)).ok, true);
  assert.equal(effects.databaseWrites, 1);
  console.log("PASS 1 - valid signature is processed");

  effects = { databaseWrites: 0 };
  assert.equal((await authenticatedWebhook(rawBody, "", secret, effects)).reason, "missing_signature");
  assert.equal(effects.databaseWrites, 0);
  console.log("PASS 2 - missing signature is rejected");

  effects = { databaseWrites: 0 };
  const invalid = `sha256=${"0".repeat(64)}`;
  assert.equal((await authenticatedWebhook(rawBody, invalid, secret, effects)).reason, "invalid_signature");
  console.log("PASS 3 - invalid signature is rejected");
  assert.equal(effects.databaseWrites, 0);
  console.log("PASS 4 - invalid signature has zero database side effect");

  effects = { databaseWrites: 0 };
  assert.equal((await authenticatedWebhook(rawBody, validSignature, "", effects)).reason, "missing_secret");
  assert.equal(effects.databaseWrites, 0);
  console.log("PASS 4B - missing server secret fails closed with zero database side effect");

  let webhook = new WebhookModel();
  await webhook.inbound("wamid.in-1", "number:contact:day");
  await webhook.inbound("wamid.in-1", "number:contact:day");
  assert.equal(webhook.messages.size, 1);
  console.log("PASS 5 - duplicate inbound creates one message");

  webhook = new WebhookModel();
  await Promise.all(Array.from({ length: 10 }, () => webhook.inbound("wamid.in-2", "n:c:d")));
  assert.equal(webhook.messages.size, 1);
  console.log("PASS 6 - emulated concurrent inbound creates one logical message");
  assert.equal(webhook.autoReplies, 1);
  console.log("PASS 7 - duplicate webhook creates at most one auto-reply");

  assert.equal(webhook.advance("delivered"), "delivered");
  assert.equal(webhook.advance("sent"), "delivered");
  assert.equal(webhook.advance("read"), "read");
  assert.equal(webhook.advance("delivered"), "read");
  console.log("PASS 8 - out-of-order status cannot downgrade");
  assert.equal(webhook.status, "read");
  console.log("PASS 9 - valid status processing remains functional");

  let chat = new ManualChatModel(0);
  const free = await chat.send({ reference: "free-send-000001", freeWindow: true });
  assert.equal(free.status, "sent");
  assert.equal(chat.balance, 0);
  console.log("PASS 10 - free-window send does not debit");
  assert.equal(chat.ledger.size, 0);
  console.log("PASS 11 - free-window send creates no false usage ledger");

  chat = new ManualChatModel(2);
  const paid = await chat.send({ reference: "paid-send-000001", freeWindow: false });
  assert.equal(paid.status, "sent");
  assert.equal(chat.balance, 1);
  assert.equal(chat.ledger.get("manual_chat_debit:paid-send-000001").delta, -1);
  console.log("PASS 12 - paid send has consistent debit and ledger");

  chat = new ManualChatModel(0);
  const insufficient = await chat.send({ reference: "no-funds-0000001", freeWindow: false });
  assert.equal(insufficient.status, "failed");
  assert.equal(chat.metaCalls, 0);
  console.log("PASS 13 - insufficient balance does not call Meta");

  chat = new ManualChatModel(1);
  const rejected = await chat.send({ reference: "meta-reject-0001", freeWindow: false, meta: "reject" });
  assert.equal(rejected.billingState, "refunded");
  assert.equal(chat.balance, 1);
  console.log("PASS 14 - Meta rejection leaves no permanent charge");

  chat = new ManualChatModel(1);
  const accepted = await chat.send({
    reference: "accepted-local-1",
    freeWindow: false,
    localPostFailure: true,
  });
  assert.equal(accepted.status, "sent");
  assert.equal(accepted.outcome, "accepted_reconciliation_required");
  console.log("PASS 15 - accepted send is not rewritten to failed by a secondary error");

  const retry = await chat.send({ reference: "accepted-local-1", freeWindow: false });
  assert.equal(retry.duplicate, true);
  assert.equal(chat.metaCalls, 1);
  assert.equal(chat.ledger.size, 1);
  console.log("PASS 16 - logical retry does not resend or double-charge");

  chat = new ManualChatModel(1);
  chat.mutate("manual_chat_debit", "refund-retry-01", -1);
  chat.compensate("refund-retry-01");
  chat.compensate("refund-retry-01");
  assert.equal(chat.balance, 1);
  assert.equal(chat.ledger.size, 2);
  console.log("PASS 17 - compensation retry does not double-refund");

  const serverSource = fs.readFileSync(
    path.resolve(__dirname, "../supabase/functions/server/index.ts"),
    "utf8",
  );
  const manualRoute = serverSource.slice(
    serverSource.indexOf("/numbers/:numberId/contacts/:contactId/messages`"),
    serverSource.indexOf("function normalizeTemplateStatus"),
  );
  assert.doesNotMatch(manualRoute, /tokenResult/);
  assert.doesNotMatch(manualRoute, /consume_billing_tokens/);
  assert.doesNotMatch(manualRoute, /from\("billing_transactions"\)\.insert/);
  console.log("PASS 18 - C-03 ReferenceError path and split-ledger pattern are absent");

  const webhookRoute = serverSource.slice(
    serverSource.indexOf("const handleWebhookPost"),
    serverSource.indexOf('app.get("/webhook"'),
  );
  assert.ok(webhookRoute.indexOf("c.req.arrayBuffer()") < webhookRoute.indexOf("JSON.parse(rawBody)"));
  assert.ok(webhookRoute.indexOf("verifyMetaWebhookSignature") < webhookRoute.indexOf("JSON.parse(rawBody)"));
  assert.ok(webhookRoute.indexOf("JSON.parse(rawBody)") < webhookRoute.indexOf("const supa = sb()"));
  assert.doesNotMatch(webhookRoute, /JSON\.stringify\(payload\)/);
  console.log("PASS STATIC - raw signature verification precedes parse and database access");

  const migration = fs.readFileSync(
    path.resolve(__dirname, "../supabase/migrations/20261005110000_secure_meta_webhook_and_manual_chat.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]+wa_messages \(meta_message_id\)/i);
  assert.match(migration, /claim_meta_auto_reply/i);
  assert.match(migration, /compensate_billing_mutation/i);
  console.log("PASS STATIC - database uniqueness, auto-reply claim, and compensation contracts exist");

  console.log("\nRESULT: 21/21 tested/emulated/static checks passed");
  console.log("STAGING DATABASE VERIFICATION REQUIRED");
  console.log("BATCH 1A STAGING DATABASE VERIFICATION REQUIRED remains open");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
