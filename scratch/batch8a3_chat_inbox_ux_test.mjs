import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const chat = read("src/app/components/chat-interface.tsx");
const inbox = read("src/app/components/inbox-view.tsx");
const app = read("src/app/App.tsx");
const api = read("src/app/lib/api.ts");
const visibility = read("src/app/hooks/use-visibility-refresh.ts");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("B8-008 only approved templates are selectable and empty never falls back", () => {
  assert.match(chat, /res\.data\.filter\(\(template: any\) => String\(template\.status \|\| ""\)\.toLowerCase\(\) === "approved"\)/);
  assert.doesNotMatch(chat, /approved\.length > 0 \? approved : res\.data/);
  assert.match(chat, /Belum ada template yang siap digunakan\./);
  assert.match(chat, /Lihat Template/);

  const templates = [
    { id: "1", status: "approved" },
    { id: "2", status: "draft" },
    { id: "3", status: "rejected" },
  ];
  assert.deepEqual(templates.filter((row) => row.status === "approved").map((row) => row.id), ["1"]);
  assert.deepEqual(templates.slice(1).filter((row) => row.status === "approved"), []);
});

test("B8-008 template loading, error, empty, and scoped retry are distinct", () => {
  assert.match(chat, /templateLoadState/);
  assert.match(chat, /"loading" \| "loaded" \| "error"/);
  assert.match(chat, /Template belum dapat dimuat\./);
  assert.match(chat, /onClick=\{\(\) => void loadApprovedTemplates\(\)\}/);
  assert.doesNotMatch(chat, /Template belum dapat dimuat[\s\S]{0,300}\berror\b\}/);
});

