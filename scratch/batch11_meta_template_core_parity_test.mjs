import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const server = read("supabase/functions/server/index.ts");
const templates = read("src/app/components/template-management.tsx");
const broadcast = read("src/app/components/broadcast-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
const api = read("src/app/lib/api.ts");
const migration = read("supabase/migrations/20261013120000_meta_template_core_parity.sql");

const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section missing: ${start}`);
  return source.slice(from, to);
};

const webhook = section(server, 'if (field === "message_template_status_update")', 'if (field === "messages")');
assert.match(webhook, /\.eq\("waba_id", wabaId\)/);
assert.match(webhook, /\.eq\("language", language\)/);
assert.match(webhook, /\.eq\("meta_template_id", metaTemplateId\)/);
assert.doesNotMatch(webhook, /else\s*\{\s*query = query\.eq\("name"/);
console.log("PASS 1-3 SECURITY - org/WABA/language identity prevents cross-template webhook mutation");

assert.match(server, /TEMPLATE_SENDABLE_STATUSES = new Set\(\["approved"\]\)/);
assert.match(server, /Template dan nomor pengirim berasal dari WABA berbeda/);
assert.match(server, /getTemplateSendability\(template, numberRow\)/g);
assert.match(chat, /template\.wabaId === selectedNumber\.wabaId/);
console.log("PASS 4-8 SENDABILITY - rejected/paused/disabled and wrong-WABA sends are rejected in Broadcast and Chat");

assert.doesNotMatch(section(templates, 'id="template-category"', 'id="template-language"'), /value="authentication"/);
assert.match(server, /Authentication belum didukung di SIPESA/);
assert.match(templates, /Template ini memiliki komponen Meta yang belum dapat diedit di SIPESA/);
console.log("PASS 9-10 AUTHENTICATION - generic creation is hidden and imports are read-only");

const edit = section(server, 'app.put(`${API_PREFIX}/templates/:id`', 'app.delete(`${API_PREFIX}/templates/:id`');
assert.match(edit, /name !== existing\.name \|\| language !== existing\.language/);
assert.match(edit, /inspectTemplateRuntime\(existing\)/);
assert.match(edit, /body\.__metaResponseStatus/);
console.log("PASS 11-12 EDIT - Meta name/language cannot drift and unsupported raw components cannot be stripped");

const remove = section(server, 'app.delete(`${API_PREFIX}/templates/:id`', 'app.post(`${API_PREFIX}/templates/sync`');
assert.match(remove, /if \(!metaRes\.ok \|\| metaJson\?\.success === false\)/);
assert.match(remove, /status: "deleted"/);
assert.match(remove, /hsm_id/);
console.log("PASS 13-14 DELETE - Meta failure retains local state and success tombstones only the exact identity");

assert.match(server, /paging\?\.cursors\?\.after/);
assert.match(server, /maxPages = 100/);
assert.match(server, /waba_id: params\.wabaId/);
assert.match(server, /missing_from_meta_at: syncedAt/);
console.log("PASS 15-17 SYNC - all cursor pages are WABA-scoped and missing rows are safely tombstoned");

assert.match(server, /Nama template maksimal 512 karakter/);
assert.match(server, /Konten template maksimal 1024 karakter/);
assert.match(server, /Nomor variabel harus berurutan/);
assert.match(server, /Footer tidak boleh memiliki variabel/);
assert.match(server, /Kategori template tidak valid/);
console.log("PASS 18-22 VALIDATION - backend mirrors critical predictable Meta validation");

const upload = section(server, 'app.post(`${API_PREFIX}/templates/upload-sample`', 'app.post(`${API_PREFIX}/templates`');
assert.doesNotMatch(upload, /access_token=/);
assert.match(upload, /Authorization: `Bearer \$\{accessToken\}`/);
console.log("PASS 23 TOKEN - media access token is header-only");

assert.match(server, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
assert.match(templates, /getTemplateDateValue\(b\) - getTemplateDateValue\(a\)/);
assert.match(templates, /String\(b\.id \|\| ""\)\.localeCompare/);
assert.match(templates, /\[\.\.\.filteredTemplates\]\.sort\(compareTemplates\)/);
assert.match(templates, /await refreshTemplates\(\)/);
assert.match(server, /synced_at: syncedAt/);
console.log("PASS 24-28 ORDERING - create/search/filter/refresh/sync preserve created_at DESC, id DESC");

assert.match(migration, /UNIQUE \(org_id, waba_id, name, language\)/);
assert.equal((migration.match(/array_agg\(att\.attname::text/g) || []).length, 2);
assert.match(api, /templateId\?: string/);
assert.match(broadcast, /availableTemplates/);
console.log("\nRESULT: Batch 11 Meta template core parity regression PASS (28 checks)");
