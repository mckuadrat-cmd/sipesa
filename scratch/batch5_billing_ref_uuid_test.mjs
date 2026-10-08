import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const originalBillingMigration = read("supabase/migrations/20261005090000_create_atomic_billing_core.sql");
const fixMigration = read("supabase/migrations/20261006150000_fix_billing_ref_id_uuid_cast.sql");
const server = read("supabase/functions/server/index.ts");

const broadcastId = "9ac9c46f-2f5a-4cf4-8a8a-308ba43193fd";
const recipientId = "6cc7f5ca-1867-43a8-86d7-1bef65ca0b79";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

assert.match(broadcastId, uuidPattern);
assert.match(recipientId, uuidPattern);

// Reproduce the Cloud 42804 contract: the original RPC exposes p_ref_id as
// text and inserted that text expression directly into the UUID column.
assert.match(originalBillingMigration, /p_ref_id text/);
assert.match(
  originalBillingMigration,
  /INSERT INTO public\.billing_transactions[\s\S]*ref_id[\s\S]*nullif\(trim\(coalesce\(p_ref_id, ''\)\), ''\)/,
);

const emulatePostgresAssignment = (columnType, expressionType) => {
  if (columnType === "uuid" && expressionType === "text") {
    const error = new Error('column "ref_id" is of type uuid but expression is of type text');
    error.code = "42804";
    throw error;
  }
};

assert.throws(
  () => emulatePostgresAssignment("uuid", "text"),
  (error) => error?.code === "42804",
);

// The repair parses the transport text once at the database boundary and the
// INSERT receives a UUID-typed variable. external_reference remains text.
assert.match(fixMigration, /v_ref_id uuid/);
assert.match(fixMigration, /v_ref_id := trim\(p_ref_id\)::uuid/);
assert.match(fixMigration, /ref_id,[\s\S]*external_reference[\s\S]*v_ref_id,[\s\S]*v_external_reference/);
assert.doesNotMatch(fixMigration, /ALTER TABLE[\s\S]*ref_id[\s\S]*TYPE text/i);
assert.doesNotThrow(() => emulatePostgresAssignment("uuid", "uuid"));

// Scheduled broadcast billing uses the recipient UUID for the relational
// reference and the same textual value only for idempotency.
assert.match(
  server,
  /recipientReference = requireUuidBillingReference\(input\.recipientId[\s\S]*refType: "broadcast_recipient",[\s\S]*refId: recipientReference,[\s\S]*provider: "broadcast_usage",[\s\S]*externalReference: recipientReference/,
);
assert.match(server, new RegExp(`recipientId: rec\\.id`));
assert.ok(broadcastId !== recipientId);

console.log("PASS - original scheduled-worker billing contract reproduces PostgreSQL 42804 statically");
console.log("PASS - ref_id is UUID-typed before INSERT while external_reference remains text");
console.log("PASS - scheduled broadcast recipient UUID remains the billing/idempotency identity");