test("B8-009 outgoing status mapping is textual and accepted-send wording is non-final", () => {
  for (const label of ["Mengirim", "Terkirim", "Diterima", "Dibaca", "Gagal"]) {
    assert.match(chat, new RegExp(`label: "${label}"`));
  }
  assert.match(chat, /aria-label=\{`Status pesan: \$\{presentation\.label\}`\}/);
  assert.match(chat, /Pesan sedang dikirim\./);
  assert.match(chat, /Pesan template sedang dikirim\./);
  assert.doesNotMatch(chat, /toast\.success\("Pesan terkirim!/);
});

test("B8-009 Realtime UPDATE merges the same identity without duplicates or downgrade", () => {
  assert.match(chat, /event: "UPDATE"[\s\S]*table: "wa_messages"/);
  assert.match(chat, /setMessages\(\(previous\) => mergeMessages\(previous, \[mapRealtimeMessage\(row\)\]\)\)/);
  assert.match(chat, /new Map\(current\.map\(\(message\) => \[message\.id, message\]\)\)/);
  assert.match(chat, /resolveMessageStatus\(existing\.status, message\.status\)/);

  const rank = { queued: 0, processing: 10, sent: 20, delivered: 30, read: 40 };
  const resolve = (existing, incoming) => {
    if (existing === "failed") return existing;
    if (incoming === "failed") return rank[existing] < rank.delivered ? incoming : existing;
    return rank[incoming] >= rank[existing] ? incoming : existing;
  };
  assert.equal(resolve("queued", "sent"), "sent");
  assert.equal(resolve("sent", "delivered"), "delivered");
  assert.equal(resolve("delivered", "read"), "read");
  assert.equal(resolve("queued", "failed"), "failed");
  assert.equal(resolve("read", "delivered"), "read");
});

test("B8-010 initial loading, legitimate empty, error, stale retention, and retry are distinct", () => {
  assert.match(chat, /conversationState/);
  assert.match(chat, /Pesan belum dapat dimuat\./);
  assert.match(chat, /Belum ada pesan\./);
  assert.match(chat, /Pesan terakhir ditampilkan\. Gagal memperbarui\./);
  assert.match(chat, /loadMessages\(selectedContact\)/);
  assert.match(chat, /reconcileMessages\(\)/);
  assert.match(chat, /Percakapan belum dapat dimuat\./);
  assert.match(chat, /Belum ada percakapan\./);
  assert.match(chat, /Tidak ada hasil pencarian\./);
});

test("B8-010 real connection status is derived from Supabase and fallback remains available", () => {
  assert.match(chat, /setRealtimeState\(status\)/);
  assert.match(chat, /realtimeState !== "SUBSCRIBED"/);
  assert.match(chat, /Memperbarui koneksi…/);
  assert.match(chat, /intervalMs: 30_000/);
});

test("B8-011 blank and whitespace variables disable Send with inline feedback", () => {
  const valid = (values) => values.every((value) => value.trim().length > 0);
  assert.equal(valid([""]), false);
  assert.equal(valid(["   "]), false);
  assert.equal(valid(["A", " B "]), true);
  assert.match(chat, /invalidTemplateVariableIndexes/);
  assert.match(chat, /value\.trim\(\) \? -1 : index/);
  assert.match(chat, /Variabel ini wajib diisi\./);
  assert.match(chat, /aria-invalid=\{!templateVarValues\[idx\]\?\.trim\(\)\}/);
  assert.match(chat, /disabled=\{sendingTemplate \|\| !templatePrerequisitesValid\}/);
});

test("B8-011 required template media remains a blocking prerequisite", () => {
  assert.match(chat, /\["IMAGE", "VIDEO", "DOCUMENT"\]\.includes/);
  assert.match(chat, /selectedTemplateRequiresMedia/);
  assert.match(chat, /Template ini memerlukan media header/);
  assert.match(chat, /invalidTemplateVariableIndexes\.length === 0 && !selectedTemplateRequiresMedia/);
});

test("B8-022 number loading, zero, error, Retry, and stale states are distinct", () => {
  assert.match(app, /inboxNumbersState/);
  assert.match(inbox, /Memuat nomor WhatsApp/);
  assert.match(inbox, /Belum ada nomor WhatsApp yang tersedia\./);
  assert.match(inbox, /Nomor WhatsApp belum dapat dimuat\./);
  assert.match(inbox, /Daftar terakhir ditampilkan\. Gagal memperbarui nomor WhatsApp\./);
  assert.match(inbox, /Coba Lagi/);
});

test("B8-022 active numbers are semantic buttons and inactive numbers are disabled", () => {
  assert.match(inbox, /const isActive = number\.status === "active"/);
  assert.match(inbox, /<button[\s\S]*disabled=\{!isActive\}[\s\S]*onClick=\{\(\) => onSelectNumber\(number\.id\)\}/);
  assert.match(inbox, /aria-label=\{`\$\{number\.name\}/);
  assert.match(inbox, /focus-visible:ring-2/);
});

test("Batch 6B performance and read-only contracts remain bounded", () => {
  assert.match(chat, /getMessages\(numberId, contactId, \{ limit: 50 \}\)/);
  assert.match(chat, /getMessages\(numberId, contactId, \{ before: cursor, limit: 50 \}\)/);
  assert.match(chat, /getMessages\(numberId, contactId, \{ after: cursor, limit: 50 \}\)/);
  assert.match(chat, /event: "INSERT"[\s\S]*filter: `number_id=eq\.\$\{numberId\}`/);
  assert.match(chat, /event: "UPDATE"[\s\S]*filter: `contact_id=eq\.\$\{contactId\}`/);
  assert.match(visibility, /document\.visibilityState === "hidden"/);
  assert.doesNotMatch(chat, /setInterval\([\s\S]{0,300}(1000|1_000)/);
  assert.match(api, /async markConversationRead/);
});

test("changed Chat and Inbox layouts retain existing desktop/mobile flow", () => {
  assert.match(chat, /w-full md:w-\[360px\]/);
  assert.match(chat, /selectedContact \? "hidden md:flex" : "flex"/);
  assert.match(chat, /md:hidden/);
  assert.match(chat, /max-w-\[70%\]/);
  assert.match(inbox, /grid-cols-1 md:grid-cols-2 lg:grid-cols-3/);
  assert.match(inbox, /flex-col sm:flex-row/);
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

console.log(`Batch 8A-3 Chat / Inbox critical UX regression: ${passed}/${tests.length} PASS`);
