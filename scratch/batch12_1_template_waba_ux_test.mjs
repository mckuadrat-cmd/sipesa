import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ui = read("src/app/components/template-management.tsx");
const server = read("supabase/functions/server/index.ts");
const broadcast = read("src/app/components/broadcast-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section: ${start}`);
  return source.slice(from, to);
};

const createUi = section(ui, "const openCreateModal", "const openEditModal");
const stepOne = section(ui, "{builderStep === 1 ?", ") : builderStep === 3 ?");
const createApi = section(server, 'app.post(`${API_PREFIX}/templates`', 'app.put(`${API_PREFIX}/templates/:id`');

assert.match(ui, /wabaContexts\.length === 1 \? String\(wabaContexts\[0\]\.wabaId\) : ""/);
assert.match(stepOne, /wabaContexts\.length > 1[\s\S]*template-waba-setup/);
console.log("PASS 1 - one WABA is selected internally and its selector is not rendered");

assert.match(createUi, /wabaContexts\.length === 0[\s\S]*Belum ada akun WhatsApp Business yang terhubung\.[\s\S]*return/);
console.log("PASS 2 - zero WABA blocks template creation with controlled feedback");

assert.match(stepOne, /wabaContexts\.length > 1[\s\S]*Pilih akun WhatsApp Business/);
console.log("PASS 3 - multiple WABAs render an explicit selector");

assert.match(createApi, /waba_id: wabaId/);
console.log("PASS 4 - selected organization WABA is persisted as template ownership");

assert.match(createApi, /\.eq\("org_id", user\.org_id\)[\s\S]*\.eq\("waba_id", wabaId\)[\s\S]*WABA tidak dimiliki organisasi ini/);
console.log("PASS 5 - another organization's WABA cannot be spoofed");

assert.match(broadcast, /sender\.wabaId === template\.wabaId/);
console.log("PASS 6 - Broadcast sender/template WABA enforcement remains intact");

assert.match(chat, /template\.wabaId === selectedNumber\.wabaId/);
console.log("PASS 7 - Chat sender/template WABA enforcement remains intact");

assert.doesNotMatch(stepOne, /phoneNumberId|phone_number_id|Nomor WhatsApp|Pilih nomor/);
console.log("PASS 8 - template builder does not expose a phone-number sender selector");

console.log("\nRESULT: Batch 12.1 Template WABA UX regression PASS (8/8)");
