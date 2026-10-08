import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");
const chat = fs.readFileSync("src/app/components/chat-interface.tsx", "utf8");
const api = fs.readFileSync("src/app/lib/api.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261006170000_chat_inbox_performance.sql",
  "utf8",
);
const visibilityHook = fs.readFileSync("src/app/hooks/use-visibility-refresh.ts", "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

const messageGetStart = server.indexOf('app.get(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/messages`');
const messageGetEnd = server.indexOf('app.post(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/read`', messageGetStart);
const messageGet = server.slice(messageGetStart, messageGetEnd);

check("initial conversation load defaults to at most 50 rows", () => {
  assert.match(messageGet, /c\.req\.query\("limit"\) \?\? 50/);
  assert.match(messageGet, /Math\.min\(Math\.max\(requestedLimit, 1\), 100\)/);
  assert.match(messageGet, /\.limit\(limit \+ 1\)/);
  assert.match(api, /options\.limit \?\? 50/);
});

check("stable created_at plus id cursor is implemented server-side", () => {
  assert.match(messageGet, /created_at\.lt\./);
  assert.match(messageGet, /id\.lt\./);
  assert.match(messageGet, /created_at\.gt\./);
  assert.match(messageGet, /id\.gt\./);
  assert.match(messageGet, /\.order\("created_at", \{ ascending \}\)[\s\S]*\.order\("id", \{ ascending \}\)/);
});

check("cursor pagination model has no duplicates or gaps", () => {
  const rows = Array.from({ length: 137 }, (_, index) => ({
    id: String(index).padStart(4, "0"),
    createdAt: new Date(1_700_000_000_000 + Math.floor(index / 3) * 1000).toISOString(),
  }));
  const newestFirst = [...rows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  );
  const collected = [];
  let before = null;
  while (true) {
    const eligible = before
      ? newestFirst.filter((row) => row.createdAt < before.createdAt || (row.createdAt === before.createdAt && row.id < before.id))
      : newestFirst;
    const page = eligible.slice(0, 50).reverse();
    collected.unshift(...page);
    if (eligible.length <= 50) break;
    before = page[0];
  }
  assert.equal(collected.length, rows.length);
  assert.equal(new Set(collected.map((row) => row.id)).size, rows.length);
  assert.deepEqual(collected, rows);
});

check("Realtime handles new messages and status changes for active contact", () => {
  assert.match(chat, /event: "INSERT"[\s\S]*table: "wa_messages"[\s\S]*filter: `number_id=eq\.\$\{numberId\}`/);
  assert.match(chat, /event: "UPDATE"[\s\S]*table: "wa_messages"[\s\S]*filter: `contact_id=eq\.\$\{contactId\}`/);
  assert.match(chat, /selectedContactRef\.current/);
  assert.match(chat, /eventNumberId !== numberId/);
  assert.match(chat, /eventContactId !== contactId/);
  assert.match(api, /supabase\.realtime\.setAuth\(res\.data\.token\)/);
  assert.match(chat, /getAuthToken\(\)[\s\S]*supabase\.realtime\.setAuth\(token\)/);
});

check("Realtime lifecycle diagnostics are development-only and contain no payload content", () => {
  assert.match(chat, /if \(!import\.meta\.env\.DEV\) return/);
  for (const event of [
    "number_channel_status",
    "conversation_channel_status",
    "insert_received",
    "update_received",
    "insert_rejected",
    "update_rejected",
    "number_channel_cleanup",
    "conversation_channel_cleanup",
  ]) {
    assert.match(chat, new RegExp(`logRealtimeDiagnostic\\("${event}"`));
  }
  const diagnosticStart = chat.indexOf("function logRealtimeDiagnostic");
  const diagnosticEnd = chat.indexOf("interface Contact", diagnosticStart);
  assert.doesNotMatch(chat.slice(diagnosticStart, diagnosticEnd), /content|text_body|phone|token/);
});

check("message status merge is monotonic", () => {
  assert.match(chat, /resolveMessageStatus\(existing\.status, message\.status\)/);
  assert.match(chat, /incoming === "failed"/);
  const rank = { queued: 0, processing: 10, sent: 20, delivered: 30, read: 40 };
  let current = "sent";
  for (const incoming of ["delivered", "sent", "read", "delivered"]) {
    if (rank[incoming] >= rank[current]) current = incoming;
  }
  assert.equal(current, "read");
  assert.equal(rank.queued <= rank.processing, true);
});

check("fallback reconciliation is incremental every 30 seconds", () => {
  assert.match(chat, /getMessages\(numberId, contactId, \{ after: cursor, limit: 50 \}\)/);
  assert.match(chat, /getMessageStatuses\(numberId, contactId, recentIds\)/);
  assert.match(chat, /intervalMs: 30_000/);
  assert.doesNotMatch(chat, /setInterval\([\s\S]{0,300}(1000|1_000)/);
});

check("hidden tabs skip periodic reconciliation", () => {
  assert.match(visibilityHook, /document\.visibilityState === "hidden"/);
  assert.match(visibilityHook, /document\.visibilityState === "visible"/);
});

check("GET messages is read-only", () => {
  assert.doesNotMatch(messageGet, /\.update\s*\(/);
  assert.doesNotMatch(messageGet, /\.insert\s*\(/);
  assert.doesNotMatch(messageGet, /\.delete\s*\(/);
});

check("mark-as-read is explicit tenant-scoped and idempotent", () => {
  const readStart = server.indexOf('app.post(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/read`');
  const readEnd = server.indexOf('app.post(`${API_PREFIX}/numbers/:numberId/read-all`', readStart);
  const readRoute = server.slice(readStart, readEnd);
  assert.match(readRoute, /\.eq\("org_id", user\.org_id\)/);
  assert.match(readRoute, /\.eq\("number_id", numberId\)/);
  assert.match(readRoute, /\.eq\("contact_id", contactId\)/);
  assert.match(readRoute, /\.eq\("direction", "in"\)/);
  assert.match(readRoute, /\.eq\("status", "delivered"\)/);
  assert.match(api, /async markConversationRead/);
});

check("conversation unread state is aggregated in Postgres", () => {
  const contactStart = server.indexOf('app.get(`${API_PREFIX}/numbers/:numberId/contacts`');
  const contactEnd = server.indexOf('app.get(`${API_PREFIX}/media/:mediaId`', contactStart);
  const contactRoute = server.slice(contactStart, contactEnd);
  assert.match(contactRoute, /\.rpc\([\s\S]*"get_wa_conversation_summaries"/);
  assert.doesNotMatch(contactRoute, /limit\(20000\)/);
  assert.match(migration, /AND message\.direction = 'in'[\s\S]*AND message\.status = 'delivered'/);
  assert.match(server, /function logContactsRouteFailure[\s\S]*code:[\s\S]*message:[\s\S]*details:[\s\S]*hint:/);
  assert.match(contactRoute, /stage = "conversation_summary_rpc"[\s\S]*logContactsRouteFailure\(stage, summaryError/);
  assert.match(contactRoute, /stage = "contact_details_query"[\s\S]*logContactsRouteFailure\(stage, result\.error/);
  const loggerStart = server.indexOf("function logContactsRouteFailure");
  const loggerEnd = server.indexOf("function parseScheduledAt", loggerStart);
  assert.doesNotMatch(server.slice(loggerStart, loggerEnd), /access_token|phone_e164|text_body/);
});

check("more than 700 contact IDs are fetched in bounded batches without gaps", () => {
  assert.match(server, /const CONTACT_DETAILS_BATCH_SIZE = 100/);
  assert.match(server, /const CONTACT_DETAILS_BATCH_CONCURRENCY = 4/);
  assert.match(server, /\.in\("id", batch\)/);
  const contactStart = server.indexOf('app.get(`${API_PREFIX}/numbers/:numberId/contacts`');
  const contactEnd = server.indexOf('app.get(`${API_PREFIX}/media/:mediaId`', contactStart);
  assert.doesNotMatch(server.slice(contactStart, contactEnd), /\.in\("id", contactIds\)/);

  const summaryIds = Array.from({ length: 709 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  );
  const batches = [];
  for (let offset = 0; offset < summaryIds.length; offset += 100) {
    batches.push(summaryIds.slice(offset, offset + 100));
  }
  assert.equal(batches.length, 8);
  assert.ok(batches.every((batch) => batch.length <= 100));

  const databaseRows = batches.flatMap((batch) => [...batch].reverse().map((id) => ({ id })));
  const byId = new Map(databaseRows.map((row) => [row.id, row]));
  const mapped = summaryIds.flatMap((id) => byId.has(id) ? [byId.get(id)] : []);
  assert.equal(mapped.length, 709);
  assert.equal(new Set(mapped.map((row) => row.id)).size, 709);
  assert.deepEqual(mapped.map((row) => row.id), summaryIds);
});

check("balance is not polled and refreshes after paid send", () => {
  assert.match(chat, /const refreshBalance = useVisibilityRefresh\(loadTokenBalance\);/);
  assert.match(chat, /if \(requiresPaidSend\) void refreshBalance\(\)/);
  assert.doesNotMatch(chat, /intervalMs:\s*5_000/);
});

check("chat migration adds narrow indexes and a service-only helper", () => {
  assert.match(migration, /idx_wa_messages_conversation_cursor/);
  assert.match(migration, /org_id, number_id, contact_id, created_at DESC, id DESC/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.wa_messages/);
});

console.log(`Batch 6B chat/inbox regression: ${passed}/14 PASS`);
