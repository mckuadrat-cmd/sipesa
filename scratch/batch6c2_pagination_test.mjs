import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");
const api = fs.readFileSync("src/app/lib/api.ts", "utf8");
const history = fs.readFileSync("src/app/components/broadcast-history.tsx", "utf8");
const detail = fs.readFileSync("src/app/components/broadcast-detail-view.tsx", "utf8");
const contacts = fs.readFileSync("src/app/components/contact-list-view.tsx", "utf8");
const broadcast = fs.readFileSync("src/app/components/broadcast-view.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261006200000_large_list_pagination.sql", "utf8");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("server enforces bounded page sizes", () => {
  assert.match(server, /CONTACT_LIST_MAX_PAGE_SIZE = 100/);
  assert.match(server, /BROADCAST_HISTORY_MAX_PAGE_SIZE = 50/);
  assert.match(server, /BROADCAST_RECIPIENT_MAX_PAGE_SIZE = 100/);
  assert.match(server, /Math\.min\(Math\.max\(requestedPageSize, 1\), maxPageSize\)/);
});

test("all three list queries are tenant scoped and use database range", () => {
  const contactsRoute = server.slice(server.indexOf("// GET one bounded page"), server.indexOf("// POST create contact"));
  const historyRoute = server.slice(server.indexOf("app.get(`${API_PREFIX}/broadcasts`,"), server.indexOf("app.post(`${API_PREFIX}/broadcasts`,"));
  const recipientsRoute = server.slice(server.indexOf("app.get(`${API_PREFIX}/broadcasts/:id/recipients`"), server.indexOf("app.get(`${API_PREFIX}/broadcasts/:id/stats`"));
  for (const route of [contactsRoute, historyRoute, recipientsRoute]) {
    assert.match(route, /\.eq\("org_id", user\.org_id\)/);
    assert.match(route, /\.range\(from, to\)/);
    assert.match(route, /count: "exact"/);
  }
});

test("ordering has deterministic id tie breakers", () => {
  assert.match(server, /\.order\("display_name", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)/s);
  assert.match(server, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/s);
  assert.match(server, /\.order\("sequence_no", \{ ascending: true, nullsFirst: false \}\)[\s\S]*?\.order\("id", \{ ascending: true \}\)/);
});

test("search and filters execute server-side", () => {
  assert.match(server, /display_name\.ilike.*phone_e164\.ilike.*label\.ilike/);
  assert.match(server, /query = query\.eq\("label", label\)/);
  assert.match(server, /title\.ilike.*text_body\.ilike/);
  assert.match(server, /query = query\.eq\("number_id", numberId\)/);
  assert.match(server, /recipient_name\.ilike.*phone_e164\.ilike/);
  assert.match(server, /query = query\.in\("status", \["accepted", "processing", "sent", "delivered", "read"\]\)/);
});

test("GET list routes no longer perform aggregate mutation", () => {
  const historyRoute = server.slice(server.indexOf("app.get(`${API_PREFIX}/broadcasts`,"), server.indexOf("app.post(`${API_PREFIX}/broadcasts`,"));
  assert.doesNotMatch(historyRoute, /recalculateBroadcastStats|\.update\(|\.insert\(|\.delete\(/);
});

test("frontend list views request pages rather than slicing full datasets", () => {
  assert.match(history, /pageSize: PAGE_SIZE/);
  assert.doesNotMatch(history, /filteredBroadcasts\.slice/);
  assert.match(detail, /pageSize: 50/);
  assert.doesNotMatch(detail, /broadcast\.recipients\.filter/);
  assert.match(contacts, /pageSize: PAGE_SIZE/);
  assert.doesNotMatch(contacts, /filteredContacts\.slice/);
  assert.match(broadcast, /pageSize: 20/);
});

test("history keeps successful rows visible during page, filter, search, and refresh requests", () => {
  assert.match(history, /loading && !hasLoadedRef\.current/);
  assert.match(history, /else setTableLoading\(true\)/);
  assert.match(history, /paginatedBroadcasts\.length === 0 && !loading && !tableLoading/);
  assert.match(history, /Memperbarui data/);
  assert.match(history, /disabled=\{currentPage === 1 \|\| tableLoading\}/);
});

test("server-side searches are debounced and stale responses are ignored", () => {
  for (const source of [history, detail, contacts]) {
    assert.match(source, /setTimeout\(\(\) => \{/);
    assert.match(source, /}, 350\)/);
    assert.match(source, /requestVersionRef/);
  }
  assert.match(history, /requestVersion !== requestVersionRef\.current/);
  assert.match(contacts, /Invalidate an older page\/search response immediately/);
});

test("recipients and contacts use the same initial-versus-background loading contract", () => {
  assert.match(detail, /loading && !hasLoadedRef\.current/);
  assert.match(detail, /filteredRecipients\.length === 0 && !tableLoading/);
  assert.match(detail, /Memperbarui penerima/);
  assert.match(contacts, /loading && !hasLoadedRef\.current/);
  assert.match(contacts, /paginatedContacts\.length === 0 && !tableLoading/);
  assert.match(contacts, /Memperbarui kontak/);
});

test("export walks every server page explicitly", () => {
  assert.match(history, /while \(true\)[\s\S]*pageSize: 50[\s\S]*page >= result\.data\.totalPages/);
  assert.match(detail, /while \(true\)[\s\S]*pageSize: 100[\s\S]*page >= result\.data\.totalPages/);
  assert.match(contacts, /while \(true\)[\s\S]*pageSize: 100[\s\S]*page >= result\.data\.totalPages/);
});

test("contacts selection is page-explicit and broadcast selection keeps snapshots", () => {
  assert.match(contacts, /const paginatedContacts = contacts/);
  assert.match(contacts, /setSelectedContactIds\(\[\]\)/);
  assert.match(broadcast, /selectedOrgContacts/);
  assert.match(broadcast, /selectedContactIds\.map\(\(id\) => selectedOrgContacts\[id\]\)/);
});

test("pagination indexes match actual filter and order prefixes", () => {
  assert.match(migration, /wa_contacts \(org_id, display_name ASC, id ASC\)/);
  assert.match(migration, /wa_contacts \(org_id, label, display_name ASC, id ASC\)/);
  assert.match(migration, /wa_broadcasts \(org_id, created_at DESC, id DESC\)/);
  assert.match(migration, /broadcast_id, sequence_no ASC NULLS LAST, created_at ASC, id ASC/);
});

test("API transports pagination and never exposes an unlimited page size", () => {
  assert.match(api, /type PageResult/);
  assert.match(api, /getOrgContacts\(options: ListPageOptions/);
  assert.match(api, /getBroadcastHistory\(options: ListPageOptions/);
  assert.match(api, /getBroadcastRecipients\(broadcastId: string, options: ListPageOptions/);
});

test("emulated pages have no duplicate or skipped boundary rows", () => {
  const rows = Array.from({ length: 237 }, (_, index) => ({
    created_at: index < 5 ? "2026-10-06T00:00:00Z" : new Date(2_000_000_000_000 - index).toISOString(),
    id: String(10_000 - index).padStart(5, "0"),
  })).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const pages = Array.from({ length: Math.ceil(rows.length / 50) }, (_, page) => rows.slice(page * 50, page * 50 + 50));
  const flattened = pages.flat();
  assert.equal(new Set(flattened.map((row) => row.id)).size, rows.length);
  assert.deepEqual(flattened, rows);
  assert.equal(pages.at(-1).length, 37);
  assert.deepEqual(rows.slice(500, 550), []);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`Batch 6C-2 pagination regression: ${passed}/${tests.length} PASS`);
